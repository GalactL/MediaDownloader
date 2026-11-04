// CLI contract: runs `main.ts` as a subprocess (exactly the launcher's Deno permissions)
// against tests/fake-tools/, and checks the launchers in packaging/. Never touches the network.
// The engine pipeline itself is covered in-process by engine.test.ts. Run: deno test -A engine/test
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonEscape } from "../core.ts";
import { enginePermissions } from "../permissions.ts";

const windows = Deno.build.os === "windows";
const repository = fileURLToPath(new URL("../../", import.meta.url));
const fakeTools = join(repository, "tests", "fake-tools");
const tool = (name: string) => join(fakeTools, windows ? `${name}.cmd` : name);
const mainScript = join(repository, "engine", "main.ts");
const tmp = Deno.makeTempDirSync({ prefix: "md-contract-" });
const home = join(tmp, "home");
const emptyPath = join(tmp, "emptypath");
const argvLog = join(tmp, "argv.log");
for (const directory of [home, emptyPath]) Deno.mkdirSync(directory);
let counter = 0;
const decoder = new TextDecoder();

interface Result {
  code: number;
  out: string;
  err: string;
  lines: string[];
  argv: string;
}

function environment(env: Record<string, string>): Record<string, string> {
  return {
    HOME: home,
    SystemRoot: Deno.env.get("SystemRoot") ?? "",
    PATH: windows ? emptyPath : "/usr/bin:/bin",
    DENO_DIR: join(tmp, "deno-cache"),
    DENO_NO_UPDATE_CHECK: "1",
    FAKE_DENO: Deno.execPath(),
    FAKE_ARGV_LOG: argvLog,
    MEDIADOWNLOADER_YTDLP: tool("yt-dlp"),
    MEDIADOWNLOADER_FFMPEG: tool("ffmpeg"),
    MEDIADOWNLOADER_DENO: tool("deno"),
    ...env,
  };
}

async function capture(command: string, args: string[], env: Record<string, string>, raw = false): Promise<Result> {
  try {
    Deno.removeSync(argvLog);
  } catch { /* first run */ }
  const output = await new Deno.Command(command, {
    args,
    cwd: tmp,
    clearEnv: true,
    env: environment(env),
    stdin: "null",
    windowsRawArguments: raw,
  }).output();
  const out = decoder.decode(output.stdout);
  let argv = "";
  try {
    argv = Deno.readTextFileSync(argvLog);
  } catch { /* no tool was run */ }
  return { code: output.code, out, err: decoder.decode(output.stderr), lines: out.split("\n").filter((l) => l !== ""), argv };
}

const run = (args: string[], env: Record<string, string> = {}) =>
  capture(Deno.execPath(), ["run", "--no-check", "--no-config", "--no-prompt", ...enginePermissions, mainScript, ...args], env);

const has = (r: Result, needle: string) => r.lines.some((line) => line.includes(needle));

// Protocol invariant: stdout is only "\n"-terminated lines, each exactly one typed JSON object.
function checkAllJson(r: Result) {
  assert.ok(r.out.length > 0 && r.out.endsWith("\n") && !r.out.includes("\r"), JSON.stringify(r.out));
  for (const line of r.out.slice(0, -1).split("\n")) {
    assert.ok(line.startsWith('{"type":"'), line);
    const value = JSON.parse(line);
    assert.ok(typeof value === "object" && typeof value.type === "string", line);
  }
}

function newDir(name: string) {
  const directory = join(tmp, `${name}${++counter}`);
  Deno.mkdirSync(directory);
  return directory;
}

Deno.test("help is plain text and lists every command and option", async () => {
  for (const args of [[], ["help"], ["--help"], ["-h"]]) {
    const r = await run(args);
    assert.equal(r.code, 0);
    for (
      const word of ["doctor", "probe", "download", "host", "install-host", "uninstall-host", "update", "--url",
        "--quality", "--format", "--title", "--start-time", "--end-time", "--max-size-mb", "--cookies-from-browser",
        "--output", "--overwrite", "--low-resources", "--yt-dlp", "--ffmpeg", "--ffprobe"]
    ) assert.ok(has(r, word), `help mentions ${word}`);
    assert.ok(!r.lines[0].startsWith("{"), "help is not a JSON event");
  }
});

