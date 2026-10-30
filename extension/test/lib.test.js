"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("../lib.js");
const i18n = require("../i18n.js");
const errorText = (language, code) => i18n.translate(language, lib.errorKey(code));

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
  assert.equal(lib.validateRange(5, null), "error.rangeTogether");
  assert.equal(lib.validateRange(null, 5), "error.rangeTogether");
  assert.equal(lib.validateRange(10, 10), "error.rangeOrder");
  assert.equal(lib.validateRange(10, 5), "error.rangeOrder");
  assert.equal(lib.validateRange(NaN, 5), "error.timeInvalid");
});

test("parseMaxSize", () => {
  assert.equal(lib.parseMaxSize(""), null);
  assert.equal(lib.parseMaxSize("10"), 10);
  assert.equal(lib.parseMaxSize("2,5"), 2.5);
  assert.equal(lib.parseMaxSize("20"), 20);
  assert.equal(lib.parseMaxSize("100"), 100);
  for (const bad of ["0", "-3", "x", "1e400", "9".repeat(400)]) assert.ok(Number.isNaN(lib.parseMaxSize(bad)), bad);
});

test("buildDownloadRequest", () => {
  assert.deepEqual(lib.buildDownloadRequest({ url: "u", quality: "best", maxSizeMb: null, start: null, end: null }),
    { type: "download", url: "u" });
  assert.deepEqual(lib.buildDownloadRequest({ url: "u", quality: "720", maxSizeMb: 10, start: 0, end: 30 }),
    { type: "download", url: "u", quality: "720", maxSizeMb: 10, startTime: 0, endTime: 30 });
});

test("2K and 4K are always offered", () => {
  const options = lib.qualityOptions([720], "fr");
  assert.deepEqual(options.map((o) => o.value), ["best", "2160", "1440", "720"]);
  assert.equal(options[1].label, "4K (2160p)");
  assert.equal(options[0].label, "Meilleure qualité");
  assert.equal(lib.qualityOptions([], "en")[0].label, "Best quality");
});

test("custom name and errorText", () => {
  assert.equal(lib.buildDownloadRequest({ url: "u", name: " Mon clip " }).title, "Mon clip");
  assert.ok(!("title" in lib.buildDownloadRequest({ url: "u", name: "  " })));
  assert.equal(errorText("fr", "busy"), "Un téléchargement est déjà en cours.");
  assert.equal(errorText("en", "busy"), "A download is already in progress.");
  assert.match(errorText("fr", "invalid_message"), /trop ancien/);
  // Unknown codes never leak the engine's raw text: they get the generic message.
  assert.equal(errorText("fr", "dependency_missing"), "Une erreur est survenue.");
  assert.equal(lib.errorKey("size_exceeded"), "error.size_exceeded");
});

test("host_disconnected: dedicated install notice with steps and release link", () => {
  assert.equal(lib.errorKey("host_disconnected"), "error.host_disconnected");
  const text = errorText("fr", "host_disconnected");
  assert.match(text, /^Programme MediaDownloader non installé\./);
  assert.match(text, /Installer\.bat/);
  assert.match(text, /install\.sh/);
  assert.match(text, /Relancez Firefox/);
  assert.equal(lib.INSTALL_URL, "https://github.com/GalactL/MediaDownloader/releases/latest");
  assert.match(errorText("en", "host_disconnected"), /^MediaDownloader program not installed\./);
});

test("qualityOptions", () => {
  assert.deepEqual(lib.qualityOptions([360, 1080, 720, 720], "fr").map((o) => o.value), ["best", "2160", "1440", "1080", "720", "360"]);
  assert.deepEqual(lib.qualityOptions(undefined, "fr").map((o) => o.value), ["best", "2160", "1440"]);
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
  assert.equal(lib.canonicalUrl("https://www.youtube.com/shorts/abc"), "https://www.youtube.com/shorts/abc");
});

