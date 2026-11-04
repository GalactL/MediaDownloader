// Engine pipeline tests (help, argument errors and install-host stay with the CLI tests), run
// in-process against tests/fake-tools/: the POSIX sh fakes on Linux, their .cmd + .ts twins on Windows.
// Never touches the network. Run: deno test -A engine/test
import assert from "node:assert/strict";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonEscape, parseArguments } from "../core.ts";
import { Engine, type EngineEvent, serializeEvent } from "../engine.ts";
import { isProcessRunning } from "../process.ts";

const windows = Deno.build.os === "windows";
const fakeTools = fileURLToPath(new URL("../../tests/fake-tools/", import.meta.url));
const tool = (name: string) => join(fakeTools, windows ? `${name}.cmd` : name);
const tmp = Deno.makeTempDirSync({ prefix: "md-engine-" });
const home = join(tmp, "home");
const videos = join(home, "Videos");
const root = join(tmp, "root"); // no tools/bin: a developer's real tools must not leak into the tests
const argvLog = join(tmp, "argv.log");
const emptyPath = join(tmp, "emptypath");
for (const directory of [home, root, emptyPath]) Deno.mkdirSync(directory, { recursive: true });
let counter = 0;

interface Result {
  code: number;
  lines: string[];
  out: string;
  argv: string;
}