Deno.test("invalid arguments exit 2 with one invalid_arguments event", async () => {
  const url = "https://example.com/v";
  const cases = [
    ["download"],
    ["probe"],
    ["download", "--url", url, "--start-time", "5"],
    ["download", "--url", url, "--end-time", "5"],
    ["download", "--url", url, "--start-time", "10", "--end-time", "10"],
    ["download", "--url", url, "--start-time", "10", "--end-time", "5"],
    ["download", "--url", "ftp://example.com/v"],
    ["download", "--url", "file:///etc/passwd"],
    ["download", "--url", url, "--bogus"],
    ["download", "--url", url, "--max-size-mb", "5", "--format", "mkv"],
    ["bogus"],
    ["my file.json"], // not a host launch without an extension id after it
    ["my file.json", "--x"],
    ["update", "--x"],
    ["install-host", "--bogus"],
    ["uninstall-host", "--x"],
  ];
  for (const args of cases) {
    const r = await run(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.equal(r.lines.length, 1, r.out);
    assert.ok(r.lines[0].startsWith('{"type":"error","code":"invalid_arguments","message":"'), r.out);
    checkAllJson(r);
  }
  assert.equal((await run(["bogus"])).out, '{"type":"error","code":"invalid_arguments","message":"Commande inconnue : bogus"}\n');
});

Deno.test("doctor, probe, download, update: stdout is strictly one JSON object per line", async () => {
  let r = await run(["doctor"]);
  assert.equal(r.code, 0);
  checkAllJson(r);
  assert.ok(r.lines.length === 1 && r.lines[0].startsWith('{"type":"doctor","tools":{"yt-dlp":{"found":true,"path":"'));

  r = await run(["probe", "--url", "https://example.com/v"]);
  assert.equal(r.code, 0);
  assert.equal(r.out, '{"type":"probe","data":{"id":"abc","title":"Fake Title","duration":10}}\n');

  const out = newDir("out");
  r = await run(["download", "--url", "https://example.com/v", "--output", out, "--max-size-mb", "10"], {
    FAKE_DURATION: "10",
    FAKE_ENCODED_BYTES: "4096",
    FAKE_SOURCE_BYTES: "100000",
  });
  assert.equal(r.code, 0, r.out + r.err);
  checkAllJson(r);
  assert.equal(r.lines[0], `{"type":"started","outputDirectory":"${jsonEscape(out)}"}`);
  assert.equal(r.lines.at(-1), `{"type":"completed","path":"${jsonEscape(join(out, "Fake Title [abc].mp4"))}","bytes":4096}`);

  r = await run(["update"]);
  assert.equal(r.code, 0);
  checkAllJson(r);
  assert.ok(has(r, '{"type":"log","level":"info","message":"yt-dlp is up to date"}'), r.out);
  assert.ok(r.argv.includes(" -U"), r.argv);
  r = await run(["update"], { FAKE_YTDLP_MODE: "fail" });
  assert.equal(r.code, 4);
  assert.equal(r.lines.at(-1), '{"type":"error","code":"update_failed","message":"La mise à jour de yt-dlp a échoué"}');
});

Deno.test("exit 3 for a missing tool, exit 4 with processing_failed for a thrown failure", async () => {
  const out = newDir("out");
  let r = await run(["download", "--url", "https://example.com/v", "--output", out], {
    PATH: emptyPath,
    MEDIADOWNLOADER_YTDLP: join(tmp, "nonexistent", "yt-dlp"),
  });
  assert.equal(r.code, 3);
  assert.ok(r.lines.length === 1 && r.lines[0].startsWith('{"type":"error","code":"tool_missing"'), r.out);

  r = await run(["download", "--url", "https://example.com/v", "--output", out, "--max-size-mb", "10"], {
    FAKE_FFMPEG_MODE: "fail",
  });
  assert.equal(r.code, 4);
  checkAllJson(r);
  assert.equal(
    r.lines.at(-1),
    `{"type":"error","code":"processing_failed","message":"FFmpeg a échoué pendant l'encodage passe 1"}`,
  );
});

// On Windows install-host writes HKCU and the repository's native-host folder: covered by install.test.ts instead.
Deno.test({
  name: "install-host and uninstall-host: empty stdout, manifest points at the launcher",
  ignore: windows,
  fn: async () => {
    const manifest = join(home, ".mozilla", "native-messaging-hosts", "media_downloader.json");
    let r = await run(["install-host"]);
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "");
    assert.match(r.err, /^Hôte natif installé : /);
    const text = Deno.readTextFileSync(manifest);
    assert.ok(text.includes(`"path": "${jsonEscape(join(repository, "MediaDownloader.Cli"))}"`), text);
    assert.ok(text.includes("mediadownloader@localhost"));

    r = await run(["uninstall-host"]);
    assert.ok(r.code === 0 && r.out === "", r.out);
    assert.throws(() => Deno.statSync(manifest));
    r = await run(["uninstall-host"]);
    assert.ok(r.code === 0 && r.out === "", "idempotent");
    assert.match(r.err, /^Hôte natif déjà absent : /);
  },
});

