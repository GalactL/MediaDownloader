// Tests of engine/deps.ts and of the pinned manifest. Fake data only, served by a loopback Deno.serve: no real
// download. Run: deno test -A engine/test
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { checkDependencies, DepsError, type Entry, installDependencies, loadEntries, type Options } from "../deps.ts";

const repo = join(import.meta.dirname!, "..", "..");
const manifestPath = join(repo, "engine", "deps.json");
const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const text = (s: string) => new TextEncoder().encode(s);

// --- fixture archives (built in code so the tests do not depend on zip/tar being installed) ---
function crc32(data: Uint8Array) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function makeZip(name: string, data: Uint8Array) {
  const n = text(name);
  const crc = crc32(data);
  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, data.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, n.length, true);
  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, data.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, n.length, true);
  const offset = 30 + n.length + data.length;
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, 1, true);
  end.setUint16(10, 1, true);
  end.setUint32(12, 46 + n.length, true);
  end.setUint32(16, offset, true);
  return concat(new Uint8Array(local.buffer), n, data, new Uint8Array(central.buffer), n, new Uint8Array(end.buffer));
}
function makeTar(name: string, data: Uint8Array) {
  const header = new Uint8Array(512);
  header.set(text(name));
  header.set(text("0000755\0"), 100);
  header.set(text(data.length.toString(8).padStart(11, "0") + "\0"), 124);
  header.set(text("00000000000\0"), 136);
  header.set(text("        "), 148);
  header[156] = 0x30;
  header.set(text("ustar\0" + "00"), 257);
  header.set(text(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 "), 148);
  const padding = new Uint8Array((512 - (data.length % 512)) % 512 + 1024);
  return concat(header, data, padding);
}
function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const plain = text("plain tool v1\n");
const zipTool = text("zip tool v1\n");
const tarTool = text("tar tool v1\n");
const zip = makeZip("pkg/bin/zt", zipTool);
const tar = makeTar("pkg/bin/tt", tarTool);

interface Fixture {
  base: string;
  hits: Map<string, number>;
  stop: () => Promise<void>;
}
async function startServer(): Promise<Fixture> {
  const hits = new Map<string, number>();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => {
    const path = new URL(request.url).pathname;
    const n = (hits.get(path) ?? 0) + 1;
    hits.set(path, n);
    switch (path) {
      case "/plain":
        return new Response(plain);
      case "/zip":
        return new Response(zip);
      case "/tar":
        return new Response(tar);
      case "/truncated":
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(plain.slice(0, 5));
              setTimeout(() => controller.error(new Error("cut")), 20);
            },
          }),
          { headers: { "content-length": String(plain.length) } },
        );
      case "/flaky":
        return n < 3 ? new Response("busy", { status: 503 }) : new Response(plain);
      case "/redirect":
        return new Response(null, { status: 302, headers: { location: "/plain" } });
      case "/evil":
        return new Response(null, { status: 302, headers: { location: "http://example.invalid/plain" } });
    }
    return new Response("not found", { status: 404 });
  });
  return {
    base: `http://127.0.0.1:${server.addr.port}`,
    hits,
    stop: () => server.shutdown(),
  };
}

const entries = (base: string): Entry[] => [
  { name: "plain", version: "1", url: `${base}/plain`, size: plain.length, sha256: sha(plain), archive: "none", dest: "plain-tool" },
  {
    name: "zipped",
    version: "1",
    url: `${base}/zip`,
    size: zip.length,
    sha256: sha(zip),
    archive: "zip",
    member: "pkg/bin/zt",
    dest: "zip-tool",
    fileSha256: sha(zipTool),
  },
  {
    name: "tarred",
    version: "1",
    url: `${base}/tar`,
    size: tar.length,
    sha256: sha(tar),
    archive: "tar",
    member: "pkg/bin/tt",
    dest: "tar-tool",
    fileSha256: sha(tarTool),
  },
];

async function withFixture(
  body: (f: Fixture, root: string, options: (e: Entry[]) => Options) => Promise<void>,
) {
  const fixture = await startServer();
  const root = await Deno.makeTempDir({ prefix: "md-deps-" });
  try {
    await body(fixture, root, (e) => ({
      root,
      entries: e,
      allowLoopbackHttp: true,
      smoke: false,
      backoffMs: 1,
      report: () => {},
    }));
  } finally {
    await fixture.stop();
    await Deno.remove(root, { recursive: true });
  }
}
const toolsLeft = async (root: string) => {
  const names: string[] = [];
  try {
    for await (const item of Deno.readDir(join(root, "tools"))) names.push(item.name);
  } catch { /* none */ }
  return names.sort();
};
const rejectsWith = async (promise: Promise<unknown>, pattern: RegExp) => {
  const error = await promise.then(() => null, (e) => e);
  assert.ok(error instanceof DepsError, `expected a DepsError, got ${error}`);
  assert.match(error.message, pattern);
};

