// Lite mode worker (module, one job per worker, started by engine.js): Pyodide + yt-dlp + ffmpeg.wasm (single
// thread). A worker because yt-dlp blocks on synchronous XHRs and ffmpeg.wasm runs synchronously.
// Message in: { url, startSec, endSec, maxSizeMb, cookies, opfsName }.
// Messages out: { progress } ..., then { result: { bytes, title } } or { error: { code, message } }.
import { loadPyodide } from './vendor/pyodide/pyodide.mjs';
import createFFmpegCore from './vendor/ffmpeg/ffmpeg-core.js';
import { runQjs } from './qjs.mjs';
import { ENCODER, EXTRACT_RETRIES, MAX_HEIGHT, MEMORY_BUDGET_MB, X264_PRESET } from './config.js';
import { LiteError, OUT_OF_MEMORY_MESSAGE, checkMemory, isOomText, isTimeoutText, redactUrls, resolveClip } from './engine.js';

const { checkFeasible, planEncode, LiteErrorCode } = globalThis.MDLitePlan;
const base = new URL('./', import.meta.url).href;
const progress = p => self.postMessage({ progress: p });
let pyodide, core, logs = [], onFfmpegLog = null;

// --- ffmpeg.wasm: run(args) is a synchronous `ffmpeg args`, its log captured ---
function run(args) {
  logs = [];
  core.reset();
  let code;
  try { code = core.exec(...args); } catch (e) { return { code: -1, stdout: '', stderr: `ffmpeg.wasm crashed: ${e}` }; }
  const text = type => logs.filter(l => l.type === type).map(l => l.message + '\n').join('');
  return { code, stdout: text('stdout'), stderr: text('stderr') };
}

// --- lazy http input: ffmpeg reads a URL through synchronous Range XHRs of 2 MiB, never the whole stream ---
const BLOCK = 2 << 20, KEEP = 6, ATTEMPTS = 3;
function lazyHttp(url, headers) {
  const cache = new Map();
  let size = 0, whole = null;
  const get = i => {
    if (whole) return whole.subarray(i * BLOCK, (i + 1) * BLOCK);
    if (cache.has(i)) { const b = cache.get(i); cache.delete(i); cache.set(i, b); return b; }
    let xhr;
    for (let attempt = 1; ; attempt++) {
      xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = 30000; // a synchronous XHR has no timeout by default
      xhr.setRequestHeader('x-mdl', '1');
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader('x-mdl-h-' + k.toLowerCase(), v);
      const last = size ? Math.min(size, (i + 1) * BLOCK) - 1 : (i + 1) * BLOCK - 1;
      xhr.setRequestHeader('Range', `bytes=${i * BLOCK}-${last}`);
      try { xhr.send(); break; } catch (e) { if (attempt >= ATTEMPTS) throw new Error(`${e.name} for ${new URL(url).host}`); }
    }
    if (xhr.status !== 206 && xhr.status !== 200) throw new Error(`HTTP ${xhr.status} for ${new URL(url).host}`);
    const bytes = new Uint8Array(xhr.response);
    if (xhr.status === 200) { whole = bytes; size = bytes.length; return get(i); } // server ignored Range
    size = Number((xhr.getResponseHeader('Content-Range') || '').split('/')[1]) || size;
    cache.set(i, bytes);
    if (cache.size > KEEP) cache.delete(cache.keys().next().value);
    return bytes;
  };
  get(0);
  return {
    size,
    slice(a, b) { // WORKERFS calls slice() then FileReaderSync: a real Blob of the requested range
      b = Math.min(b, size);
      const parts = [];
      for (let p = a; p < b;) {
        const i = Math.floor(p / BLOCK), blk = get(i), off = p - i * BLOCK, n = Math.min(blk.length - off, b - p);
        parts.push(blk.subarray(off, off + n));
        p += n;
      }
      return new Blob(parts);
    },
  };
}

