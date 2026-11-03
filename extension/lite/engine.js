// Lite mode engine (ES module): yt-dlp in Pyodide + ffmpeg.wasm, in a fresh worker per job, no native host.
//
//   const { opfsName, bytes, title } = await runLite({ url, startSec, endSec, maxSizeMb, onProgress, signal });
//
// - startSec/endSec: both or neither (seconds). maxSizeMb > 0 is required (lite mode always encodes to fit).
// - onProgress({ phase: 'init' | 'extract' | 'download' | 'encode', pass?, percent? }).
// - signal (AbortSignal): terminates the worker, rejects with code 'cancelled'.
// - Rejects with a LiteError { code, message } (French message, no URL path, no cookie): a LiteErrorCode of
//   plan.js (size_unreachable, out_of_memory, extract_timeout, unsupported_site) or, like the native engine,
//   invalid_arguments, download_failed, encode_failed, size_exceeded, cancelled, internal_error.
// - Jobs run one at a time (queued). The MP4 is left at the OPFS root under `opfsName`; the caller saves it,
//   e.g. getFile() of (await navigator.storage.getDirectory()).getFileHandle(opfsName), then removeEntry()s it.
//
// Contract the caller (background page, task T3) must provide:
// 1. Load this module from an extension page that holds `<all_urls>`, `webRequest`, `webRequestBlocking` and
//    `cookies`, with CSP "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" and the files fetched by
//    tools/fetch-lite-assets.mjs under lite/vendor/.
// 2. Cookies: runLite reads browser.cookies.getAll({ domain }) for the site itself (none if the API is absent)
//    and hands them to yt-dlp's cookie jar in the worker. Only call runLite once the user granted `cookies`.
// 3. Forbidden headers: the worker's synchronous XHRs carry `x-mdl: 1` and send every header as
//    `x-mdl-h-<lowercase name>: <value>` (Cookie, Referer, Origin, User-Agent...). The background must install:
//    - webRequest.onBeforeSendHeaders, ['blocking', 'requestHeaders'], { urls: ['<all_urls>'] }: only when the
//      request has `x-mdl` AND details.originUrl starts with browser.runtime.getURL('') (never let a web page
//      use the rewrite). Replace each `x-mdl-h-<name>` by `<name>`, drop every `x-mdl*` header, drop the
//      browser's own Cookie and Origin (yt-dlp's jar is authoritative). Remember details.requestId.
//    - webRequest.onHeadersReceived, ['blocking', 'responseHeaders']: for a remembered requestId, accumulate
//      the Set-Cookie values over the whole redirect chain (Firefox joins several with '\n') and append the
//      response header `x-mdl-set-cookie: encodeURIComponent(JSON.stringify(allSetCookieValues))`.
//    - webRequest.onCompleted and onErrorOccurred: forget the requestId.
import './plan.js';

const { LiteErrorCode } = globalThis.MDLitePlan;

export class LiteError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LiteError';
    this.code = code;
  }
}