test("phase labels", () => {
  assert.equal(lib.phaseLabel("fr", "inspection"), "Inspection");
  assert.equal(lib.phaseLabel("fr", "download"), "Téléchargement");
  assert.equal(lib.phaseLabel("fr", "merge"), "Assemblage");
  assert.equal(lib.phaseLabel("fr", "encode", 1), "Encodage (passe 1/2)");
  assert.equal(lib.phaseLabel("en", "encode", 2), "Encoding (pass 2/2)");
  assert.equal(lib.phaseLabel("en", "merge"), "Merging");
  assert.equal(lib.phaseLabel("fr", "future-stage"), "Traitement"); // unknown stage from a newer engine
});

test("progressView: one bar for the whole job, indeterminate without a number", () => {
  // Download only: the engine percent is the bar.
  assert.deepEqual(lib.progressView("fr", { stage: "download", percent: 41.6 }, false), { text: "Téléchargement… 42 %", percent: 41.6 });
  // With a size limit: download = first 40 %, encode (both passes, 0-100) = the rest.
  assert.equal(lib.progressView("fr", { stage: "download", percent: 85 }, true).percent, 34);
  assert.deepEqual(lib.progressView("fr", { stage: "encode", percent: 0, pass: 1 }, true), { text: "Encodage (passe 1/2)… 40 %", percent: 40 });
  assert.equal(lib.progressView("fr", { stage: "encode", percent: 100, pass: 2 }, true).percent, 100);
  assert.equal(lib.progressView("en", { stage: "download", percent: 50 }, false).text, "Downloading… 50%");
  // No percentage: indeterminate, with the phase name (never a frozen "Démarrage…").
  assert.deepEqual(lib.progressView("fr", { stage: "inspection" }, false), { text: "Inspection…", percent: null });
  assert.deepEqual(lib.progressView("fr", { stage: "download" }, false), { text: "Téléchargement…", percent: null });
  assert.deepEqual(lib.progressView("fr", { stage: "merge" }, true), { text: "Assemblage…", percent: null });
  assert.deepEqual(lib.progressView("en", { stage: "merge", percent: null }, true), { text: "Merging…", percent: null });
  // Monotonic across the stages of a job.
  const seq = [["download", 0], ["download", 85], ["encode", 0], ["encode", 50], ["encode", 100]].map(([stage, percent]) => lib.overallPercent(stage, percent, true));
  assert.deepEqual(seq, [...seq].sort((a, b) => a - b));
});

test("i18n: language resolution", () => {
  assert.equal(i18n.resolveLanguage("auto", ["en-US", "en"]), "en");
  assert.equal(i18n.resolveLanguage("auto", ["fr-CA"]), "fr");
  assert.equal(i18n.resolveLanguage("auto", ["de-DE", "en-GB"]), "en"); // first supported browser language
  assert.equal(i18n.resolveLanguage("auto", ["de-DE", "ja"]), "fr"); // unsupported: French
  assert.equal(i18n.resolveLanguage("auto", []), "fr");
  assert.equal(i18n.resolveLanguage(undefined, undefined), "fr");
  assert.equal(i18n.resolveLanguage("fr", ["en-US"]), "fr"); // an explicit choice wins over the browser
  assert.equal(i18n.resolveLanguage("en", ["fr"]), "en");
  assert.equal(i18n.resolveLanguage("xx", ["en"]), "en"); // unknown stored value behaves like auto
});

test("i18n: missing key falls back to French, then to the key", () => {
  const original = i18n.MESSAGES.en["action.close"];
  delete i18n.MESSAGES.en["action.close"];
  try {
    assert.equal(i18n.translate("en", "action.close"), "Fermer");
  } finally {
    i18n.MESSAGES.en["action.close"] = original;
  }
  assert.equal(i18n.translate("en", "no.such.key"), "no.such.key");
  assert.equal(i18n.translate("zz", "action.close"), "Fermer");
  assert.equal(i18n.translate("en", "field.maxSize"), "Maximum size (MB, optional)");
});

