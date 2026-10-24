"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const lib = require("../lib.js");

test("parseTime", () => {
  assert.equal(lib.parseTime(""), null);
  assert.equal(lib.parseTime("90"), 90);
  assert.equal(lib.parseTime("1:30"), 90);
  assert.equal(lib.parseTime("1:02:03"), 3723);
  assert.equal(lib.parseTime("1.5"), 1.5);
  for (const bad of ["-1", "abc", "1:2:3:4", "1:999", "1e3"]) assert.ok(Number.isNaN(lib.parseTime(bad)), bad);
});

test("validateRange mirrors the host", () => {
  assert.equal(lib.validateRange(null, null), "");
  assert.equal(lib.validateRange(0, 10), "");
  assert.notEqual(lib.validateRange(5, null), "");
  assert.notEqual(lib.validateRange(null, 5), "");
  assert.notEqual(lib.validateRange(10, 10), "");
  assert.notEqual(lib.validateRange(10, 5), "");
  assert.notEqual(lib.validateRange(NaN, 5), "");
});

test("parseMaxSize", () => {
  assert.equal(lib.parseMaxSize(""), null);
  assert.equal(lib.parseMaxSize("10"), 10);
  assert.equal(lib.parseMaxSize("2,5"), 2.5);
  for (const bad of ["0", "-3", "x"]) assert.ok(Number.isNaN(lib.parseMaxSize(bad)), bad);
});

test("buildDownloadRequest", () => {
  assert.deepEqual(lib.buildDownloadRequest({ url: "u", quality: "best", maxSizeMb: null, start: null, end: null }),
    { type: "download", url: "u" });
  assert.deepEqual(lib.buildDownloadRequest({ url: "u", quality: "720", maxSizeMb: 10, start: 0, end: 30 }),
    { type: "download", url: "u", quality: "720", maxSizeMb: 10, startTime: 0, endTime: 30 });
});

test("qualityOptions", () => {
  assert.deepEqual(lib.qualityOptions([360, 1080, 720, 720]).map((o) => o.value), ["best", "1080", "720", "360"]);
  assert.deepEqual(lib.qualityOptions(undefined).map((o) => o.value), ["best"]);
});

test("isVideoPage and canonicalUrl", () => {
  assert.ok(lib.isVideoPage("https://www.youtube.com/watch?v=abc&list=x"));
  assert.ok(lib.isVideoPage("https://www.youtube.com/shorts/abc"));
  assert.ok(lib.isVideoPage("https://youtu.be/abc"));
  assert.ok(!lib.isVideoPage("https://www.youtube.com/"));
  assert.ok(!lib.isVideoPage("https://www.youtube.com/results?search_query=a"));
  assert.ok(!lib.isVideoPage("not a url"));
  assert.equal(lib.canonicalUrl("https://www.youtube.com/watch?v=abc&list=x&t=5"), "https://www.youtube.com/watch?v=abc");
  assert.equal(lib.canonicalUrl("https://youtu.be/abc"), "https://youtu.be/abc");
});

test("progressText", () => {
  assert.equal(lib.progressText("download", 41.6), "Téléchargement : 42 %");
  assert.equal(lib.progressText("encode", 10, 2), "Encodage (passe 2) : 10 %");
});