// Runs one engine command like the CLI would (thrown errors become "processing_failed"/"cancelled", exit 4),
// with a controlled environment that is restored afterwards.
async function run(args: string[], env: Record<string, string> = {}, signal?: AbortSignal): Promise<Result> {
  const settings: Record<string, string> = {
    HOME: home,
    FAKE_ARGV_LOG: argvLog,
    FAKE_DENO: Deno.execPath(),
    MEDIADOWNLOADER_YTDLP: tool("yt-dlp"),
    MEDIADOWNLOADER_FFMPEG: tool("ffmpeg"),
    MEDIADOWNLOADER_DENO: tool("deno"),
    ...(windows ? {} : { PATH: "/usr/bin:/bin" }),
    ...env,
  };
  const saved = Object.fromEntries(Object.keys(settings).map((key) => [key, Deno.env.get(key)]));
  for (const key of ["FAKE_YTDLP_MODE", "FAKE_FFMPEG_MODE", "MEDIADOWNLOADER_NODE"]) {
    if (key in settings) continue;
    saved[key] = Deno.env.get(key);
    Deno.env.delete(key);
  }
  for (const [key, value] of Object.entries(settings)) Deno.env.set(key, value);
  try {
    Deno.removeSync(argvLog);
  } catch { /* first run */ }
  const lines: string[] = [];
  const sink = { on: (event: EngineEvent) => void lines.push(serializeEvent(event)) };
  const engine = new Engine(sink, signal, { rootDirectory: root, videosDirectory: () => Promise.resolve(videos) });
  const parsed = parseArguments(args);
  assert.ok(parsed.options, parsed.error);
  let code: number;
  try {
    const options = parsed.options;
    code = options.command === "doctor"
      ? engine.doctor(options)
      : options.command === "probe"
      ? await engine.probe(options)
      : options.command === "update"
      ? await engine.update(options)
      : await engine.download(options);
  } catch (error) {
    sink.on({ type: "error", code: signal?.aborted ? "cancelled" : "processing_failed", message: (error as Error).message });
    code = 4;
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
  let argv = "";
  try {
    argv = Deno.readTextFileSync(argvLog);
  } catch { /* no tool was run */ }
  return { code, lines, out: lines.join("\n"), argv };
}

const has = (r: Result, needle: string) => r.lines.some((line) => line.includes(needle));
const indexOf = (r: Result, needle: string) => r.lines.findIndex((line) => line.includes(needle));
const q = jsonEscape; // paths as they appear inside JSON strings

function checkAllJson(r: Result) {
  assert.ok(r.lines.length > 0, "stdout is not empty");
  for (const line of r.lines) assert.ok(line.startsWith('{"type":"') && line.endsWith("}"), line);
}

function newDir(name: string) {
  const directory = join(tmp, `${name}${++counter}`);
  Deno.mkdirSync(directory, { recursive: true });
  return directory;
}

const entries = (directory: string) => [...Deno.readDirSync(directory)];
const noTempDirs = (directory: string) => !entries(directory).some((e) => e.name.startsWith(".mediadownloader-"));
const countFiles = (directory: string) => entries(directory).filter((e) => e.isFile).length;

// The argv log has one line per tool call: "<tool path> <args...>".
const toolLine = (r: Result, toolPath: string) => r.argv.split("\n").find((line) => line.startsWith(toolPath + " ")) ?? "";

const url = "https://example.com/v";

Deno.test("missing tools exit 3 with tool_missing", async () => {
  const out = newDir("out");
  const missing = { PATH: emptyPath, MEDIADOWNLOADER_YTDLP: join(tmp, "nonexistent", "yt-dlp") };
  let r = await run(["download", "--url", url, "--output", out], missing);
  assert.equal(r.code, 3);
  assert.ok(r.lines.length === 1 && r.lines[0].startsWith('{"type":"error","code":"tool_missing"'), r.out);

  r = await run(["download", "--url", url, "--output", out], {
    PATH: emptyPath,
    MEDIADOWNLOADER_FFMPEG: join(tmp, "nonexistent", "ffmpeg"),
  });
  assert.equal(r.code, 3);
  assert.ok(r.lines.length === 1 && r.lines[0].startsWith('{"type":"error","code":"tool_missing"'), r.out);
  assert.ok(countFiles(out) === 0 && noTempDirs(out), "missing ffmpeg: nothing created in output");

  r = await run(["probe", "--url", url], missing);
  assert.ok(r.code === 3 && has(r, '"code":"tool_missing"'), "probe without yt-dlp");
  r = await run(["update"], missing);
  assert.ok(r.code === 3 && has(r, '"code":"tool_missing"'), "update without yt-dlp");
});

Deno.test("doctor", async () => {
  let r = await run(["doctor"]);
  assert.equal(r.code, 0);
  checkAllJson(r);
  assert.equal(
    r.out,
    `{"type":"doctor","tools":{"yt-dlp":{"found":true,"path":"${q(tool("yt-dlp"))}"},` +
      `"ffmpeg":{"found":true,"path":"${q(tool("ffmpeg"))}"},"javascript-runtime":{"found":true,"path":"${q(tool("deno"))}"}}}`,
  );

  const nowhere = join(tmp, "nonexistent");
  r = await run(["doctor"], { PATH: emptyPath, MEDIADOWNLOADER_YTDLP: nowhere, MEDIADOWNLOADER_DENO: nowhere });
  assert.equal(r.code, 3);
  assert.ok(has(r, '"yt-dlp":{"found":false}'), "missing tool is found:false without path");
  assert.ok(has(r, '"javascript-runtime":{"found":false}'));
  assert.ok(!has(r, "ffprobe"));

  // JS runtime is optional without a YouTube URL, required with one.
  const noJs = { PATH: emptyPath, MEDIADOWNLOADER_DENO: nowhere, MEDIADOWNLOADER_NODE: nowhere };
  r = await run(["doctor"], noJs);
  assert.ok(r.code === 0 && has(r, '"javascript-runtime":{"found":false}'));
  assert.equal((await run(["doctor", "--url", url], noJs)).code, 0);
  assert.equal((await run(["doctor", "--url", "https://www.youtube.com/watch?v=abc"], noJs)).code, 3);
});

Deno.test("tool lookup: tools/bin under the root folder, then PATH", async () => {
  const name = windows ? "yt-dlp.exe" : "yt-dlp";
  const rootTools = join(root, "tools", "bin");
  Deno.mkdirSync(rootTools, { recursive: true });
  const onPath = newDir("onpath");
  for (const directory of [rootTools, onPath]) {
    Deno.writeTextFileSync(join(directory, name), "");
    if (!windows) Deno.chmodSync(join(directory, name), 0o755);
  }
  try {
    const unset = { MEDIADOWNLOADER_YTDLP: "", PATH: onPath };
    let r = await run(["doctor"], unset);
    assert.ok(has(r, `"yt-dlp":{"found":true,"path":"${q(join(rootTools, name))}"}`), r.out);
    Deno.removeSync(join(rootTools, name));
    r = await run(["doctor"], unset);
    assert.ok(has(r, `"yt-dlp":{"found":true,"path":"${q(join(onPath, name))}"}`), r.out);
  } finally {
    Deno.removeSync(join(root, "tools"), { recursive: true });
  }
});

Deno.test("probe", async () => {
  let r = await run(["probe", "--url", url]);
  assert.equal(r.code, 0);
  assert.equal(r.out, '{"type":"probe","data":{"id":"abc","title":"Fake Title","duration":10}}');
  r = await run(["probe", "--url", url], { FAKE_YTDLP_MODE: "fail" });
  assert.equal(r.code, 4);
  assert.ok(r.lines.length === 1 && r.lines[0].startsWith('{"type":"error","code":"probe_failed","message":"'), r.out);
});

Deno.test("plain download", async () => {
  const out = newDir("out");
  let r = await run(["download", "--url", url, "--output", out]);
  assert.equal(r.code, 0, r.out);
  checkAllJson(r);
  const file = join(out, "Fake Title [abc].mp4");
  assert.equal(r.lines[0], `{"type":"started","outputDirectory":"${q(out)}"}`);
  const p42 = indexOf(r, '{"type":"progress","stage":"download","percent":42.5}');
  const phase = indexOf(r, '{"type":"phase","stage":"inspection"}');
  const merge = indexOf(r, '{"type":"phase","stage":"merge"}');
  assert.ok(phase === 1 && phase < p42 && p42 < merge, r.out);
  assert.ok(!has(r, "__MD_PROGRESS__") && !has(r, "__MD_POST__") && !has(r, "__MD_DL__") && !has(r, "__MD_FILE__"));
  assert.ok(has(r, '{"type":"progress","stage":"download","percent":0.0}'));
  assert.ok(has(r, '{"type":"log","level":"info","message":"[info] abc: Downloading 1 format(s)"}'));
  assert.ok(!has(r, "[download] Destination:"));
  assert.ok(!has(r, '"encodingPlan"'));
  assert.equal(r.lines.at(-2), '{"type":"progress","stage":"download","percent":100.0}');
  assert.equal(r.lines.at(-1), `{"type":"completed","path":"${q(file)}","bytes":2048}`);
  assert.equal(Deno.statSync(file).size, 2048);
  assert.ok(noTempDirs(out) && countFiles(out) === 1, "temp dir removed, only the final file remains");

  // Existing file: unique name "(2)"; --overwrite replaces; --title renames.
  r = await run(["download", "--url", url, "--output", out]);
  assert.ok(r.code === 0 && has(r, q(join(out, "Fake Title [abc] (2).mp4"))), r.out);
  r = await run(["download", "--url", url, "--output", out, "--overwrite"]);
  assert.ok(r.code === 0 && r.lines.at(-1)!.includes(`${q(file)}"`), r.out);
  r = await run(["download", "--url", url, "--output", out, "--title", "My: Clip?"]);
  assert.ok(r.code === 0 && r.lines.at(-1)!.includes(`${q(join(out, "My_ Clip_.mp4"))}","bytes"`), r.out);
  assert.ok(noTempDirs(out));
});

Deno.test("yt-dlp arguments, cookies, clip range, encode arguments", async () => {
  const out = newDir("out");
  const ytdlp = tool("yt-dlp"), ffmpeg = tool("ffmpeg");
  let r = await run(["download", "--url", url, "--output", out]);
  let y = toolLine(r, ytdlp);
  assert.ok(y.includes(" --progress ") && y.includes("--progress-template download:__MD_PROGRESS__:"), y);
  assert.ok(y.includes("--progress-template postprocess:__MD_POST__:"));
  assert.ok(y.includes(" --format bestvideo+bestaudio/best "));
  assert.ok(y.includes(" --merge-output-format mp4 "));
  assert.ok(y.includes(` --ffmpeg-location ${dirname(ffmpeg)} `), y);
  assert.ok(y.includes(` --js-runtimes deno:${tool("deno")} `), y);
  assert.ok(y.includes(" --newline --no-color --no-playlist --windows-filenames --no-overwrites "));
  assert.ok(y.includes(" --print after_move:__MD_FILE__:%(filepath)s"));
  assert.ok(!y.includes("--cookies-from-browser") && !y.includes("--download-sections"));
  assert.ok(y.endsWith(` ${url}`), "URL is the last yt-dlp argument");

  r = await run(["download", "--url", url, "--output", out, "--quality", "720", "--format", "mkv"]);
  y = toolLine(r, ytdlp);
  assert.ok(y.includes(" --format bestvideo[height<=720]+bestaudio/best[height<=720]/best "), y);
  assert.ok(y.includes(" --merge-output-format mkv "));

  const yt = "https://www.youtube.com/watch?v=abc";
  r = await run(["download", "--url", yt, "--output", out]);
  assert.ok(toolLine(r, ytdlp).includes(" --cookies-from-browser firefox "), "auto + YouTube gives firefox");
  r = await run(["download", "--url", "https://notyoutube.com.evil.example/v", "--output", out]);
  assert.ok(!toolLine(r, ytdlp).includes("--cookies-from-browser"), "look-alike host gets no cookies");
  r = await run(["download", "--url", url, "--output", out, "--cookies-from-browser", "Chrome"]);
  assert.ok(toolLine(r, ytdlp).includes(" --cookies-from-browser chrome "));
  r = await run(["probe", "--url", yt]);
  y = toolLine(r, ytdlp);
  assert.ok(y.includes("--dump-single-json --no-playlist --no-warnings --quiet") && y.includes(" --cookies-from-browser firefox "), y);
  r = await run(["probe", "--url", url, "--cookies-from-browser", "edge"]);
  assert.ok(toolLine(r, ytdlp).includes(" --cookies-from-browser edge "));
  r = await run(["download", "--url", "https://x.com/u/status/1", "--output", out]);
  assert.ok(toolLine(r, ytdlp).includes(" --playlist-items 1 "), "only the first video of a tweet");

  r = await run(["download", "--url", url, "--output", out, "--start-time", "10", "--end-time", "20"]);
  assert.ok(toolLine(r, ytdlp).includes(" --download-sections *10-20 --force-keyframes-at-cuts "), r.argv);
  assert.ok(r.code === 0 && r.lines.at(-1)!.endsWith('"bytes":2048}'));

  r = await run(["download", "--url", url, "--output", out, "--max-size-mb", "10", "--quality", "720"]);
  assert.ok(r.argv.includes(`${ffmpeg} -y -i `) && r.argv.includes(" -vf scale=-2:min(ih\\,720) "), r.argv);
  assert.ok(r.argv.includes(" -c:v libx264 ") && r.argv.includes(" -pass:v 1 ") && r.argv.includes(" -pass:v 2 "));
  r = await run(["download", "--url", url, "--output", out, "--max-size-mb", "10"]);
  assert.ok(!r.argv.includes("scale="));

  // Clip + size limit: the plan uses the duration ffmpeg reports for the downloaded file.
  r = await run(
    ["download", "--url", url, "--output", out, "--max-size-mb", "10", "--start-time", "10", "--end-time", "15"],
    { FAKE_DURATION: "5", FAKE_ENCODED_BYTES: "4096" },
  );
  assert.equal(r.code, 0, r.out);
  assert.ok(has(r, '{"type":"encodingPlan","durationSeconds":5.000000,'), r.out);
  assert.ok(toolLine(r, ytdlp).includes(" --download-sections *10-15 "));
});

Deno.test("encode to size", async () => {
  const out = newDir("out");
  const env = { FAKE_DURATION: "10", FAKE_ENCODED_BYTES: "4096", FAKE_SOURCE_BYTES: "100000" };
  let r = await run(["download", "--url", url, "--output", out, "--max-size-mb", "10"], env);
  assert.equal(r.code, 0, r.out);
  checkAllJson(r);
  const plan = indexOf(r, '{"type":"encodingPlan","durationSeconds":10.000000,"videoKbps":8008,"audioKbps":128}');
  const p1 = indexOf(r, '{"type":"progress","stage":"encode","percent":25.0,"pass":1}');
  const p2 = indexOf(r, '{"type":"progress","stage":"encode","percent":75.0,"pass":2}');
  const done = indexOf(r, '{"type":"completed"');
  assert.ok(plan > 0 && plan < p1 && p1 < p2 && p2 < done, r.out);
  assert.ok(has(r, '"stage":"encode","percent":0.0,"pass":1') && has(r, '"stage":"encode","percent":50.0,"pass":2'));
  assert.equal(r.lines.at(-2), '{"type":"progress","stage":"encode","percent":100.0,"pass":2}');
  assert.equal(r.lines.at(-1), `{"type":"completed","path":"${q(join(out, "Fake Title [abc].mp4"))}","bytes":4096}`);
  assert.ok(!has(r, "out_time_us"));
  assert.ok(noTempDirs(out) && countFiles(out) === 1);
  assert.ok(!r.argv.includes("-threads"), "default encode has no -threads");

  const low = await run(["download", "--url", url, "--output", newDir("out"), "--max-size-mb", "10", "--low-resources"], env);
  assert.equal(low.code, 0, low.out);
  assert.ok(low.argv.includes(" -threads 2 ") && low.argv.includes("-passlogfile"), low.argv);

  const out2 = newDir("out");
  r = await run(["download", "--url", url, "--output", out2, "--max-size-mb", "1"], { FAKE_DURATION: "100000" });
  assert.equal(r.code, 4);
  assert.equal(r.lines.at(-1), '{"type":"error","code":"size_unreachable","message":"La durée est trop importante pour la taille demandée"}');
  assert.ok(!has(r, "encodingPlan") && noTempDirs(out2) && countFiles(out2) === 0);

  const out3 = newDir("out");
  r = await run(["download", "--url", url, "--output", out3, "--max-size-mb", "1"], { FAKE_DURATION: "10", FAKE_ENCODED_BYTES: "2000000" });
  assert.equal(r.code, 4);
  assert.ok(r.lines.at(-1)!.startsWith('{"type":"error","code":"size_exceeded"'), r.out);
  assert.ok(has(r, '"encodingPlan"') && !has(r, '"completed"') && noTempDirs(out3) && countFiles(out3) === 0);
});

Deno.test("download failure and processing failures exit 4 and leave nothing behind", async () => {
  const out = newDir("out");
  let r = await run(["download", "--url", url, "--output", out], { FAKE_YTDLP_MODE: "fail" });
  assert.equal(r.code, 4);
  assert.ok(r.lines[0].startsWith('{"type":"started"'));
  assert.ok(r.lines.at(-1)!.startsWith('{"type":"error","code":"download_failed","message":"') && has(r, "boom"), r.out);
  assert.ok(noTempDirs(out) && countFiles(out) === 0);

  const cases: [Record<string, string>, string][] = [
    [{ FAKE_FFMPEG_MODE: "fail" }, "FFmpeg a échoué pendant l'encodage passe 1"],
    [{ FAKE_FFMPEG_MODE: "nofile" }, "FFmpeg n'a pas produit le fichier attendu"],
    [{ FAKE_PROBE_OUTPUT: "abc" }, "FFmpeg n'a pas pu déterminer la durée de la vidéo"],
    [{ FAKE_PROBE_OUTPUT: "  Duration: 00:00:00.00, start: 0" }, "FFmpeg n'a pas pu déterminer la durée de la vidéo"],
  ];
  for (const [env, message] of cases) {
    const dir = newDir("out");
    r = await run(["download", "--url", url, "--output", dir, "--max-size-mb", "10"], env);
    assert.equal(r.code, 4);
    assert.equal(r.lines.at(-1), `{"type":"error","code":"processing_failed","message":"${q(message)}"}`);
    assert.ok(noTempDirs(dir) && countFiles(dir) === 0);
  }
});

Deno.test("JavaScript runtime warning only for YouTube", async () => {
  const nowhere = join(tmp, "nonexistent");
  // PATH holds only head (needed by the POSIX fakes), so no real deno/node can be found.
  const bin = newDir("bin");
  const head = ["/usr/bin/head", "/bin/head"].find(exists);
  if (!windows && head) Deno.symlinkSync(head, join(bin, "head"));
  const noJs = { PATH: bin, MEDIADOWNLOADER_DENO: nowhere, MEDIADOWNLOADER_NODE: nowhere };
  let r = await run(["download", "--url", url, "--output", newDir("out")], noJs);
  assert.ok(r.code === 0 && !has(r, "Aucun runtime JavaScript"), r.out);
  r = await run(["download", "--url", "https://www.youtube.com/watch?v=abc", "--output", newDir("out")], noJs);
  assert.equal(r.code, 0, r.out);
  assert.ok(has(r, '{"type":"log","level":"warning","message":"Aucun runtime JavaScript compatible n\'a été trouvé ; certains liens YouTube peuvent échouer."}'));
  assert.ok(!toolLine(r, tool("yt-dlp")).includes("--js-runtimes"));
});

Deno.test("explicit tool options win over the environment", async () => {
  const alt = newDir("alt");
  for (const name of ["yt-dlp", "ffmpeg"]) {
    for (const suffix of windows ? [".cmd", ".ts"] : [""]) Deno.copyFileSync(join(fakeTools, name + suffix), join(alt, name + suffix));
  }
  const altTool = (name: string) => join(alt, windows ? `${name}.cmd` : name);
  const r = await run([
    "download", "--url", url, "--output", newDir("out"), "--max-size-mb", "10",
    "--yt-dlp", altTool("yt-dlp"), "--ffmpeg", altTool("ffmpeg"),
  ]);
  assert.equal(r.code, 0, r.out);
  for (const name of ["yt-dlp", "ffmpeg"]) {
    assert.ok(toolLine(r, altTool(name)) !== "", `--${name} selects the tool`);
    assert.equal(toolLine(r, tool(name)), "", `env ${name} is not used when the option is given`);
  }
  assert.ok(toolLine(r, altTool("yt-dlp")).includes(` --ffmpeg-location ${alt} `));
  const doctor = await run(["doctor", "--yt-dlp", altTool("yt-dlp")]);
  assert.ok(has(doctor, `"yt-dlp":{"found":true,"path":"${q(altTool("yt-dlp"))}"}`), doctor.out);
  const probe = await run(["probe", "--url", url, "--yt-dlp", altTool("yt-dlp")]);
  assert.ok(toolLine(probe, altTool("yt-dlp")) !== "");
});

Deno.test("orphaned temporary directories are cleaned before started", async () => {
  const out = newDir("out");
  const dead = join(out, ".mediadownloader-999999999-1");
  const live = join(out, `.mediadownloader-${Deno.pid}-1`);
  const unrelated = join(out, ".mediadownloader-notapid-1");
  for (const directory of [dead, live, unrelated]) {
    Deno.mkdirSync(directory);
    Deno.writeTextFileSync(join(directory, "x.part"), "x");
  }
  const r = await run(["download", "--url", url, "--output", out]);
  assert.equal(r.code, 0, r.out);
  assert.ok(!exists(dead) && exists(live) && exists(unrelated));
  const log = indexOf(r, `{"type":"log","level":"info","message":"Dossier temporaire orphelin supprimé : ${q(dead)}"}`);
  assert.ok(log >= 0 && log < indexOf(r, '"type":"started"'), r.out);
});

function exists(path: string) {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

Deno.test("default output folder and fallback when --output is unusable", async () => {
  let r = await run(["download", "--url", url]);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.lines[0], `{"type":"started","outputDirectory":"${q(videos)}"}`);
  assert.ok(exists(join(videos, "Fake Title [abc].mp4")) && noTempDirs(videos));

  const bad = join(tmp, "not-a-dir.txt");
  Deno.writeTextFileSync(bad, "x");
  r = await run(["download", "--url", url, "--output", bad]);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes(
    `"level":"warning","message":"Dossier de sortie inutilisable (${q(bad)}), enregistrement dans le dossier Vidéos : ${q(videos)}"`,
  ), r.out);
  assert.ok(has(r, `{"type":"started","outputDirectory":"${q(videos)}"}`));
});