test("i18n: catalogue completeness", () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  const reference = i18n.MESSAGES[i18n.DEFAULT_LANGUAGE];
  for (const language of i18n.LANGUAGES) {
    const table = i18n.MESSAGES[language];
    assert.deepEqual(Object.keys(table).sort(), Object.keys(reference).sort(), "same keys in " + language);
    for (const [key, text] of Object.entries(table)) {
      assert.ok(typeof text === "string" && text.trim() !== "", language + " " + key);
      assert.equal(placeholders(text), placeholders(reference[key]), "placeholders of " + language + " " + key);
    }
    assert.ok(table["lang." + language], "language name for " + language);
  }
  // Every engine/host error code the extension can receive has its own text.
  for (const code of ["busy", "cancelled", "invalid_arguments", "host_disconnected", "invalid_message", "no_folder", "open_failed", "pick_failed",
    "processing_failed", "download_failed", "probe_failed", "invalid_output_directory", "tool_missing", "size_unreachable", "size_exceeded"])
    assert.ok(i18n.hasKey("error." + code), code);
});

test("no visible string is hard-coded outside the catalogue", () => {
  // Source files may only contain accent-free technical strings; French text lives in i18n.js.
  for (const file of ["content.js", "background.js", "lib.js"]) {
    const code = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n").replace(/\s\/\/.*$/gm, "");
    assert.doesNotMatch(code, /["'`][^"'`\n]*[àâçéèêëîïôûùüÿ«»][^"'`\n]*["'`]/i, file + " contains a French literal");
  }
});

test("reduced motion: saved option or system preference", () => {
  assert.equal(lib.isCalm({ lowResources: false }, false), false);
  assert.equal(lib.isCalm({ lowResources: true }, false), true);
  assert.equal(lib.isCalm({ lowResources: false }, true), true); // Firefox already asks for it
  assert.equal(lib.isCalm(undefined, true), true);
  assert.equal(lib.isCalm(undefined, false), false);
  // The stylesheet honours both the media query and the [data-calm] attribute set from the option.
  const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:host\(\[data-calm\]\)/);
});

test("normalizeSettings", () => {
  assert.deepEqual(lib.normalizeSettings(undefined), lib.DEFAULT_SETTINGS);
  assert.equal(lib.DEFAULT_SETTINGS.language, "auto");
  assert.equal(lib.DEFAULT_SETTINGS.lowResources, false);
  assert.deepEqual(lib.normalizeSettings({ outputDirectory: "  /v  ", theme: "light", buttonMode: "icon", language: "en", lowResources: true }),
    { outputDirectory: "/v", theme: "light", buttonMode: "icon", language: "en", lowResources: true });
  assert.deepEqual(lib.normalizeSettings({ outputDirectory: 5, theme: "x", buttonMode: "y", language: "xx", lowResources: "yes" }), lib.DEFAULT_SETTINGS);
  // Settings saved before these options existed keep working.
  assert.deepEqual(lib.normalizeSettings({ outputDirectory: "/v", theme: "light", buttonMode: "page" }),
    { outputDirectory: "/v", theme: "light", buttonMode: "page", language: "auto", lowResources: false });
});

test("lowResources is forwarded to the host only when enabled", () => {
  assert.equal(lib.buildDownloadRequest({ url: "u", lowResources: true }).lowResources, true);
  assert.ok(!("lowResources" in lib.buildDownloadRequest({ url: "u", lowResources: false })));
  assert.ok(!("lowResources" in lib.buildDownloadRequest({ url: "u" })));
});

test("validateOutputDirectory", () => {
  for (const ok of ["", "  ", "C:\\Users\\Moi\\Videos", "d:/Videos", "\\\\srv\\share\\v", "/home/u/Videos"])
    assert.equal(lib.validateOutputDirectory(ok), "", ok);
  for (const bad of ["Videos", "C:", "C:Videos", "\\\\srv", "C:\\a|b", "C:\\a?", "/a\u0000b", "./x"])
    assert.notEqual(lib.validateOutputDirectory(bad), "", bad);
  assert.equal(lib.validateOutputDirectory("x"), "error.absolutePath");
});