const SITES = [
  { name: 'youtube', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'], cookieDomains: ['youtube.com'] },
  { name: 'tiktok', hosts: ['tiktok.com'], cookieDomains: ['tiktok.com'] },
  { name: 'x', hosts: ['x.com', 'twitter.com'], cookieDomains: ['x.com', 'twitter.com'] },
];

// http(s) URL on YouTube, TikTok or X (exact host or subdomain, look-alikes rejected) -> site, else null.
export function liteSite(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  return SITES.find(s => s.hosts.some(h => host === h || host.endsWith('.' + h))) || null;
}

// Clip actually processed once the duration is known: null start/end = whole video. null if nothing is left.
export function resolveClip(startSec, endSec, duration) {
  if (startSec == null) return duration > 0 ? { start: null, end: null, seconds: duration } : null;
  const end = duration > 0 ? Math.min(endSec, duration) : endSec;
  if (end <= startSec) return null;
  if (duration > 0 && startSec <= 0 && end >= duration) return { start: null, end: null, seconds: duration };
  return { start: startSec, end, seconds: end - startSec };
}

// Peak memory ~ 2 x the intermediate file (it grows in the wasm heap) + encoder; formats without a bitrate
// are not counted (unknown -> allowed, the runtime malloc failure is still caught).
export function checkMemory(formats, seconds, budgetMb) {
  const tbrKbps = formats.reduce((sum, f) => sum + (f.tbr || 0), 0);
  const estimateMb = globalThis.MDLitePlan.estimateMemoryMb({ tbrKbps, durationSeconds: seconds });
  return { ok: !(estimateMb * 2 > budgetMb), estimateMb };
}

export const isOomText = text => /out of memory|\bOOM\b|Cannot allocate memory|allocation failed|malloc of size \d+ failed|Array buffer allocation/i.test(text);
export const isTimeoutText = text => /TimeoutError|timed out/i.test(text);
// Stream URLs carry signatures: logs and messages only keep the host.
export const redactUrls = text => String(text).replace(/\bhttps?:\/\/([^\s/?#"'<>]+)[^\s"'<>]*/gi, '$1/…');

export const OUT_OF_MEMORY_MESSAGE = 'Mémoire insuffisante pour traiter cette vidéo dans le navigateur. Choisissez un extrait plus court ou utilisez le mode normal.';

async function siteCookies(site) {
  const api = globalThis.browser?.cookies;
  if (!api) return [];
  const lists = await Promise.all(site.cookieDomains.map(domain => api.getAll({ domain })));
  return lists.flat().map(({ name, value, domain, path, secure, expirationDate }) => ({ name, value, domain, path, secure, expirationDate }));
}

// Intermediate files of a job killed with its worker (abort, crash, closed browser) are swept before the next.
async function sweepSources(root) {
  for await (const name of root.keys()) {
    if (name.endsWith('.source')) await root.removeEntry(name).catch(() => {});
  }
}

async function runOne({ url, startSec = null, endSec = null, maxSizeMb, onProgress = () => {}, signal }) {
  const site = liteSite(url);
  if (!site) throw new LiteError(LiteErrorCode.unsupported_site, 'Le mode léger ne prend en charge que YouTube, TikTok et X.');
  if (!(maxSizeMb > 0)) throw new LiteError('invalid_arguments', 'Le mode léger exige une taille maximale positive.');
  if ((startSec == null) !== (endSec == null) || (startSec != null && !(startSec >= 0 && endSec > startSec))) {
    throw new LiteError('invalid_arguments', 'Extrait invalide : donnez le début et la fin, la fin après le début.');
  }
  const cancelled = () => new LiteError('cancelled', 'Téléchargement annulé');
  if (signal?.aborted) throw cancelled();

  const root = await navigator.storage.getDirectory();
  await sweepSources(root);
  const opfsName = `mediadownloader-lite-${Date.now()}.mp4`;
  const cookies = await siteCookies(site);
  const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  let onAbort, ok = false;
  try {
    const result = await new Promise((resolve, reject) => {
      onAbort = () => reject(cancelled());
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = ({ data }) => {
        if (data.progress) onProgress(data.progress);
        else if (data.error) reject(new LiteError(data.error.code, data.error.message));
        else resolve(data.result);
      };
      worker.onerror = e => {
        e.preventDefault();
        reject(isOomText(e.message) ? new LiteError(LiteErrorCode.out_of_memory, OUT_OF_MEMORY_MESSAGE)
          : new LiteError('internal_error', `Le mode léger s'est arrêté : ${redactUrls(e.message || 'erreur inconnue')}`));
      };
      worker.postMessage({ url, startSec, endSec, maxSizeMb, cookies, opfsName });
    });
    ok = true;
    return { opfsName, ...result };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    worker.terminate();
    // The killed worker may still lock the intermediate: sweepSources() removes it before the next job.
    if (!ok) for (const name of [opfsName, opfsName + '.source']) await root.removeEntry(name).catch(() => {});
  }
}

let queue = Promise.resolve();
export function runLite(options) {
  const job = queue.then(() => runOne(options));
  queue = job.catch(() => {});
  return job;
}
