"use strict";
// Per-site adapters: the ONLY place with page selectors. Adding a site = adding one object to ADAPTERS (+ its host match in manifest.json).
// An adapter is { id, matches(hostname), findAnchor(document), observeTarget(document), css }: the button is inserted right after the anchor.
(function (root) {
  const first = (doc, selectors) => {
    for (const selector of selectors) {
      try { const node = doc.querySelector(selector); if (node) return node; } catch { /* bad selector: try the next */ }
    }
    return null;
  };

  const youtube = {
    id: "youtube",
    matches: (hostname) => /^(?:[a-z0-9-]+\.)*youtube\.com$/i.test(hostname) || hostname.toLowerCase() === "youtu.be",
    // Like/dislike group, most specific first (YouTube renames these often; unverified on the live site).
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
:host { display: inline-flex; align-items: center; margin-left: 8px; }
button { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 16px; border: 0; border-radius: 18px;
  background: var(--yt-spec-badge-chip-background, rgba(0, 0, 0, .05)); color: var(--yt-spec-text-primary, #0f0f0f);
  font: 500 14px/36px "Roboto", "Arial", sans-serif; white-space: nowrap; cursor: pointer; }
button:hover { background: var(--yt-spec-10-percent-layer, rgba(0, 0, 0, .1)); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
svg { width: 20px; height: 20px; flex: none; }`,
  };

  const ADAPTERS = [youtube];
  const adapterFor = (hostname) => ADAPTERS.find((adapter) => adapter.matches(hostname)) || null;

  const MARK = "[data-md-button]";

  // Keeps exactly one button, directly after the anchor. `create()` returns the host element (the same one every time is fine).
  // -> the mounted host, or null when the anchor is missing (any stale button is removed).
  function mountButton(adapter, doc, create) {
    const anchor = adapter.findAnchor(doc);
    const existing = [...doc.querySelectorAll(MARK)];
    if (!anchor) { existing.forEach((node) => node.remove()); return null; }
    const kept = existing.find((node) => anchor.nextElementSibling === node);
    existing.forEach((node) => { if (node !== kept) node.remove(); });
    if (kept) return kept;
    const host = create();
    host.setAttribute("data-md-button", "");
    anchor.after(host);
    return host;
  }

  const unmountButton = (doc) => doc.querySelectorAll(MARK).forEach((node) => node.remove());

  const api = { ADAPTERS, adapterFor, mountButton, unmountButton };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
