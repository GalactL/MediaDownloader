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
    // Follows YouTube's own light/dark theme through its CSS variables (they inherit into the shadow root).
    css: `
:host { display: inline-flex !important; visibility: visible !important; opacity: 1 !important; flex: none; align-self: center;
  align-items: center; margin-right: 8px; position: relative; z-index: 1; }
button { display: inline-flex; min-width: 36px; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border: 0; border-radius: 18px;
  background: var(--yt-spec-badge-chip-background, #f2f2f2); color: var(--yt-spec-text-primary, #0f0f0f);
  font: 500 14px/36px "Roboto", "Arial", sans-serif; white-space: nowrap; cursor: pointer; }
button:hover { background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .1)); }
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

  // Where the box goes relative to the button rect: below it, above it, or "fixed" (corner) when the button is off-screen or there is no room.
  // -> { mode, top, left, maxH } (top/left/maxH are null when fixed). maxH is never under 240.
  function placement(rect, vw, vh, panelHeight) {
    const fixed = { mode: "fixed", top: null, left: null, maxH: null };
    if (!(rect.width > 0) || rect.bottom < 0 || rect.top > vh) return fixed;
    const height = panelHeight > 0 ? panelHeight : 420;
    const need = Math.min(height, 320);
    const width = Math.min(400, vw - 32);
    const left = Math.max(16, Math.min(rect.right - width, vw - width - 16));
    if (vh - rect.bottom - 16 >= need) {
      const top = Math.max(8, rect.bottom + 8);
      return { mode: "below", top, left, maxH: Math.max(240, vh - top - 16) };
    }
    if (rect.top - 16 >= need) {
      const maxH = Math.max(240, rect.top - 16);
      return { mode: "above", top: Math.max(8, rect.top - 8 - Math.min(height, maxH)), left, maxH };
    }
    return fixed;
  }

  const api = { ADAPTERS, adapterFor, mountButton, unmountButton, placement };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
