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
  assert.equal(lib.parseMaxSize("20"), 20);
  for (const bad of ["0", "-3", "x", "20.5", "100"]) assert.ok(Number.isNaN(lib.parseMaxSize(bad)), bad);
});

test("buildDownloadRequest", () => {
  assert.deepEqual(lib.buildDownloadRequest({ url: "u", quality: "best", maxSizeMb: null, start: null, end: null }),
    { type: "download", url: "u" });
  assert.deepEqual(lib.buildDownloadRequest({ url: "u", quality: "720", maxSizeMb: 10, start: 0, end: 30 }),
    { type: "download", url: "u", quality: "720", maxSizeMb: 10, startTime: 0, endTime: 30 });
});

test("2K and 4K are always offered", () => {
  const options = lib.qualityOptions([720]);
  assert.deepEqual(options.map((o) => o.value), ["best", "2160", "1440", "720"]);
  assert.equal(options[1].label, "4K (2160p)");
});

test("custom name and errorText", () => {
  assert.equal(lib.buildDownloadRequest({ url: "u", name: " Mon clip " }).title, "Mon clip");
  assert.ok(!("title" in lib.buildDownloadRequest({ url: "u", name: "  " })));
  assert.equal(lib.errorText("busy"), "Un téléchargement est déjà en cours.");
  assert.match(lib.errorText("invalid_message", "Type de message inconnu : openFolder"), /trop ancien/);
  assert.equal(lib.errorText("dependency_missing", "Outil manquant."), "Outil manquant.");
});

test("qualityOptions", () => {
  assert.deepEqual(lib.qualityOptions([360, 1080, 720, 720]).map((o) => o.value), ["best", "2160", "1440", "1080", "720", "360"]);
  assert.deepEqual(lib.qualityOptions(undefined).map((o) => o.value), ["best", "2160", "1440"]);
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

test("normalizeSettings", () => {
  assert.deepEqual(lib.normalizeSettings(undefined), lib.DEFAULT_SETTINGS);
  assert.deepEqual(lib.normalizeSettings({ outputDirectory: "  /v  ", theme: "light", buttonMode: "icon" }),
    { outputDirectory: "/v", theme: "light", buttonMode: "icon" });
  assert.deepEqual(lib.normalizeSettings({ outputDirectory: 5, theme: "x", buttonMode: "y" }), lib.DEFAULT_SETTINGS);
});

test("validateOutputDirectory", () => {
  for (const ok of ["", "  ", "C:\\Users\\Moi\\Videos", "d:/Videos", "\\\\srv\\share\\v", "/home/u/Videos"])
    assert.equal(lib.validateOutputDirectory(ok), "", ok);
  for (const bad of ["Videos", "C:", "C:Videos", "\\\\srv", "C:\\a|b", "C:\\a?", "/a\u0000b", "./x"])
    assert.notEqual(lib.validateOutputDirectory(bad), "", bad);
  assert.equal(lib.validateOutputDirectory("x"), "Saisissez un chemin absolu, par exemple C:\\Users\\Moi\\Videos.");
});

test("outputDirectory in request and error text", () => {
  assert.equal(lib.buildDownloadRequest({ url: "u", outputDirectory: " /v " }).outputDirectory, "/v");
  assert.ok(!("outputDirectory" in lib.buildDownloadRequest({ url: "u", outputDirectory: "  " })));
  assert.match(lib.errorText("invalid_output_directory"), /réglages/);
});