test("sameFolder", () => {
  assert.ok(lib.sameFolder("/home/u/Videos", "/home/u/Videos/"));
  assert.ok(lib.sameFolder("C:\\Users\\Moi\\Videos\\", "c:\\users\\moi\\videos"));
  assert.ok(lib.sameFolder("C:/Users/Moi", "C:\\Users\\Moi"));
  assert.ok(lib.sameFolder("\\\\srv\\share\\v", "\\\\SRV\\share\\v\\"));
  assert.ok(lib.sameFolder("/", "/"));
  assert.ok(!lib.sameFolder("/home/u/Videos", "/home/u/videos")); // POSIX is case-sensitive
  assert.ok(!lib.sameFolder("/home/u/Videos", "/home/u/Videos2"));
  assert.ok(!lib.sameFolder("C:\\a", "D:\\a"));
  assert.match(errorText("fr", "pick_failed"), /sélecteur de dossier/);
});

test("outputDirectory in request and error text", () => {
  assert.equal(lib.buildDownloadRequest({ url: "u", outputDirectory: " /v " }).outputDirectory, "/v");
  assert.ok(!("outputDirectory" in lib.buildDownloadRequest({ url: "u", outputDirectory: "  " })));
  assert.match(errorText("fr", "invalid_output_directory"), /réglages/);
});

test("isVideoPage and canonicalUrl on X, TikTok and Instagram", () => {
  for (const href of [
    "https://x.com/user/status/123", "https://twitter.com/user/status/123?s=20", "https://x.com/i/status/123/video/1",
    "https://www.tiktok.com/@user/video/7123?lang=fr", "https://www.instagram.com/reel/Cabc/", "https://www.instagram.com/p/Cabc/?igsh=x", "https://www.instagram.com/user/reel/Cabc/",
  ]) assert.ok(lib.isVideoPage(href), href);
  for (const href of [
    "https://x.com/", "https://x.com/home", "https://x.com/user", "https://x.com/user/status/", "https://x.com/search?q=a",
    "https://www.tiktok.com/", "https://www.tiktok.com/@user", "https://www.tiktok.com/@user/video/", "https://www.tiktok.com/foryou",
    "https://www.instagram.com/", "https://www.instagram.com/user/", "https://www.instagram.com/explore/", "https://www.instagram.com/reels/",
  ]) assert.ok(!lib.isVideoPage(href), href);
  assert.equal(lib.canonicalUrl("https://twitter.com/user/status/123?s=20"), "https://twitter.com/user/status/123");
  assert.equal(lib.canonicalUrl("https://x.com/user/status/123/video/1#a"), "https://x.com/user/status/123");
  assert.equal(lib.canonicalUrl("https://www.tiktok.com/@user/video/7123?lang=fr&is_from_webapp=1"), "https://www.tiktok.com/@user/video/7123");
  assert.equal(lib.canonicalUrl("https://www.instagram.com/reel/Cabc/?igsh=x"), "https://www.instagram.com/reel/Cabc");
  assert.equal(lib.canonicalUrl("https://www.instagram.com/p/Cabc/"), "https://www.instagram.com/p/Cabc");
  assert.equal(lib.canonicalUrl("https://www.instagram.com/"), "https://www.instagram.com/");
  assert.ok(lib.isVideoPage("https://example.com/anything")); // unknown hosts: unchanged
});

test("timecode formats a duration as a placeholder example", () => {
  assert.equal(lib.timecode(10), "00:00:10");
  assert.equal(lib.timecode(3725.4), "01:02:05");
  for (const bad of [0, -5, NaN, undefined, "x"]) assert.equal(lib.timecode(bad), "00:00:00");
});