Deno.test("relative tool paths from the environment are made absolute (tools run in the temp folder)", async () => {
  const env = {
    MEDIADOWNLOADER_YTDLP: relative(Deno.cwd(), tool("yt-dlp")),
    MEDIADOWNLOADER_FFMPEG: relative(Deno.cwd(), tool("ffmpeg")),
    FAKE_ENCODED_BYTES: "4096",
  };
  const doctor = await run(["doctor"], env);
  assert.ok(has(doctor, `"yt-dlp":{"found":true,"path":"${q(tool("yt-dlp"))}"}`), doctor.out);
  const out = newDir("out");
  const r = await run(["download", "--url", url, "--output", out, "--max-size-mb", "10"], env);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.lines.at(-1), `{"type":"completed","path":"${q(join(out, "Fake Title [abc].mp4"))}","bytes":4096}`);
});

Deno.test("an output folder containing % works (escaped in the yt-dlp template)", async () => {
  const out = newDir("100% x");
  const r = await run(["download", "--url", url, "--output", out]);
  assert.equal(r.code, 0, r.out);
  assert.ok(toolLine(r, tool("yt-dlp")).includes(` --output ${join(out, ".mediadownloader-").replaceAll("%", "%%")}`), r.argv);
  assert.equal(r.lines.at(-1), `{"type":"completed","path":"${q(join(out, "Fake Title [abc].mp4"))}","bytes":2048}`);
  assert.ok(noTempDirs(out) && countFiles(out) === 1);
});

