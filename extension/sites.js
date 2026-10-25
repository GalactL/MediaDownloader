"use strict";
// Per-site adapters: the ONLY place with page selectors. Adding a site = adding one object to ADAPTERS (+ its host match in manifest.json).
// An adapter is { id, matches(hostname), findAnchor(document), observeTarget(document), css }: the button is inserted right before the anchor.
(function (root) {
  // YouTube keeps hidden duplicate action bars, so only a rendered node counts (no getClientRects = fake DOM, treated as rendered).
  const rendered = (node) => typeof node.getClientRects !== "function" || node.getClientRects().length > 0;
  const first = (doc, selectors) => {
    for (const selector of selectors) {
      try { const node = [...doc.querySelectorAll(selector)].find(rendered); if (node) return node; } catch { /* bad selector: try the next */ }
    }
    return null;
  };

  const youtube = {
    id: "youtube",
    matches: (hostname) => /^(?:[a-z0-9-]+\.)*youtube\.com$/i.test(hostname) || hostname.toLowerCase() === "youtu.be",
    // Like/dislike group (the button goes before it so the native buttons do not move), most specific first (YouTube renames these often; unverified on the live site).
    findAnchor: (doc) => first(doc, [
      "#top-level-buttons-computed segmented-like-dislike-button-view-model",
      "#actions segmented-like-dislike-button-view-model",
      "ytd-watch-metadata segmented-like-dislike-button-view-model",
      "#top-level-buttons-computed ytd-segmented-like-dislike-button-renderer",
      "#actions ytd-segmented-like-dislike-button-renderer",
      "segmented-like-dislike-button-view-model",
    ]),
    // Where to watch for the action bar being recreated (narrow layout, navigation).
    observeTarget: (doc) => first(doc, ["ytd-watch-flexy", "ytd-page-manager"]) || doc.body,
    // YouTube's own dark mode is the `dark` attribute on <html>; content.js mirrors it on the host as [data-dark] (fallback colours only).
    isDark: (doc) => !!(doc.documentElement && doc.documentElement.hasAttribute("dark")),
    // Icon-only pill like YouTube's own. Colours use YouTube's variables with explicit theme fallbacks (some vars are undefined on the live site).
    css: `
:host { --md-bg: #f2f2f2; --md-bg-hover: #e5e5e5; --md-fg: #0f0f0f;
  display: inline-flex !important; visibility: visible !important; opacity: 1 !important; flex: none; align-self: center;
  align-items: center; margin: 0 8px 0 0 !important; position: relative; z-index: 1; }
:host([data-dark]) { --md-bg: #272727; --md-bg-hover: #3f3f3f; --md-fg: #fff; }
button { display: inline-flex; align-items: center; justify-content: center; width: 36px; min-width: 36px; height: 36px; padding: 0; border: 0; border-radius: 18px;
  background: var(--yt-spec-button-chip-background, var(--md-bg)); color: var(--yt-spec-text-primary, var(--md-fg)); cursor: pointer; }
button:hover { background: var(--yt-spec-button-chip-background-hover, var(--md-bg-hover)); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
svg { fill: none; stroke: currentColor; width: 20px; height: 20px; flex: none; }`,
  };

  const ADAPTERS = [youtube];
  const adapterFor = (hostname) => ADAPTERS.find((adapter) => adapter.matches(hostname)) || null;

  let warned = false; // one diagnostic line per page load
  const MARK = "[data-md-button]";

  // Keeps exactly one button, directly before the anchor. `create()` returns the host element (the same one every time is fine).
  // -> the mounted host, or null when the anchor is missing (any stale button is removed).
  function mountButton(adapter, doc, create) {
    const anchor = adapter.findAnchor(doc);
    const existing = [...doc.querySelectorAll(MARK)];
    if (!anchor) { if (!warned) { warned = true; console.debug("[MediaDownloader] bouton: ancre introuvable"); } existing.forEach((node) => node.remove()); return null; }
    const kept = existing.find((node) => anchor.previousElementSibling === node);
    existing.forEach((node) => { if (node !== kept) node.remove(); });
    if (kept) return kept;
    const host = create();
    host.setAttribute("data-md-button", "");
    anchor.before(host);
    return host;
  }

  const unmountButton = (doc) => doc.querySelectorAll(MARK).forEach((node) => node.remove());

  // Where the box goes relative to the button rect: below it, above it, or "fixed" (corner) when the button is off-screen or neither side fits
  // the box's real height (it is never resized). -> { mode, top, left } (null when fixed).
  function placement(rect, vw, vh, panelHeight) {
    const fixed = { mode: "fixed", top: null, left: null };
    if (!(rect.width > 0) || rect.bottom < 0 || rect.top > vh) return fixed;
    const height = panelHeight > 0 ? panelHeight : 420;
    const width = Math.min(400, vw - 32);
    const left = Math.max(16, Math.min(rect.right - width, vw - width - 16));
    if (vh - rect.bottom - 16 >= height) return { mode: "below", top: Math.max(8, rect.bottom + 8), left };
    if (rect.top - 16 >= height) return { mode: "above", top: Math.max(8, rect.top - 8 - height), left };
    return fixed;
  }

  const api = { ADAPTERS, adapterFor, mountButton, unmountButton, placement };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
