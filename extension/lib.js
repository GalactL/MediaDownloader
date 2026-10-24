"use strict";
// Pure helpers shared by content.js (browser) and test/lib.test.js (Node).
(function (root) {
  const YOUTUBE_HOST = /^(?:[a-z0-9-]+\.)*youtube\.com$/i;

  // "90", "1:30" or "1:02:03" -> seconds; "" -> null; invalid -> NaN.
  function parseTime(text) {
    const value = String(text ?? "").trim();
    if (value === "") return null;
    if (!/^\d+(?:\.\d+)?(?::\d{1,2}(?:\.\d+)?){0,2}$/.test(value)) return NaN;
    return value.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  }

  // Same rules as the host: both or none, end > start. Returns French error text or "".
  function validateRange(start, end) {
    if (Number.isNaN(start) || Number.isNaN(end)) return "Temps invalide : utilisez des secondes ou mm:ss.";
    if ((start === null) !== (end === null)) return "Le début et la fin doivent être fournis ensemble.";
    if (start !== null && end <= start) return "La fin doit être strictement supérieure au début.";
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

  function buildDownloadRequest({ url, quality, maxSizeMb, start, end, name }) {
    const request = { type: "download", url };
    if (name && name.trim()) request.title = name.trim(); // empty -> the engine keeps the video title
    if (quality && quality !== "best") request.quality = String(quality);
    if (maxSizeMb !== null && maxSizeMb !== undefined) request.maxSizeMb = maxSizeMb;
    if (start !== null && start !== undefined) {
      request.startTime = start;
      request.endTime = end;
    }
    return request;
  }

  function qualityOptions(heights) {
    const list = Array.isArray(heights) ? heights.filter((h) => Number.isInteger(h) && h > 0) : [];
    const unique = [...new Set(list)].sort((a, b) => b - a);
    // 2K and 4K are always offered; the engine falls back to the best available height.
    const all = [...new Set([...unique, 2160, 1440])].sort((a, b) => b - a);
    const labels = { 2160: "4K (2160p)", 1440: "2K (1440p)" };
    return [{ value: "best", label: "Meilleure qualité" }].concat(
      all.map((h) => ({ value: String(h), label: labels[h] || h + "p" })));
  }

  // Host error code -> French text; unknown codes keep the host's own (French) message.
  const ERRORS = {
    busy: "Un téléchargement est déjà en cours.",
    cancelled: "Téléchargement annulé.",
    invalid_arguments: "Paramètres invalides.",
    host_disconnected: "L'hôte MediaDownloader est introuvable. Lancez « MediaDownloader.Cli install-host ».",
    no_folder: "Aucun dossier à ouvrir.",
    open_failed: "Impossible d'ouvrir le dossier.",
    processing_failed: "Le téléchargement a échoué.",
  };
  function errorText(code, fallback) {
    return ERRORS[code] || fallback || "Une erreur est survenue.";
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

  const STAGES = { download: "Téléchargement", encode: "Encodage" };
  function progressText(stage, percent, pass) {
    const label = STAGES[stage] || String(stage || "Traitement");
    const passText = pass ? " (passe " + pass + ")" : "";
    return label + passText + " : " + Math.round(Number(percent) || 0) + " %";
  }

  const api = { parseTime, validateRange, parseMaxSize, buildDownloadRequest, qualityOptions, errorText, MAX_SIZE_MB, isVideoPage, canonicalUrl, progressText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDLib = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