Deno.test("update", async () => {
  let r = await run(["update"]);
  assert.equal(r.code, 0);
  checkAllJson(r);
  assert.ok(has(r, '{"type":"log","level":"info","message":"yt-dlp is up to date"}'), r.out);
  assert.ok(r.argv.includes(`${tool("yt-dlp")} -U`), r.argv);
  r = await run(["update"], { FAKE_YTDLP_MODE: "fail" });
  assert.ok(r.code === 4 && has(r, '"code":"update_failed"'), r.out);
});

async function cancelWhen(pidFile: string, controller: AbortController) {
  while (!exists(pidFile) || Deno.readTextFileSync(pidFile).trim() === "") await new Promise((r) => setTimeout(r, 50));
  controller.abort();
  return Number(Deno.readTextFileSync(pidFile));
}

async function gone(pid: number) {
  for (let i = 0; i < 40 && isProcessRunning(pid); ++i) await new Promise((r) => setTimeout(r, 50));
  return !isProcessRunning(pid);
}

Deno.test("cancel during download: exit 4, tool tree killed, nothing left", async () => {
  const out = newDir("out");
  const pidFile = join(tmp, `ytdlp${++counter}.pid`);
  const controller = new AbortController();
  const started = Date.now();
  const [r, pid] = await Promise.all([
    run(["download", "--url", url, "--output", out], { FAKE_YTDLP_MODE: "hang", FAKE_YTDLP_PID_FILE: pidFile }, controller.signal),
    cancelWhen(pidFile, controller),
  ]);
  assert.equal(r.code, 4);
  assert.equal(r.lines.at(-1), '{"type":"error","code":"cancelled","message":"Téléchargement annulé"}');
  assert.ok(Date.now() - started < 15000);
  assert.ok(await gone(pid), "the hanging yt-dlp is dead");
  assert.ok(noTempDirs(out) && countFiles(out) === 0, r.out);
});

