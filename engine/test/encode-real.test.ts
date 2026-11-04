// Opt-in regression test: the exact two-pass argument lists against a REAL ffmpeg (a bare `-pass 2` fails on
// recent FFmpeg builds with "Error reading log file ... for pass-2 encoding"). Ignored when no ffmpeg is found.
// Run: MEDIADOWNLOADER_FFMPEG=<path> deno test -A engine/test/encode-real.test.ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { buildEncodeArguments, calculateEncodePlan } from "../core.ts";
import { runProcess } from "../process.ts";

const root = join(import.meta.dirname!, "..", "..");
const exe = Deno.build.os === "windows" ? "ffmpeg.exe" : "ffmpeg";
const candidates = [Deno.env.get("MEDIADOWNLOADER_FFMPEG"), join(root, "tools", "bin", exe)];
const ffmpeg = candidates.find((p) => p && (() => { try { return Deno.statSync(p).isFile; } catch { return false; } })());

Deno.test({
  name: "real ffmpeg: two-pass encode succeeds, within target, with video and audio",
  ignore: !ffmpeg,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "md-encode-real-" });
    try {
      const input = join(dir, "in.mp4");
      const output = join(dir, "out.mp4");
      const run = (args: string[]) => runProcess({ command: ffmpeg!, args, cwd: dir });
      const gen = await run([
        "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest", input,
      ]);
      assert.equal(gen.exitCode, 0, gen.output);
      const plan = calculateEncodePlan(3, 1)!;
      const passLog = join(dir, "ffmpeg-pass");
      for (const pass of [1, 2] as const) {
        const args = buildEncodeArguments(input, output, passLog, plan.videoKbps, plan.audioKbps, "best", pass, false);
        const r = await run(args);
        assert.equal(r.exitCode, 0, `pass ${pass}: ${r.output}`);
      }
      assert.ok(Deno.statSync(output).size <= plan.targetBytes, "output within the planned target");
      const info = await run(["-hide_banner", "-i", output]); // exits 1 (no output file) but lists the streams
      assert.match(info.output, /Stream #0:\d.*: Video/);
      assert.match(info.output, /Stream #0:\d.*: Audio/);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