// subprocess bridge called by lite.py (WasmPopen): http(s) inputs become lazy WORKERFS files under /net.
function bridgeFfmpeg(pyArgs) {
  const args = Array.from(pyArgs), blobs = [], out = [];
  let headers = {}, cookie = '';
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-headers') {
        for (const line of args[++i].split('\r\n')) { const [k, ...v] = line.split(': '); if (k && v.length) headers[k] = v.join(': '); }
      } else if (a === '-cookies') {
        cookie = args[++i].split('\r\n').filter(Boolean).map(c => c.split(';')[0]).join('; ');
      } else if (a === '-i' && /^https?:/.test(args[i + 1])) {
        const name = `in${blobs.length}`;
        blobs.push({ name, data: lazyHttp(args[++i], cookie ? { ...headers, Cookie: cookie } : headers) });
        out.push('-i', `/net/${name}`);
        headers = {};
        cookie = '';
      } else out.push(a);
    }
    if (blobs.length) core.FS.mount(core.FS.filesystems.WORKERFS, { blobs }, '/net');
    return run(out);
  } catch (e) {
    return { code: -1, stdout: '', stderr: redactUrls(e) };
  } finally {
    if (blobs.length) try { core.FS.unmount('/net'); } catch { /* not mounted */ }
  }
}

async function init() {
  const fetchBytes = async path => (await fetch(base + path)).arrayBuffer();
  const [qjsModule, ffModule] = await Promise.all([
    WebAssembly.compileStreaming(fetch(base + 'vendor/qjs/qjs-wasi.wasm')),
    WebAssembly.compileStreaming(fetch(base + 'vendor/ffmpeg/ffmpeg-core.wasm')),
  ]);
  core = await createFFmpegCore({
    instantiateWasm(imports, done) { WebAssembly.instantiate(ffModule, imports).then(i => done(i, ffModule)); return {}; },
  });
  core.setLogger(m => { logs.push(m); onFfmpegLog?.(m.message); });
  for (const dir of ['/work', '/net', '/opfs']) core.FS.mkdir(dir);
  pyodide = await loadPyodide({ indexURL: base + 'vendor/pyodide/' });
  for (const wheel of ['yt_dlp-2026.10.26-py3-none-any.whl', 'yt_dlp_ejs-0.8.0-py3-none-any.whl']) {
    pyodide.unpackArchive(await fetchBytes('vendor/wheels/' + wheel), 'wheel');
  }
  // Python's /work is ffmpeg's /work: what yt-dlp writes is what ffmpeg reads, no copy.
  pyodide.FS.mkdir('/work');
  pyodide.FS.mount(pyodide.FS.filesystems.PROXYFS, { root: '/work', fs: core.FS }, '/work');
  pyodide.registerJsModule('mdl', {
    runJs: code => runQjs(qjsModule, code),
    ffmpeg: bridgeFfmpeg,
    warn: text => console.warn('[lite]', redactUrls(text).slice(0, 500)),
  });
  pyodide.runPython(new TextDecoder().decode(await fetchBytes('lite.py')));
}

const durationOf = text => {
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
};
const pyCall = (name, ...args) => JSON.parse(pyodide.globals.get(name)(...args));

// Encode progress from ffmpeg's `time=` lines, at most once a second.
function trackProgress(seconds, pass) {
  let last = 0;
  onFfmpegLog = message => {
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    if (!m || performance.now() - last < 1000) return;
    last = performance.now();
    progress({ phase: 'encode', pass, percent: Math.min(100, Math.round((+m[1] * 3600 + +m[2] * 60 + +m[3]) / seconds * 100)) });
  };
}

// Same arguments as EncodeToSize (src/Engine.cpp), preset from config.js.
function encodeX264(input, plan, seconds) {
  const common = ['-i', input, '-map', '0:v:0', '-vf', `scale=-2:min(ih\\,${MAX_HEIGHT})`, '-c:v', 'libx264',
    '-preset', X264_PRESET, '-b:v', `${plan.videoKbps}k`, '-pass'];
  for (const pass of [1, 2]) {
    trackProgress(seconds, pass);
    const tail = pass === 1 ? ['-an', '-f', 'null', '/dev/null']
      : ['-map', '0:a:0?', '-c:a', 'aac', '-b:a', `${plan.audioKbps}k`, '-movflags', '+faststart', '/work/out.mp4'];
    const r = run([...common, String(pass), '-passlogfile', '/work/pass', ...tail]);
    if (r.code !== 0) throw encodeError(r.stderr, `passe ${pass}`);
  }
}