Deno.test("cancel during encode: exit 4 cancelled, ffmpeg killed, nothing left", async () => {
  const out = newDir("out");
  const pidFile = join(tmp, `ffmpeg${++counter}.pid`);
  const controller = new AbortController();
  const started = Date.now();
  const [r, pid] = await Promise.all([
    run(
      ["download", "--url", url, "--output", out, "--max-size-mb", "10"],
      { FAKE_FFMPEG_MODE: "hang", FAKE_FFMPEG_PID_FILE: pidFile },
      controller.signal,
    ),
    cancelWhen(pidFile, controller),
  ]);
  assert.equal(r.code, 4);
  assert.equal(r.lines.at(-1), '{"type":"error","code":"cancelled","message":"Traitement annulé"}');
  assert.ok(Date.now() - started < 15000);
  assert.ok(await gone(pid), "the hanging ffmpeg is dead");
  assert.ok(noTempDirs(out) && countFiles(out) === 0, r.out);
});

Deno.test("serializeEvent number formatting", () => {
  assert.equal(serializeEvent({ type: "progress", stage: "download", percent: 42.5 }), '{"type":"progress","stage":"download","percent":42.5}');
  assert.equal(serializeEvent({ type: "progress", stage: "encode", percent: 0, pass: 1 }), '{"type":"progress","stage":"encode","percent":0.0,"pass":1}');
  assert.equal(
    serializeEvent({ type: "encodingPlan", durationSeconds: 1.5, videoKbps: 10, audioKbps: 48 }),
    '{"type":"encodingPlan","durationSeconds":1.500000,"videoKbps":10,"audioKbps":48}',
  );
  assert.equal(serializeEvent({ type: "log", level: "info", message: 'a"\n' }), '{"type":"log","level":"info","message":"a\\"\\n"}');
});

globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch { /* best effort */ }
});
