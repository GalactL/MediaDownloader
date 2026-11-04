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
        "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x1080:rate=25:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-c:a", "aac", "-shortest", input,
      ]);
      assert.equal(gen.exitCode, 0, gen.output);
      const plan = calculateEncodePlan(3, 3)!;
      for (const [quality, lowResources] of [["best", false], ["720", false], ["720", true]] as const) {
        const output = join(dir, `out-${quality}-${lowResources}.mp4`);
        const passLog = join(dir, `pass-${quality}-${lowResources}`);
        for (const pass of [1, 2] as const) {
          const args = buildEncodeArguments(input, output, passLog, plan.videoKbps, plan.audioKbps, quality, pass, lowResources);
          const r = await run(args);
          assert.equal(r.exitCode, 0, `${quality}/${lowResources} pass ${pass}: ${r.output}`);
        }
        // 10 % slack: x264 rate control is only approximate on a 3 s clip (the 3 % container reserve covers long ones).
        assert.ok(Deno.statSync(output).size <= plan.targetBytes * 1.1, `${quality}/${lowResources}: ${Deno.statSync(output).size} > ${plan.targetBytes}`);
        const info = await run(["-hide_banner", "-i", output]); // exits 1 (no output file) but lists the streams
        const video = info.output.match(/Stream #0:\d.*: Video.*?, (\d+)x(\d+)/);
        assert.ok(video, info.output);
        assert.match(info.output, /Stream #0:\d.*: Audio/);
        if (quality === "720") assert.ok(Number(video[2]) <= 720, `height ${video[2]}`);
        else assert.equal(Number(video[2]), 1080);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