// --- manifest ---
Deno.test("manifest: https only, 64-hex sums, pinned versions, both platforms complete", async () => {
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  assert.deepEqual(Object.keys(manifest.platforms).sort(), ["linux-x86_64", "windows-x86_64"]);
  for (const [platform, list] of Object.entries<Entry[]>(manifest.platforms)) {
    assert.deepEqual(list.map((e) => e.name), ["deno", "yt-dlp", "ffmpeg"], platform);
    for (const e of list) {
      const where = `${platform}/${e.name}`;
      assert.match(e.url, /^https:\/\/[^/]+\//, where);
      assert.doesNotMatch(e.url + e.version, /latest(?!\))/i, `${where} must be pinned`);
      assert.match(e.sha256, /^[0-9a-f]{64}$/, where);
      assert.match(e.fileSha256 ?? e.sha256, /^[0-9a-f]{64}$/, where);
      assert.ok(e.size > 0 && /\d/.test(e.version), where);
      assert.ok(["none", "zip", "tar"].includes(e.archive), where);
      assert.equal(e.archive === "none", e.member === undefined, where);
      assert.ok(e.archive === "none" ? !e.fileSha256 : !!e.fileSha256, where);
      assert.doesNotMatch(e.dest, /[\\/]/, where);
    }
  }
  assert.match(manifest.platforms["windows-x86_64"][2].url, /autobuild-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\//);
  await rejectsWith(loadEntries(manifestPath, "darwin-aarch64"), /non prise en charge/);
});

Deno.test("Installer.bat and install.sh inline the same Deno pin as engine/deps.json", async () => {
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  const bat = await Deno.readTextFile(join(repo, "packaging", "Installer.bat"));
  const sh = await Deno.readTextFile(join(repo, "packaging", "install.sh"));
  const cases: Array<[string, string, (name: string) => string | undefined]> = [
    ["windows-x86_64", bat, (n) => bat.match(new RegExp(`set "${n}=([^"]+)"`))?.[1]],
    ["linux-x86_64", sh, (n) => sh.match(new RegExp(`^${n}='([^']+)'`, "m"))?.[1]],
  ];
  for (const [platform, , read] of cases) {
    const deno: Entry = manifest.platforms[platform][0];
    assert.equal(deno.name, "deno");
    assert.equal(read("DENO_VERSION"), deno.version, platform);
    assert.equal(read("DENO_URL"), deno.url, platform);
    assert.equal(read("DENO_SHA256"), deno.sha256, platform);
    assert.equal(read("DENO_EXE_SHA256"), deno.fileSha256, platform);
  }
});

// --- installer ---
Deno.test("installs plain, zip and tar tools, then a second run downloads nothing", async () => {
  await withFixture(async (fixture, root, options) => {
    const e = entries(fixture.base);
    assert.deepEqual(await installDependencies(options(e)), ["plain", "zipped", "tarred"]);
    const bin = join(root, "tools", "bin");
    assert.deepEqual(await Deno.readFile(join(bin, "plain-tool")), plain);
    assert.deepEqual(await Deno.readFile(join(bin, "zip-tool")), zipTool);
    assert.deepEqual(await Deno.readFile(join(bin, "tar-tool")), tarTool);
    assert.deepEqual(await toolsLeft(root), ["bin"]);
    const before = [...fixture.hits.values()].join();
    assert.deepEqual(await installDependencies(options(e)), []);
    assert.equal([...fixture.hits.values()].join(), before);
    assert.deepEqual(await checkDependencies(options(e)), []);
  });
});

Deno.test("--check reports modified and missing files", async () => {
  await withFixture(async (fixture, root, options) => {
    const e = entries(fixture.base);
    await installDependencies(options(e));
    await Deno.writeTextFile(join(root, "tools", "bin", "plain-tool"), "tampered");
    await Deno.remove(join(root, "tools", "bin", "zip-tool"));
    const problems = await checkDependencies(options(e));
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /plain-tool.*SHA-256/);
    assert.match(problems.join("\n"), /zip-tool : absent/);
  });
});

