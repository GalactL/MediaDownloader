// Windows twin of the POSIX fake `yt-dlp` (same behaviour and env variables), started by yt-dlp.cmd.
import { dirname, join } from "node:path";

const env = (name: string) => Deno.env.get(name) ?? "";
const args = Deno.args;
if (env("FAKE_ARGV_LOG")) Deno.writeTextFileSync(env("FAKE_ARGV_LOG"), [env("FAKE_SELF"), ...args].join(" ") + "\n", { append: true });
const mode = env("FAKE_YTDLP_MODE") || "ok";
if (args[0] === "-U") {
  if (mode === "fail") {
    console.log("ERROR: [fake] unable to update");
    Deno.exit(1);
  }
  console.log("Latest version: 2099.01.01\nyt-dlp is up to date");
  Deno.exit(0);
}
const out = args[args.lastIndexOf("--output") + 1] ?? "";
if (mode === "fail") {
  console.log("ERROR: [fake] boom: unable to download");
  Deno.exit(1);
}
if (mode === "hang") {
  if (env("FAKE_YTDLP_PID_FILE")) Deno.writeTextFileSync(env("FAKE_YTDLP_PID_FILE"), `${Deno.pid}\n`);
  await new Promise((resolve) => setTimeout(resolve, 30000));
  Deno.exit(0);
}
if (args.includes("--dump-single-json")) {
  console.log(env("FAKE_YTDLP_PROBE_JSON") || '{"id":"abc","title":"Fake Title","duration":10}');
  Deno.exit(0);
}
// Like yt-dlp, "%%" in the template is a literal "%".
const file = join(dirname(out).replaceAll("%%", "%"), "Fake Title [abc].mp4");
console.log(`[info] abc: Downloading 1 format(s)
[download] Destination: ${file}
__MD_DL__:abc
__MD_PROGRESS__:downloading|0|1000|NA|NA|NA|18
__MD_PROGRESS__:downloading|500|1000|NA|NA|NA|18
__MD_PROGRESS__:finished|1000|1000|NA|NA|NA|18
__MD_POST__:started|Merger
__MD_POST__:finished|Merger`);
Deno.writeFileSync(file, new Uint8Array(Number(env("FAKE_SOURCE_BYTES") || 2048)));
console.log(`__MD_FILE__:${file}`);
