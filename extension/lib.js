"use strict";
// Pure helpers shared by content.js (browser) and test/lib.test.js (Node).
(function (root) {
  const i18n = typeof module !== "undefined" && module.exports ? require("./i18n.js") : root.MDI18n;
  const YOUTUBE_HOST = /^(?:[a-z0-9-]+\.)*youtube\.com$/i;

  // "90", "1:30" or "1:02:03" -> seconds; "" -> null; invalid -> NaN.
  function parseTime(text) {
    const value = String(text ?? "").trim();
    if (value === "") return null;
    if (!/^\d+(?:\.\d+)?(?::\d{1,2}(?:\.\d+)?){0,2}$/.test(value)) return NaN;
    return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }

  // Same rules as the host: both or none, end > start. Returns a catalogue key (error.*) or "".
  function validateRange(start, end) {
    if (Number.isNaN(start) || Number.isNaN(end)) return "error.timeInvalid";
    if ((start === null) !== (end === null)) return "error.rangeTogether";
    if (start !== null && end <= start) return "error.rangeOrder";
    return "";
  }

  const MAX_SIZE_MB = 20; // Discord

  // "" -> null (no limit asked); number in ]0, 20] -> number; invalid -> NaN.
  function parseMaxSize(text) {
    const value = String(text ?? "").trim().replace(",", ".");
    if (value === "") return null;
    const number = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
    return number > 0 && number <= MAX_SIZE_MB ? number : NaN;
  }

  function buildDownloadRequest({ url, quality, maxSizeMb, start, end, name, outputDirectory, lowResources }) {
    const request = { type: "download", url };
    if (lowResources === true) request.lowResources = true; // absent = unchanged engine behaviour
    if (typeof outputDirectory === "string" && outputDirectory.trim()) request.outputDirectory = outputDirectory.trim();
    if (name && name.trim()) request.title = name.trim(); // empty -> the engine keeps the video title
    if (quality && quality !== "best") request.quality = String(quality);
    if (maxSizeMb !== null && maxSizeMb !== undefined) request.maxSizeMb = maxSizeMb;
    if (start !== null && start !== undefined) {
      request.startTime = start;
      request.endTime = end;
    }
    return request;
  }

  // language: "auto" (browser language) or a supported code; lowResources: also reduces animations and background work.
  const DEFAULT_SETTINGS = { outputDirectory: "", theme: "dark", buttonMode: "page", language: "auto", lowResources: false };

  function normalizeSettings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
      outputDirectory: typeof r.outputDirectory === "string" ? r.outputDirectory.trim() : DEFAULT_SETTINGS.outputDirectory,
      theme: r.theme === "light" ? "light" : DEFAULT_SETTINGS.theme,
      buttonMode: r.buttonMode === "icon" ? "icon" : DEFAULT_SETTINGS.buttonMode,
      language: i18n.LANGUAGES.includes(r.language) ? r.language : DEFAULT_SETTINGS.language,
      lowResources: r.lowResources === true,
    };
  }

  // Animations are reduced when the user saved the resource-saving option or the system asks for reduced motion.
  function isCalm(settings, prefersReducedMotion) {
    return prefersReducedMotion === true || (!!settings && settings.lowResources === true);
  }

  // "" = engine default folder. Otherwise an absolute path (drive, UNC or POSIX). Returns a catalogue key or "".
  function validateOutputDirectory(text) {
    const value = String(text ?? "").trim();
    if (value === "") return "";
    const bad = "error.absolutePath";
    if (/[\u0000-\u001f\u007f]/.test(value)) return bad;
    if (value.startsWith("/") && !value.startsWith("//")) return "";
    const drive = /^[A-Za-z]:[\\/]/.test(value);
    const unc = /^\\\\[^\\/]+[\\/][^\\/]+/.test(value);
    if (!drive && !unc) return bad;
    return /[<>"|?*]/.test(drive ? value.slice(2) : value) ? bad : "";
  }

  // Same folder, ignoring trailing separators; Windows-looking paths (drive, UNC) also ignore case and / vs \\.
  function sameFolder(a, b) {
    const norm = (p) => {
      const t = String(p ?? "").trim();
      const win = /^[A-Za-z]:[\\/]|^\\\\/.test(t);
      const s = (win ? t.replace(/\//g, "\\").toLowerCase() : t).replace(/[\\/]+$/, "");
      return win ? s : s || t.slice(0, 1);
    };
    return norm(a) === norm(b);
  }

  function qualityOptions(heights, language) {
    const list = Array.isArray(heights) ? heights.filter((h) => Number.isInteger(h) && h > 0) : [];
    const unique = [...new Set(list)].sort((a, b) => b - a);
    // 2K and 4K are always offered; the engine falls back to the best available height.
    const all = [...new Set([...unique, 2160, 1440])].sort((a, b) => b - a);
    const labels = { 2160: "4K (2160p)", 1440: "2K (1440p)" };
    return [{ value: "best", label: i18n.translate(language, "quality.best") }].concat(
      all.map((h) => ({ value: String(h), label: labels[h] || h + "p" })));
  }

  // Engine/host error code -> catalogue key. Engine messages relay raw yt-dlp output, so only the code is ever shown.
  function errorKey(code) {
    const key = "error." + code;
    return i18n.hasKey(key) ? key : "error.generic";
  }

  // YouTube pages that are not videos (home, search...) get no button. Other hosts: always.
  function isVideoPage(href) {
    let url;
    try { url = new URL(href); } catch { return false; }
    if (!/^https?:$/.test(url.protocol)) return false;
    if (url.hostname.toLowerCase() === "youtu.be") return url.pathname.length > 1;
    if (!YOUTUBE_HOST.test(url.hostname)) return true;
    return (url.pathname === "/watch" && url.searchParams.has("v")) || /^\/(?:shorts|live)\/[^/]+/.test(url.pathname);
  }

  // Drops list=/index= so a playlist context never leaks into the download.
  function canonicalUrl(href) {
    let url;
    try { url = new URL(href); } catch { return href; }
    if (url.pathname === "/watch" && YOUTUBE_HOST.test(url.hostname) && url.searchParams.has("v"))
      return url.origin + "/watch?v=" + encodeURIComponent(url.searchParams.get("v"));
    return href;
  }

  // Phase name from a `progress` event (stage + optional pass). Unknown stages from a newer engine -> generic label.
  function phaseLabel(language, stage, pass) {
    if (stage === "encode" && pass) return i18n.translate(language, "phase.encodePass", { pass });
    const key = "phase." + stage;
    return i18n.translate(language, i18n.hasKey(key) ? key : "phase.working");
  }

  // One monotonic bar for the whole job. The engine's download percent covers 0-100 of the download; with a size
  // limit the download takes the first 40 % of the bar and the two encode passes the rest.
  function overallPercent(stage, percent, hasEncode) {
    const p = Math.min(100, Math.max(0, Number(percent)));
    if (stage === "download") return hasEncode ? p * 0.4 : p;
    if (stage === "encode") return 40 + p * 0.6;
    return null;
  }

  // -> { text, percent }; percent null = indeterminate bar (no number available for this phase).
  function progressView(language, { stage, percent, pass }, hasEncode) {
    const phase = phaseLabel(language, stage, pass);
    const overall = percent === undefined || percent === null || !Number.isFinite(Number(percent)) ? null : overallPercent(stage, percent, hasEncode);
    if (overall === null) return { text: i18n.translate(language, "progress.noPercent", { phase }), percent: null };
    return { text: i18n.translate(language, "progress.withPercent", { phase, percent: Math.round(overall) }), percent: overall };
  }

  const api = { parseTime, validateRange, parseMaxSize, buildDownloadRequest, qualityOptions, errorKey, DEFAULT_SETTINGS, normalizeSettings, isCalm, validateOutputDirectory, sameFolder, MAX_SIZE_MB, isVideoPage, canonicalUrl, phaseLabel, overallPercent, progressView };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDLib = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