// --- launchers (packaging/) ---

const batLauncher = join(repository, "packaging", "MediaDownloader.Cli.bat");
const shLauncher = join(repository, "packaging", "MediaDownloader.Cli");

Deno.test("both launchers pass exactly enginePermissions and keep their line endings", () => {
  const expected = ["run", "--no-check", "--no-config", "--no-prompt", ...enginePermissions].join(" ");
  for (const [path, lineEnd] of [[batLauncher, "\r\n"], [shLauncher, "\n"]]) {
    const text = Deno.readTextFileSync(path);
    const runLine = text.split(lineEnd).find((line) => line.includes(" run --"));
    assert.ok(runLine, path);
    const flags = runLine.slice(runLine.indexOf("run --"));
    assert.equal(flags.slice(0, flags.indexOf(' "')), expected, path); // up to the quoted main.ts path
    if (lineEnd === "\n") assert.ok(!text.includes("\r"), `${path} must use LF`);
    else assert.ok(!text.replaceAll("\r\n", "").includes("\n"), `${path} must use CRLF`);
  }
});

// Stages the archive layout (launcher at the root, engine/, tools/bin/deno) in a temporary folder.
function stage(withDeno: boolean) {
  const root = newDir("archive é R&D (x) "); // spaces, accent, & and parentheses, like real user folders
  const launcher = join(root, windows ? "MediaDownloader.Cli.bat" : "MediaDownloader.Cli");
  Deno.copyFileSync(windows ? batLauncher : shLauncher, launcher);
  if (!windows) Deno.chmodSync(launcher, 0o755);
  Deno.mkdirSync(join(root, "engine"));
  for (const entry of Deno.readDirSync(join(repository, "engine"))) {
    if (entry.isFile) Deno.copyFileSync(join(repository, "engine", entry.name), join(root, "engine", entry.name));
  }
  if (withDeno) {
    const deno = join(root, "tools", "bin", windows ? "deno.exe" : "deno");
    Deno.mkdirSync(join(root, "tools", "bin"), { recursive: true });
    try {
      Deno.linkSync(Deno.execPath(), deno);
    } catch {
      Deno.copyFileSync(Deno.execPath(), deno);
    }
  }
  return launcher;
}

// Like Firefox on Windows: cmd.exe /s /c ""<launcher>" args".
const runLauncher = (launcher: string, args: string[], env: Record<string, string> = {}) =>
  windows
    ? capture(join(Deno.env.get("SystemRoot") ?? "C:\\Windows", "System32", "cmd.exe"), [
      "/s",
      "/c",
      `""${launcher}" ${args.join(" ")}"`,
    ], env, true)
    : capture(launcher, args, env);

Deno.test("launcher without Deno exits 3 with a message on stderr", async () => {
  const r = await runLauncher(stage(false), ["doctor"]);
  assert.equal(r.code, 3);
  assert.equal(r.out, "");
  assert.match(r.err, /Deno est introuvable/);
});

Deno.test("launcher runs the engine and propagates the exit code", async () => {
  const launcher = stage(true);
  let r = await runLauncher(launcher, ["doctor"]);
  assert.equal(r.code, 0, r.err);
  checkAllJson(r);
  assert.ok(r.lines.length === 1 && r.lines[0].startsWith('{"type":"doctor"'));
  r = await runLauncher(launcher, ["bogus"]);
  assert.equal(r.code, 2);
  assert.equal(r.out, '{"type":"error","code":"invalid_arguments","message":"Commande inconnue : bogus"}\n');
});

globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch { /* best effort */ }
});
