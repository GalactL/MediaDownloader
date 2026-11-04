// Port of tests/HostTests.cpp: drives `main.ts host` over real stdin/stdout pipes with framed messages, against
// tests/fake-tools/ (POSIX sh fakes on Linux, .cmd + .ts twins on Windows). Never touches the network.
// Run: deno test -A engine/test
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compactProbe, parseRequest } from "../host.ts";
import { enginePermissions } from "../permissions.ts";
import { isProcessRunning } from "../process.ts";

const windows = Deno.build.os === "windows";
const fakeTools = fileURLToPath(new URL("../../tests/fake-tools/", import.meta.url));
const tool = (name: string) => join(fakeTools, windows ? `${name}.cmd` : name);
const mainScript = fileURLToPath(new URL("../main.ts", import.meta.url));
const tmp = Deno.makeTempDirSync({ prefix: "md-host-" });
const home = join(tmp, "home");
Deno.mkdirSync(home);
let counter = 0;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const timeoutMs = windows ? 30000 : 10000; // every Windows fake tool is a cmd + deno start

function newDir(name: string) {
  const directory = join(tmp, `${name}${++counter}`);
  Deno.mkdirSync(directory);
  return directory;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls up to 5 s: cleanup can finish just after the terminal event.
async function eventually(predicate: () => boolean) {
  for (let i = 0; i < 50; ++i) {
    if (predicate()) return true;
    await sleep(100);
  }
  return predicate();
}

const noTempDirs = (directory: string) =>
  eventually(() => ![...Deno.readDirSync(directory)].some((e) => e.name.startsWith(".mediadownloader-")));
const gone = (pid: number) => eventually(() => !isProcessRunning(pid));

// Reads the pid a hanging fake tool wrote, waiting for the file to appear.
async function waitPid(file: string) {
  for (let i = 0; i < timeoutMs / 20; ++i) {
    try {
      const pid = Number.parseInt(Deno.readTextFileSync(file));
      if (pid > 0) return pid;
    } catch { /* not yet */ }
    await sleep(20);
  }
  return -1;
}

// Raw bytes of a string whose chars are all < 256 (to build invalid UTF-8).
const latin1 = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function frame(body: Uint8Array | string) {
  const bytes = typeof body === "string" ? encoder.encode(body) : body;
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

class Host {
  readonly child: Deno.ChildProcess;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  #buffer = new Uint8Array(0);
  #pending?: Promise<ReadableStreamReadResult<Uint8Array>>;
  #inputClosed = false;
  #eof = false;

  constructor(env: Record<string, string> = {}, args = ["host", "/some/manifest.json", "md@example.org"]) {
    this.child = new Deno.Command(Deno.execPath(), {
      args: ["run", "--no-check", "--no-config", "--no-prompt", ...enginePermissions, mainScript, ...args],
      cwd: tmp,
      clearEnv: true,
      env: {
        HOME: home,
        SystemRoot: Deno.env.get("SystemRoot") ?? "",
        PATH: windows ? "" : "/usr/bin:/bin",
        DENO_DIR: join(tmp, "deno-cache"),
        DENO_NO_UPDATE_CHECK: "1",
        FAKE_DENO: Deno.execPath(),
        MEDIADOWNLOADER_YTDLP: tool("yt-dlp"),
        MEDIADOWNLOADER_FFMPEG: tool("ffmpeg"),
        MEDIADOWNLOADER_DENO: tool("deno"),
        ...env,
      },
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    }).spawn();
    this.#writer = this.child.stdin.getWriter();
    this.#reader = this.child.stdout.getReader();
  }

  async sendRaw(bytes: Uint8Array) {
    await this.#writer.write(bytes);
  }

  send(body: Uint8Array | string) {
    return this.sendRaw(frame(body));
  }

  async closeInput() {
    if (this.#inputClosed) return;
    this.#inputClosed = true;
    await this.#writer.close().catch(() => {});
  }

  // Returns `size` bytes, or undefined on timeout or EOF.
  async #readExact(size: number, deadline: number): Promise<Uint8Array | undefined> {
    while (this.#buffer.length < size) {
      if (this.#eof) return undefined;
      this.#pending ??= this.#reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        this.#pending,
        new Promise<undefined>((resolve) => timer = setTimeout(() => resolve(undefined), Math.max(deadline - Date.now(), 0))),
      ]);
      clearTimeout(timer);
      if (result === undefined) return undefined;
      this.#pending = undefined;
      if (result.done) {
        this.#eof = true;
        return undefined;
      }
      const joined = new Uint8Array(this.#buffer.length + result.value.length);
      joined.set(this.#buffer);
      joined.set(result.value, this.#buffer.length);
      this.#buffer = joined;
    }
    const out = this.#buffer.slice(0, size);
    this.#buffer = this.#buffer.slice(size);
    return out;
  }

  async recvBytes(timeout = timeoutMs): Promise<Uint8Array | undefined> {
    const deadline = Date.now() + timeout;
    const header = await this.#readExact(4, deadline);
    if (!header) return undefined;
    const length = new DataView(header.buffer).getUint32(0, true);
    assert.ok(length <= 1024 * 1024, `outgoing frame over 1 MiB: ${length}`);
    return await this.#readExact(length, deadline);
  }

  async recv(timeout = timeoutMs): Promise<string | undefined> {
    const body = await this.recvBytes(timeout);
    return body && decoder.decode(body);
  }

  // Messages up to and including the first terminal one.
  async recvJob(): Promise<string[]> {
    const messages: string[] = [];
    for (let message; (message = await this.recv()) !== undefined;) {
      messages.push(message);
      if (["completed", "error", "probe", "doctor"].some((type) => message!.startsWith(`{"type":"${type}"`))) {
        return messages;
      }
    }
    messages.push("<timeout or eof>");
    return messages;
  }

  // Closes stdin (unless told not to), reads stdout to EOF and returns the exit code.
  async finish(closeInput = true): Promise<number> {
    if (closeInput) await this.closeInput();
    while (await this.recvBytes() !== undefined) { /* drain */ }
    const status = await Promise.race([this.child.status, sleep(timeoutMs).then(() => undefined)]);
    if (!status) {
      this.kill();
      await this.child.status;
      return -1;
    }
    return status.code;
  }

  kill() {
    try {
      this.child.kill("SIGKILL");
    } catch { /* already gone */ }
  }

  // Releases every resource whatever happened (Deno's test sanitizers check them).
  async dispose() {
    this.kill();
    await this.closeInput();
    await this.#reader.cancel().catch(() => {});
    await this.child.status;
  }
}

// Runs `body` with a fresh host and always disposes of it.
async function withHost(env: Record<string, string>, body: (host: Host) => Promise<void>) {
  const host = new Host(env);
  try {
    await body(host);
  } finally {
    await host.dispose();
  }
}

const last = (messages: string[]) => messages[messages.length - 1];

Deno.test("parseRequest is strict", () => {
  const ok = parseRequest(encoder.encode('{"a":[1,2.5e1,-0,true,false,null],"s":"x\\u00e9\\ud83d\\ude00\\n\\"\\\\\\/","a":"dup"}'));
  assert.deepEqual(ok, { a: "dup", s: "xé😀\n\"\\/" });
  for (
    const bad of ["", "{", "[1,]", '{"a":1,}', "01", "1.", "-", "1e", '"\\ud800"', '"\\udc00"', '"\\ud83dx"', '"a\nb"',
      "tru", "{} x", "'a'", '{"a" 1}', '"\\x"', '"\\u12G4"', "[1 2]", "{1:2}", '{"\\ud800":1}']
  ) assert.equal(parseRequest(encoder.encode(bad)), undefined, bad);
  for (const bad of ['"\xff"', '"\xc0\x80"', '"\xed\xa0\x80"', '"\xf4\x90\x80\x80"', '"\xe2\x82"', '"\xe2\x82("', '"\x80"']) {
    assert.equal(parseRequest(latin1(bad)), undefined, "invalid UTF-8");
  }
  assert.equal(parseRequest(latin1('\xef\xbb\xbf{"type":"doctor"}')), undefined, "a BOM is not JSON");
  assert.equal(parseRequest(latin1('"\xe2\x82\xac \xf0\x9f\x98\x80 \xc3\xa9"')), "€ 😀 é");
});

Deno.test("compactProbe keeps the summary fields and sorted unique heights", () => {
  assert.equal(
    compactProbe('{"id":"a","duration":0.30000000000000004,"title":null,"formats":[{"height":720.9},{"height":0},{"height":1e6},"x"]}'),
    '{"id":"a","duration":0.3,"heights":[720]}',
  );
  assert.equal(compactProbe("[]"), undefined);
  assert.equal(compactProbe("nope"), undefined);
});

Deno.test("host: probe is compacted", async () => {
  const probeJson = '{"id":"abc","title":"Titre \\u00e9t\\u00e9","duration":12.5,"uploader":"U",' +
    '"thumbnail":"https://t/x.jpg","webpage_url":"https://example.com/v","description":"big",' +
    '"formats":[{"height":1080},{"height":720},{"height":null},{"height":720},{},{"height":360.0}]}';
  await withHost({ FAKE_YTDLP_PROBE_JSON: probeJson }, async (host) => {
    await host.send('{"type":"probe","id":"p1","url":"https://example.com/v"}');
    const messages = await host.recvJob();
    assert.deepEqual(messages, [
      '{"type":"probe","id":"p1","data":{"id":"abc","title":"Titre été","duration":12.5,"uploader":"U",' +
      '"thumbnail":"https://t/x.jpg","webpage_url":"https://example.com/v","heights":[360,720,1080]}}',
    ]);
    assert.equal(await host.finish(), 0, "EOF exits 0");
  });
});

Deno.test("host: download, lowResources, then doctor on the same host", async () => {
  const out = newDir("out");
  await withHost({}, async (host) => {
    await host.send(JSON.stringify({
      type: "download", id: "d1", url: "https://example.com/v", quality: "720", format: "mp4", title: "Mon titre",
      maxSizeMb: 10, overwrite: false, outputDirectory: out,
    }));
    const messages = await host.recvJob();
    assert.ok(messages.length >= 3, messages.join("\n"));
    for (const m of messages) assert.ok(m.startsWith('{"type":"') && m.includes(',"id":"d1"'), m);
    assert.ok(messages.some((m) => m.startsWith('{"type":"progress","id":"d1"')), "progress streamed");
    assert.ok(messages.some((m) => m.startsWith('{"type":"phase","id":"d1","stage":"')), "phase framed with the id");
    assert.ok(messages[0].startsWith('{"type":"started","id":"d1"'), messages[0]);
    assert.ok(last(messages).startsWith('{"type":"completed","id":"d1","path":"'), last(messages));
    assert.ok(await noTempDirs(out));

    await host.send(JSON.stringify({
      type: "download", id: "d2", url: "https://example.com/v", maxSizeMb: 10, lowResources: true, outputDirectory: out,
    }));
    assert.ok(last(await host.recvJob()).startsWith('{"type":"completed","id":"d2"'));

    await host.send('{"type":"doctor"}');
    const doctor = await host.recvJob();
    assert.ok(doctor.length === 1 && doctor[0].startsWith('{"type":"doctor","tools":{'), doctor[0]);
    assert.equal(await host.finish(), 0);
  });
});

Deno.test("host: download failure, then the host still serves requests", async () => {
  const out = newDir("out");
  await withHost({ FAKE_YTDLP_MODE: "fail" }, async (host) => {
    await host.send(JSON.stringify({ type: "download", id: "f1", url: "https://example.com/v", outputDirectory: out }));
    const messages = await host.recvJob();
    assert.ok(last(messages).startsWith('{"type":"error","id":"f1","code":"download_failed"'), last(messages));
    assert.ok(await noTempDirs(out));
    await host.send('{"type":"probe","id":"f2","url":"https://example.com/v"}');
    assert.ok(last(await host.recvJob()).startsWith('{"type":"error","id":"f2"'));
    assert.equal(await host.finish(), 0);
  });
});

Deno.test("host: invalid messages, oversized request, openFolder without download", async () => {
  await withHost({}, async (host) => {
    const cases: [Uint8Array | string, string][] = [
      ['{"type":"download","id":"i1","url":"https://example.com/v","startTime":5}', '{"type":"error","id":"i1","code":"invalid_arguments"'],
      ['{"type":"download","id":"i2","url":"https://example.com/v","startTime":10,"endTime":5}', '{"type":"error","id":"i2","code":"invalid_arguments"'],
      ['{"type":"download","id":"i3","url":"ftp://example.com/v"}', '{"type":"error","id":"i3","code":"invalid_arguments"'],
      ['{"type":"download","id":"i4"}', '{"type":"error","id":"i4","code":"invalid_arguments"'],
      ['{"type":"download","id":"i5","url":"https://example.com/v","maxSizeMb":"10"}', '{"type":"error","id":"i5","code":"invalid_arguments","message":"Le champ maxSizeMb doit être un nombre."}'],
      ['{"type":"probe","id":"i6","url":"https://example.com/v","cookiesFromBrowser":"netscape"}', '{"type":"error","id":"i6","code":"invalid_arguments"'],
      ['{"type":"download","id":"i9","url":"https://example.com/v","lowResources":"yes"}', '{"type":"error","id":"i9","code":"invalid_arguments","message":"Le champ lowResources doit être un booléen."}'],
      ['{"type":"bogus","id":"i7"}', '{"type":"error","id":"i7","code":"invalid_message","message":"Type de message inconnu : bogus"}'],
      ['{"id":"i8"}', '{"type":"error","code":"invalid_message","message":"Message JSON invalide ou sans type."}'],
      ['{"type":"download",', '{"type":"error","code":"invalid_message"'],
      ["[1,2]", '{"type":"error","code":"invalid_message"'],
      ["", '{"type":"error","code":"invalid_message"'],
      ['{"type":"doctor","id":"\\ud800"}', '{"type":"error","code":"invalid_message"'],
      // Invalid UTF-8 anywhere in a string: the whole message is invalid and no id is echoed.
      [latin1('{"type":"doctor","id":"b\xff"}'), '{"type":"error","code":"invalid_message"'],
      [latin1('{"type":"probe","id":"u1","url":"https://example.com/\xc3("}'), '{"type":"error","code":"invalid_message"'],
      [latin1('{"type":"download","id":"t1","url":"https://example.com/v","title":"a\xed\xa0\x80z"}'), '{"type":"error","code":"invalid_message"'],
      ['{"type":"openFolder","id":"o1"}', '{"type":"error","id":"o1","code":"no_folder","message":"Aucun dossier de téléchargement à ouvrir."}'],
      ['{"type":"doctor","id":42}', '{"type":"doctor","tools":{'], // a non-string id is ignored
    ];
    for (const [request, expected] of cases) {
      await host.send(request);
      const reply = await host.recv();
      assert.ok(reply?.startsWith(expected), `${request} -> ${reply}`);
    }
    await host.send('{"type":"cancel"}'); // no job: ignored silently
    await host.send('{"type":"doctor","id":"after"}');
    assert.ok((await host.recv())?.startsWith('{"type":"doctor","id":"after"'));

    // Oversized request: rejected without id, payload skipped, protocol stays in sync.
    const big = 5 * 1024 * 1024;
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, big, true);
    const writing = host.sendRaw(header).then(() => host.sendRaw(new Uint8Array(big).fill(0x78)));
    assert.equal(
      await host.recv(),
      '{"type":"error","code":"message_too_large","message":"Le message dépasse 4 Mio."}',
    );
    await writing;
    await host.send('{"type":"doctor","id":"sync"}');
    assert.ok((await host.recv())?.startsWith('{"type":"doctor","id":"sync"'));
    assert.equal(await host.finish(), 0);
  });
});

Deno.test("host: frame sizes, length prefixes with 0x0A/0x0D/0x1A, UTF-8, partial and pipelined writes", async () => {
  await withHost({}, async (host) => {
    // Incoming: doctor requests padded with spaces to exact sizes (up to the 4 MiB limit).
    const padded = (size: number, id: string) => {
      const json = `{"type":"doctor","id":"${id}"}`;
      return json + " ".repeat(size - encoder.encode(json).length);
    };
    const sizes = [26, 266, 269, 2573, 3338, 65535, 65536, 65537, 65546, 854554, 1706509, 4 * 1024 * 1024];
    for (const [index, size] of sizes.entries()) {
      await host.send(padded(size, String(index % 10)));
      assert.ok((await host.recv())?.startsWith(`{"type":"doctor","id":"${index % 10}"`), `incoming ${size}`);
    }
    // Tiny frames (10 and 13 bytes) are not requests but keep the stream in sync.
    for (const tiny of ['{"x":1234}', '{"x":1234567}']) {
      await host.send(tiny);
      assert.ok((await host.recv())?.startsWith('{"type":"error","code":"invalid_message"'));
    }

    // Outgoing: the id is echoed, so its length sets the reply size exactly.
    await host.send('{"type":"doctor","id":""}');
    const base = (await host.recvBytes())!.length;
    for (const size of [2573, 6666, 65535, 65536, 65537, 657930, 1024 * 1024]) {
      await host.send(`{"type":"doctor","id":"${"a".repeat(size - base)}"}`);
      const reply = await host.recvBytes();
      assert.equal(reply?.length, size, `outgoing ${size}`);
      assert.equal(JSON.parse(decoder.decode(reply)).id.length, size - base);
    }
    // One byte over 1 MiB: message_too_large with the id; without it when the error itself would exceed the limit.
    const tooLarge = { type: "error", code: "message_too_large", message: "La réponse dépasse la taille maximale autorisée." };
    for (const length of [1024 * 1024 + 1 - base, 1024 * 1024 - 20]) {
      await host.send(`{"type":"doctor","id":"${"a".repeat(length)}"}`);
      const reply = JSON.parse((await host.recv())!);
      assert.equal(reply.id?.length, length < 1024 * 1024 - 100 ? length : undefined, `id of ${length}`);
      assert.deepEqual({ ...reply, id: undefined }, { ...tooLarge, id: undefined });
    }

    // UTF-8 and escapes survive the round trip.
    const id = "é漢字😀\u2028\u2029\uFEFF\u0000\"\\/\n\t";
    await host.send(JSON.stringify({ type: "doctor", id }));
    assert.equal(JSON.parse((await host.recv())!).id, id);

    // Partial writes: the header byte by byte, the body in pieces.
    const pieces = frame('{"type":"doctor","id":"slow"}');
    for (const chunk of [pieces.subarray(0, 1), pieces.subarray(1, 2), pieces.subarray(2, 3), pieces.subarray(3, 10), pieces.subarray(10)]) {
      await host.sendRaw(chunk);
      await sleep(30);
    }
    assert.ok((await host.recv())?.startsWith('{"type":"doctor","id":"slow"'));

    // Several frames in one write are answered in order.
    const ids = ["p1", "p2", "p3"];
    const frames = ids.map((i) => frame(`{"type":"doctor","id":"${i}"}`));
    const all = new Uint8Array(frames.reduce((n, f) => n + f.length, 0));
    frames.reduce((offset, f) => (all.set(f, offset), offset + f.length), 0);
    await host.sendRaw(all);
    for (const i of ids) assert.ok((await host.recv())?.startsWith(`{"type":"doctor","id":"${i}"`));
    assert.equal(await host.finish(), 0);
  });
});

Deno.test("host: a truncated frame exits 1", async () => {
  for (const bytes of [new Uint8Array([10, 0]), frame('{"type":"doctor"}').subarray(0, 10)]) {
    await withHost({}, async (host) => {
      await host.sendRaw(bytes);
      assert.equal(await host.finish(), 1);
    });
  }
});

Deno.test("host: one job at a time, cancel kills yt-dlp", async () => {
  const out = newDir("out");
  const pidFile = join(tmp, `ytdlp${++counter}.pid`);
  await withHost({ FAKE_YTDLP_MODE: "hang", FAKE_YTDLP_PID_FILE: pidFile }, async (host) => {
    await host.send(JSON.stringify({ type: "download", id: "h1", url: "https://example.com/v", outputDirectory: out }));
    const tool = await waitPid(pidFile);
    assert.ok(tool > 0, "fake yt-dlp started");

    await host.send('{"type":"download","id":"h2","url":"https://example.com/v"}');
    await host.send('{"type":"probe","id":"h3","url":"https://example.com/v"}');
    await host.send('{"type":"pickFolder","id":"h4"}');
    // Skip the started/log events of the running job; busy answers carry the new request ids.
    const busy: string[] = [];
    while (busy.length < 3) {
      const m = await host.recv();
      assert.ok(m, "missing busy answers");
      if (m.includes('"code":"busy"')) busy.push(m);
      else assert.ok(m.includes('"id":"h1"'), m);
    }
    assert.deepEqual(
      busy,
      ["h2", "h3", "h4"].map((i) => `{"type":"error","id":"${i}","code":"busy","message":"Un traitement est déjà en cours."}`),
    );

    await host.send('{"type":"cancel"}');
    const messages = await host.recvJob();
    assert.ok(last(messages).startsWith('{"type":"error","id":"h1","code":"cancelled"'), last(messages));
    assert.ok(await gone(tool), "yt-dlp process is gone");
    assert.ok(await noTempDirs(out));

    await host.send('{"type":"doctor","id":"again"}');
    assert.ok((await host.recv())?.startsWith('{"type":"doctor","id":"again"'), "host alive afterwards");
    assert.equal(await host.finish(), 0);
  });
});

Deno.test("host: cancel during encoding kills ffmpeg and leaves nothing", async () => {
  const out = newDir("out");
  const pidFile = join(tmp, `ffmpeg${++counter}.pid`);
  await withHost({ FAKE_FFMPEG_MODE: "hang", FAKE_FFMPEG_PID_FILE: pidFile, FAKE_SOURCE_BYTES: "3000000" }, async (host) => {
    await host.send(JSON.stringify({ type: "download", id: "e1", url: "https://example.com/v", maxSizeMb: 1, outputDirectory: out }));
    const tool = await waitPid(pidFile);
    assert.ok(tool > 0, "fake ffmpeg started");
    await host.send('{"type":"cancel"}');
    const messages = await host.recvJob();
    assert.ok(last(messages).startsWith('{"type":"error","id":"e1","code":"cancelled"'), last(messages));
    assert.ok(await gone(tool), "ffmpeg process is gone");
    assert.ok(await noTempDirs(out));
    assert.ok(await eventually(() => [...Deno.readDirSync(out)].length === 0), "no output file left");
    assert.equal(await host.finish(), 0);
  });
});

Deno.test("host: EOF while a job runs cancels it and kills the tool tree", async () => {
  const out = newDir("out");
  const pidFile = join(tmp, `eof${++counter}.pid`);
  await withHost({ FAKE_YTDLP_MODE: "hang", FAKE_YTDLP_PID_FILE: pidFile }, async (host) => {
    await host.send(JSON.stringify({ type: "download", url: "https://example.com/v", outputDirectory: out }));
    const tool = await waitPid(pidFile);
    assert.ok(tool > 0, "fake yt-dlp started");
    assert.equal(await host.finish(), 0, "exits 0 while a job runs");
    assert.ok(await gone(tool), "yt-dlp process is gone");
    assert.ok(await noTempDirs(out));
  });
});

Deno.test({
  name: "host: SIGTERM cancels the job with stdin still open",
  ignore: windows,
  fn: async () => {
    const out = newDir("out");
    const pidFile = join(tmp, `term${++counter}.pid`);
    await withHost({ FAKE_YTDLP_MODE: "hang", FAKE_YTDLP_PID_FILE: pidFile }, async (host) => {
      await host.send(JSON.stringify({ type: "download", url: "https://example.com/v", outputDirectory: out }));
      const tool = await waitPid(pidFile);
      assert.ok(tool > 0, "fake yt-dlp started");
      host.child.kill("SIGTERM");
      assert.equal(await host.finish(false), 0);
      assert.ok(await gone(tool), "yt-dlp process is gone");
      assert.ok(await noTempDirs(out));
    });
  },
});

// The host gets an explicit env without DISPLAY/WAYLAND_DISPLAY: every chooser fails (or is absent), which must be
// a framed error, not a hang.
Deno.test({
  name: "host: pickFolder without a display is pick_failed",
  ignore: windows,
  fn: async () => {
    await withHost({}, async (host) => {
      await host.send('{"type":"pickFolder","id":"p1"}');
      assert.ok((await host.recv())?.startsWith('{"type":"error","id":"p1","code":"pick_failed"'));
      await host.send('{"type":"doctor","id":"after"}');
      assert.ok((await host.recv())?.startsWith('{"type":"doctor","id":"after"'));
      assert.equal(await host.finish(), 0);
    });
  },
});

Deno.test("host: auto-detected from Firefox and Chromium launch arguments", async () => {
  for (
    const args of [
      ["C:\\x\\media_downloader.json", "mediadownloader@localhost"],
      // A manifest path with spaces (user folder "Jean Dupont"): still a Firefox launch.
      ["C:\\Users\\Jean Dupont\\MediaDownloader\\native-host\\media_downloader.json", "mediadownloader@localhost"],
      ["chrome-extension://abc/", "--parent-window=0"],
    ]
  ) {
    const host = new Host({}, args);
    try {
      await host.send('{"type":"doctor","id":"auto"}');
      assert.ok((await host.recv())?.startsWith('{"type":"doctor","id":"auto"'), args.join(" "));
      assert.equal(await host.finish(), 0);
    } finally {
      await host.dispose();
    }
  }
});

globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch { /* best effort */ }
});