// Not qualified (spike #58): one pass, bitrate often under target, AAC still from ffmpeg.wasm. ffmpeg.wasm
// decodes and scales to I420 by 4 s segments, VideoEncoder (H.264) encodes, ffmpeg.wasm muxes with the audio;
// redone at a lower bitrate while the file is over the limit.
// shortcut: frame timestamps assume a constant frame rate (-r), a VFR source may drift; measure before enabling.
async function encodeWebCodecs(input, plan, seconds, maxBytes) {
  const info = run(['-hide_banner', '-i', input]).stderr;
  const m = /Video: .*?, (\d{2,5})x(\d{2,5})\b.*? ([\d.]+) fps/.exec(info);
  if (!m) throw encodeError(info, 'flux vidéo introuvable');
  const fps = +m[3], srcH = +m[2];
  const h = 2 * Math.floor(Math.min(srcH, MAX_HEIGHT) / 2), w = 2 * Math.round(+m[1] * h / srcH / 2);
  const frameBytes = w * h * 3 / 2, segment = 4;
  let factor = 1;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const chunks = [];
    let error = null, frames = 0;
    const cfg = { codec: 'avc1.640028', width: w, height: h, bitrate: Math.round(plan.videoKbps * 1000 * factor), framerate: fps,
      bitrateMode: 'constant', latencyMode: 'quality', hardwareAcceleration: 'prefer-software', avc: { format: 'annexb' } };
    if (!(await VideoEncoder.isConfigSupported(cfg)).supported) throw encodeError('', 'configuration WebCodecs non prise en charge');
    const enc = new VideoEncoder({ output: c => { const b = new Uint8Array(c.byteLength); c.copyTo(b); chunks.push(b); }, error: e => { error = String(e); } });
    enc.configure(cfg);
    for (let s = 0; s < seconds && !error; s += segment) {
      progress({ phase: 'encode', pass: attempt, percent: Math.round(s / seconds * 100) });
      const r = run(['-hide_banner', '-ss', String(s), '-t', String(segment), '-i', input, '-map', '0:v:0', '-an',
        '-vf', `scale=${w}:${h},format=yuv420p`, '-r', String(fps), '-f', 'rawvideo', '/work/seg.yuv']);
      if (r.code !== 0) throw encodeError(r.stderr, 'décodage');
      const raw = core.FS.readFile('/work/seg.yuv');
      core.FS.unlink('/work/seg.yuv');
      for (let off = 0; off + frameBytes <= raw.length && !error; off += frameBytes) {
        const frame = new VideoFrame(raw.subarray(off, off + frameBytes), { format: 'I420', codedWidth: w, codedHeight: h, timestamp: Math.round(frames * 1e6 / fps) });
        enc.encode(frame, { keyFrame: frames % Math.round(fps * 4) === 0 });
        frame.close();
        frames++;
        while (enc.encodeQueueSize > 8) await new Promise(res => setTimeout(res, 0));
      }
    }
    await enc.flush().catch(e => { error = String(e); });
    enc.close();
    if (error) throw encodeError(error, 'WebCodecs');
    core.FS.writeFile('/work/v.h264', new Uint8Array(await new Blob(chunks).arrayBuffer()));
    const mux = run(['-hide_banner', '-y', '-f', 'h264', '-r', String(fps), '-i', '/work/v.h264', '-i', input, '-map', '0:v:0', '-map', '1:a:0?',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', `${plan.audioKbps}k`, '-shortest', '-movflags', '+faststart', '/work/out.mp4']);
    core.FS.unlink('/work/v.h264');
    if (mux.code !== 0) throw encodeError(mux.stderr, 'multiplexage');
    const bytes = core.FS.stat('/work/out.mp4').size;
    if (bytes <= maxBytes) return;
    factor *= 0.97 * maxBytes / bytes;
  }
}

function encodeError(stderr, step) {
  return isOomText(stderr) ? new LiteError(LiteErrorCode.out_of_memory, OUT_OF_MEMORY_MESSAGE)
    : new LiteError('encode_failed', `L'encodage a échoué (${step}).`);
}

async function opfsWrite(dir, name, bytes) {
  const h = await (await dir.getFileHandle(name, { create: true })).createSyncAccessHandle();
  h.truncate(0);
  h.write(bytes, { at: 0 });
  h.flush();
  return h;
}

// Read-only file in ffmpeg's FS whose reads go straight to the OPFS sync access handle (no Blob copy per read).
function mountOpfs(h, name) {
  const size = h.getSize();
  core.FS.mount(core.FS.filesystems.WORKERFS, { blobs: [{ name, data: { size } }] }, '/opfs');
  const node = core.FS.lookupPath('/opfs/' + name).node;
  node.stream_ops = { ...node.stream_ops, read(stream, buffer, offset, length, position) {
    const n = Math.min(length, size - position);
    return n > 0 ? h.read(buffer.subarray(offset, offset + n), { at: position }) : 0;
  } };
}

// extract (bounded retries on timeout) -> refuse early (size, memory) -> download (cut/merge in ffmpeg.wasm)
// -> intermediate to OPFS -> encode -> final MP4 to OPFS.
async function job({ url, startSec, endSec, maxSizeMb, cookies, opfsName }) {
  progress({ phase: 'init' });
  await init();
  progress({ phase: 'extract' });
  let prep;
  for (let attempt = 0; ; attempt++) {
    prep = pyCall('prepare', url, JSON.stringify(cookies), MAX_HEIGHT);
    if (prep.ok || !isTimeoutText(prep.error)) break;
    if (attempt >= EXTRACT_RETRIES) {
      throw new LiteError(LiteErrorCode.extract_timeout, `Le site n'a pas répondu à temps (${attempt + 1} tentatives). Réessayez plus tard ou utilisez le mode normal.`);
    }
  }
  if (!prep.ok) throw new LiteError('download_failed', `Extraction impossible : ${redactUrls(prep.error).slice(0, 300)}`);

  const clip = resolveClip(startSec, endSec, prep.duration);
  if (!clip) {
    throw new LiteError('invalid_arguments', prep.duration ? 'L\'extrait demandé est hors de la vidéo.' : 'Durée de la vidéo inconnue : le mode léger ne peut pas la traiter.');
  }
  if (!checkFeasible(clip.seconds, maxSizeMb).ok) {
    throw new LiteError(LiteErrorCode.size_unreachable, `La durée (${Math.round(clip.seconds)} s) est trop importante pour la taille demandée (${maxSizeMb} Mo). Choisissez un extrait plus court ou une taille plus grande.`);
  }
  const memory = checkMemory(prep.formats, clip.seconds, MEMORY_BUDGET_MB);
  if (!memory.ok) {
    throw new LiteError(LiteErrorCode.out_of_memory, `Mémoire insuffisante : l'extrait demandé (environ ${Math.round(memory.estimateMb)} Mo avant encodage) dépasse ce que le mode léger peut traiter (${MEMORY_BUDGET_MB} Mo). Choisissez un extrait plus court ou utilisez le mode normal.`);
  }

  progress({ phase: 'download' });
  const dl = pyCall('download', clip.start ?? undefined, clip.end ?? undefined);
  if (!dl.ok) {
    throw isOomText(dl.error) ? new LiteError(LiteErrorCode.out_of_memory, OUT_OF_MEMORY_MESSAGE)
      : new LiteError('download_failed', `Téléchargement impossible : ${redactUrls(dl.error).slice(0, 300)}`);
  }
  const seconds = durationOf(run(['-hide_banner', '-i', dl.path]).stderr) || clip.seconds;
  const plan = planEncode(seconds, maxSizeMb);
  if (!plan) throw new LiteError(LiteErrorCode.size_unreachable, `La durée (${Math.round(seconds)} s) est trop importante pour la taille demandée (${maxSizeMb} Mo).`);

  // The intermediate leaves the wasm heap: OPFS file, read back on demand by the encoder.
  const opfs = await navigator.storage.getDirectory();
  const sourceName = opfsName + '.source';
  const node = core.FS.lookupPath(dl.path).node;
  const source = await opfsWrite(opfs, sourceName, node.contents.subarray(0, node.usedBytes));
  try {
    core.FS.unlink(dl.path);
    mountOpfs(source, sourceName);
    const maxBytes = Math.floor(maxSizeMb * 1024 * 1024);
    if (ENCODER === 'webcodecs') await encodeWebCodecs('/opfs/' + sourceName, plan, seconds, maxBytes);
    else encodeX264('/opfs/' + sourceName, plan, seconds);
    onFfmpegLog = null;
    const out = core.FS.readFile('/work/out.mp4');
    if (out.length > maxBytes) throw new LiteError('size_exceeded', 'Le fichier encodé dépasse encore la taille maximale demandée');
    (await opfsWrite(opfs, opfsName, out)).close();
    return { bytes: out.length, title: prep.title || null };
  } finally {
    source.close();
    await opfs.removeEntry(sourceName).catch(() => {});
  }
}

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ result: await job(data) });
  } catch (e) {
    const known = e instanceof LiteError;
    const code = known ? e.code : isOomText(e) ? LiteErrorCode.out_of_memory : 'internal_error';
    const message = known ? e.message : code === LiteErrorCode.out_of_memory ? OUT_OF_MEMORY_MESSAGE
      : `Erreur interne du mode léger : ${redactUrls(e && e.message || e).slice(0, 300)}`;
    self.postMessage({ error: { code, message } });
  }
};
