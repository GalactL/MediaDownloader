"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
// plan.js only sets globalThis.MDLitePlan outside Node, where engine.js reads it.
globalThis.MDLitePlan = require("../lite/plan.js");
const load = () => import("../lite/engine.js");

test("liteSite: YouTube, TikTok, X only, no look-alikes", async () => {
  const { liteSite } = await load();
  for (const [url, name] of [
    ["https://www.youtube.com/watch?v=x", "youtube"], ["https://youtu.be/x", "youtube"], ["https://m.youtube.com/shorts/x", "youtube"],
    ["https://www.tiktok.com/@a/video/1", "tiktok"], ["https://x.com/a/status/1", "x"], ["https://twitter.com/a/status/1", "x"],
  ]) assert.equal(liteSite(url)?.name, name, url);
  for (const url of ["https://www.instagram.com/p/x", "https://youtube.com.evil.example/x", "https://notyoutube.com/x",
    "https://evilx.com/a", "ftp://youtube.com/x", "not a url"]) assert.equal(liteSite(url), null, url);
});

test("resolveClip", async () => {
  const { resolveClip } = await load();
  assert.deepEqual(resolveClip(null, null, 19), { start: null, end: null, seconds: 19 });
  assert.equal(resolveClip(null, null, null), null);
  assert.deepEqual(resolveClip(120, 150, 888), { start: 120, end: 150, seconds: 30 });
  assert.deepEqual(resolveClip(0, 30, 10.5), { start: null, end: null, seconds: 10.5 }); // shorter video: whole
  assert.deepEqual(resolveClip(5, 30, 10), { start: 5, end: 10, seconds: 5 });
  assert.equal(resolveClip(20, 30, 10), null);
});

test("checkMemory: 2 x estimate against the budget", async () => {
  const { checkMemory } = await load();
  assert.deepEqual(checkMemory([{ tbr: 8192 }, { tbr: null }], 10, 600), { ok: true, estimateMb: 10 });
  assert.equal(checkMemory([{ tbr: 8192 }], 400, 600).ok, false); // 400 MB intermediate
  assert.equal(checkMemory([{}], 3600, 600).ok, true); // unknown bitrate: allowed
});

test("error text classification and redaction", async () => {
  const { isOomText, isTimeoutText, redactUrls } = await load();
  assert.ok(isOomText("x264 [error]: malloc of size 207289600 failed"));
  assert.ok(!isOomText("HTTP Error 403"));
  assert.ok(isTimeoutText("DownloadError: Unable to download webpage: TimeoutError"));
  assert.ok(!isTimeoutText("Your IP address is blocked"));
  assert.equal(redactUrls("HTTP 403 for https://rr1.googlevideo.com/videoplayback?sig=SECRET&x=1 now"), "HTTP 403 for rr1.googlevideo.com/… now");
});

test("runLite rejects unsupported sites before any work", async () => {
  const { runLite } = await load();
  await assert.rejects(runLite({ url: "https://www.instagram.com/p/x", maxSizeMb: 10 }), { code: "unsupported_site" });
  await assert.rejects(runLite({ url: "https://x.com/a/status/1", maxSizeMb: 0 }), { code: "invalid_arguments" });
  await assert.rejects(runLite({ url: "https://x.com/a/status/1", maxSizeMb: 10, startSec: 5 }), { code: "invalid_arguments" });
});
