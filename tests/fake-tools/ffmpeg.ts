// Windows twin of the POSIX fake `ffmpeg` (same behaviour and env variables), started by ffmpeg.cmd.
const env = (name: string) => Deno.env.get(name) ?? "";
const args = Deno.args;
if (env("FAKE_ARGV_LOG")) Deno.writeTextFileSync(env("FAKE_ARGV_LOG"), [env("FAKE_SELF"), ...args].join(" ") + "\n", { append: true });
if (args[0] === "-hide_banner" && args[1] === "-i") {
  const d = Number(env("FAKE_DURATION") || 10);
  const two = (n: number) => String(Math.floor(n)).padStart(2, "0");
  console.log(`Input #0, mov,mp4, from '${args[2]}':`);
  console.log(env("FAKE_PROBE_OUTPUT") ||
    `  Duration: ${two(d / 3600)}:${two((d % 3600) / 60)}:${two(d % 60)}.00, start: 0.000000, bitrate: 800 kb/s`);
  console.log("At least one output file must be specified");
  Deno.exit(1);
}
if (args.includes("-pass")) { console.error("Error reading log file 'ffmpeg-pass-1.log' for pass-2 encoding (bare -pass; use -pass:v)"); Deno.exit(1); }
const pass = args[args.lastIndexOf("-pass:v") + 1];
const mode = env("FAKE_FFMPEG_MODE");
if (mode === "fail") Deno.exit(1);
if (mode === "hang") {
  if (env("FAKE_FFMPEG_PID_FILE")) Deno.writeTextFileSync(env("FAKE_FFMPEG_PID_FILE"), `${Deno.pid}\n`);
  await new Promise((resolve) => setTimeout(resolve, 30000));
  Deno.exit(0);
}
console.log("out_time_us=5000000\nprogress=continue");
if (pass === "2" && mode !== "nofile") Deno.writeFileSync(args.at(-1)!, new Uint8Array(Number(env("FAKE_ENCODED_BYTES") || 1024)));
console.log("out_time_us=N/A\nprogress=end");