Deno.test("hash mismatch: error, tools/bin untouched, nothing staged left behind", async () => {
  await withFixture(async (fixture, root, options) => {
    const bin = join(root, "tools", "bin");
    await Deno.mkdir(bin, { recursive: true });
    await Deno.writeTextFile(join(bin, "tar-tool"), "previous version");
    const e = entries(fixture.base);
    e[2] = { ...e[2], sha256: "0".repeat(64) }; // the last one is wrong: the first two must not be installed either
    await rejectsWith(installDependencies(options(e)), /tarred : SHA-256 incorrect/);
    assert.deepEqual(await toolsLeft(root), ["bin"]);
    assert.deepEqual([...Deno.readDirSync(bin)].map((i) => i.name), ["tar-tool"]);
    assert.equal(await Deno.readTextFile(join(bin, "tar-tool")), "previous version");
  });
});

Deno.test("extracted file whose hash differs from fileSha256 is rejected", async () => {
  await withFixture(async (fixture, root, options) => {
    const e = entries(fixture.base).slice(1, 2);
    e[0] = { ...e[0], fileSha256: "1".repeat(64) };
    await rejectsWith(installDependencies(options(e)), /SHA-256 incorrect pour zip-tool/);
    assert.deepEqual(await toolsLeft(root), []);
  });
});

Deno.test("truncated download is retried, then fails cleanly", async () => {
  await withFixture(async (fixture, root, options) => {
    const e: Entry[] = [{ ...entries(fixture.base)[0], url: `${fixture.base}/truncated` }];
    await rejectsWith(installDependencies(options(e)), /plain : /);
    assert.equal(fixture.hits.get("/truncated"), 3);
    assert.deepEqual(await toolsLeft(root), []);
  });
});

Deno.test("transient HTTP 503 is retried and then succeeds", async () => {
  await withFixture(async (fixture, root, options) => {
    const e: Entry[] = [{ ...entries(fixture.base)[0], url: `${fixture.base}/flaky` }];
    assert.deepEqual(await installDependencies(options(e)), ["plain"]);
    assert.equal(fixture.hits.get("/flaky"), 3);
    assert.deepEqual(await Deno.readFile(join(root, "tools", "bin", "plain-tool")), plain);
  });
});

Deno.test("HTTP 404 fails at once (no retry)", async () => {
  await withFixture(async (fixture, root, options) => {
    const e: Entry[] = [{ ...entries(fixture.base)[0], url: `${fixture.base}/missing` }];
    await rejectsWith(installDependencies(options(e)), /HTTP 404/);
    assert.equal(fixture.hits.get("/missing"), 1);
    assert.deepEqual(await toolsLeft(root), []);
  });
});

Deno.test("a redirect to a non-https address is refused; a same-host redirect is followed", async () => {
  await withFixture(async (fixture, root, options) => {
    const base = entries(fixture.base)[0];
    await rejectsWith(installDependencies(options([{ ...base, url: `${fixture.base}/evil` }])), /HTTPS obligatoire/);
    assert.deepEqual(await toolsLeft(root), []);
    assert.deepEqual(await installDependencies(options([{ ...base, url: `${fixture.base}/redirect` }])), ["plain"]);
  });
});

Deno.test("plain http is refused unless the test option is set", async () => {
  await withFixture(async (fixture, root, options) => {
    const strict = { ...options(entries(fixture.base)), allowLoopbackHttp: false };
    await rejectsWith(installDependencies(strict), /HTTPS obligatoire/);
    assert.equal(fixture.hits.size, 0);
    assert.deepEqual(await toolsLeft(root), []);
  });
});

Deno.test("a stale .tmp- folder from a killed run is swept, a fresh one is left alone", async () => {
  await withFixture(async (fixture, root, options) => {
    const tools = join(root, "tools");
    await Deno.mkdir(join(tools, ".tmp-1"), { recursive: true });
    await Deno.mkdir(join(tools, ".tmp-2"));
    const old = new Date(Date.now() - 2 * 3600_000);
    await Deno.utime(join(tools, ".tmp-1"), old, old);
    await installDependencies(options(entries(fixture.base).slice(0, 1)));
    assert.deepEqual(await toolsLeft(root), [".tmp-2", "bin"]);
  });
});

Deno.test("smoke test failure (file that does not run) installs nothing", async () => {
  await withFixture(async (fixture, root, options) => {
    await rejectsWith(
      installDependencies({ ...options(entries(fixture.base).slice(0, 1)), smoke: true }),
      /ne démarre pas/,
    );
    assert.deepEqual(await toolsLeft(root), []);
  });
});
