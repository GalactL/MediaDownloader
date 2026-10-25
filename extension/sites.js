"use strict";
// Per-site adapters: the ONLY place with page selectors. Adding a site = adding one object to ADAPTERS (+ its host match in manifest.json).
// An adapter is { id, matches(hostname, pathname), findAnchor(document), observeTarget(document), isDark(document), iconPath, css }: the button is inserted right before the anchor.
// Selectors of every site except YouTube classic are unverified on the live site (these sites rename and obfuscate their DOM): each list has fallbacks and `diagnose` reports what matched.
(function (root) {
  // YouTube keeps hidden duplicate action bars, so only a rendered node counts (no getClientRects = fake DOM, treated as rendered).
  const rendered = (node) => typeof node.getClientRects !== "function" || node.getClientRects().length > 0;
  const first = (doc, selectors) => {
    for (const selector of selectors) {
      try { const node = [...doc.querySelectorAll(selector)].find(rendered); if (node) return node; } catch { /* bad selector: try the next */ }
    }
    return null;
  };

  const counts = (doc, selectors) => selectors.map((selector) => { try { return selector + "=" + doc.querySelectorAll(selector).length; } catch { return selector + "=err"; } }).join(" | ");
  const DOWNLOAD_ICON = "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"; // filled download glyph (24x24 viewBox), Material "download"
  const isYouTube = (hostname) => /^(?:[a-z0-9-]+\.)*youtube\.com$/i.test(hostname) || hostname.toLowerCase() === "youtu.be";
  // Sites without a theme attribute: dark when the page background is.
  function darkBackground(doc) {
    if (!doc.defaultView || !doc.body) return false;
    const [r, g, b] = (doc.defaultView.getComputedStyle(doc.body).backgroundColor.match(/\d+/g) || [255, 255, 255]).map(Number);
    return r * 0.299 + g * 0.587 + b * 0.114 < 128;
  }
  // First rendered post (matching `box`) with a video, `accept` and an action bar (from `bars`); -> the bar's first child that is not our own button
  // (our button leads the bar once mounted: taking it as the anchor would remove and re-add it on every sync, a flicker).
  function barOf(doc, box, bars, accept = () => true) {
    for (const post of doc.querySelectorAll(box)) {
      if (!rendered(post) || !accept(post) || !first(post, ["video"])) continue;
      const bar = first(post, bars);
      const child = bar && [...bar.children].find((node) => !node.hasAttribute("data-md-button"));
      if (child) return child;
    }
    return null;
  }
  // Square 36px button in a horizontal action bar (X, Instagram): a normal flex item.
  const ROW_CSS = `
:host { display: flex !important; align-items: center; justify-content: center; flex: none !important; width: 36px !important; height: 36px !important;
  margin: 0 !important; padding: 0 !important; visibility: visible !important; opacity: 1 !important; --bg-hover: rgba(0, 0, 0, .1); --fg: #0f1419; }
:host([data-dark]) { --bg-hover: rgba(255, 255, 255, .15); --fg: #e7e9ea; }
button { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--fg); cursor: pointer; }
button:hover { background: var(--bg-hover); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
svg { width: 22px; height: 22px; flex: none; fill: currentColor; }`;
  // Round 48px button at the top of a vertical action column (Shorts, TikTok): in the flow, so the column keeps its spacing.
  const COLUMN_CSS = `
:host { display: flex !important; justify-content: center; flex: none !important; width: 100% !important; margin: 0 0 12px !important; padding: 0 !important;
  visibility: visible !important; opacity: 1 !important; --bg: rgba(0, 0, 0, .08); --bg-hover: rgba(0, 0, 0, .14); --fg: #0f0f0f; }
:host([data-dark]) { --bg: rgba(255, 255, 255, .12); --bg-hover: rgba(255, 255, 255, .2); --fg: #fff; }
button { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; padding: 0; border: 0; border-radius: 50%; background: var(--bg); color: var(--fg); cursor: pointer; }
button:hover { background: var(--bg-hover); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
svg { width: 24px; height: 24px; flex: none; fill: currentColor; }`;

  const YT_ANCHORS = [
    "#top-level-buttons-computed segmented-like-dislike-button-view-model",
    "#actions segmented-like-dislike-button-view-model",
    "ytd-watch-metadata segmented-like-dislike-button-view-model",
    "#top-level-buttons-computed ytd-segmented-like-dislike-button-renderer",
    "#actions ytd-segmented-like-dislike-button-renderer",
    "segmented-like-dislike-button-view-model",
    "ytd-segmented-like-dislike-button-renderer",
    "#top-level-buttons-computed > :not([data-md-button])", // last resort: the like group leads the row (never our own button, or it would be re-mounted in a loop)
  ];
  const youtube = {
    id: "youtube",
    matches: isYouTube,
    // Like/dislike group (the button goes before it so the native buttons do not move), most specific first (YouTube renames these often; unverified on the live site).
    findAnchor: (doc) => first(doc, YT_ANCHORS),
    // What matched, for the one-time console.debug when mounting fails (the owner can paste it).
    diagnose: (doc) => counts(doc, YT_ANCHORS),
    // Where to watch for the action bar being recreated (narrow layout, navigation).
    observeTarget: (doc) => first(doc, ["ytd-watch-flexy", "ytd-page-manager"]) || doc.body,
    // Filled download glyph (24x24 viewBox), Material "download".
    iconPath: DOWNLOAD_ICON,
    isDark: (doc) => !!(doc.documentElement && doc.documentElement.hasAttribute("dark")),
    // Self-contained button, explicit colours (YouTube's variables are not reliable). The host takes no space (width 0) so the native row and
    // its like bar keep their layout; the 36px square hangs to the left of the like group.
    css: `
:host { display: block !important; position: relative !important; width: 0 !important; height: 36px !important; flex: none !important;
  margin: 0 !important; padding: 0 !important; overflow: visible !important; align-self: center; visibility: visible !important; opacity: 1 !important; z-index: 1;
  --bg: rgba(0, 0, 0, .08); --bg-hover: rgba(0, 0, 0, .14); --fg: #0f0f0f; }
:host([data-dark]) { --bg: rgba(255, 255, 255, .12); --bg-hover: rgba(255, 255, 255, .2); --fg: #fff; }
button { position: absolute; right: 8px; top: 0; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0;
  border: 0; border-radius: 10px; background: var(--bg); color: var(--fg); cursor: pointer; }
button:hover { background: var(--bg-hover); }
button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
svg { width: 24px; height: 24px; flex: none; fill: currentColor; }`,
  };

  // YouTube Shorts (/shorts/<id>): the button leads the vertical actions column of the active short. Listed before `youtube`, which keeps every other YouTube page.
  const SHORTS_ANCHORS = [
    "ytd-reel-video-renderer[is-active] like-button-view-model",
    "ytd-reel-video-renderer[is-active] #like-button",
    "ytd-reel-video-renderer[is-active] #actions > :not([data-md-button])",
  ];
  const shorts = {
    id: "youtube-shorts",
    matches: (hostname, pathname) => isYouTube(hostname) && /^\/shorts\//.test(pathname),
    findAnchor: (doc) => first(doc, SHORTS_ANCHORS),
    diagnose: (doc) => counts(doc, SHORTS_ANCHORS),
    observeTarget: (doc) => first(doc, ["ytd-shorts", "ytd-page-manager"]) || doc.body,
    iconPath: DOWNLOAD_ICON,
    isDark: youtube.isDark,
    css: COLUMN_CSS,
  };

  // X / Twitter (/<account>/status/<id>): the post of the page, only when it holds a video; the button leads its action bar (reply, repost, like...).
  const X_BARS = ['[role="group"]:has([data-testid="reply"])', '[role="group"]'];
  const x = {
    id: "x",
    matches: (hostname) => /^(?:[a-z0-9-]+\.)*(?:x|twitter)\.com$/i.test(hostname),
    findAnchor: (doc) => {
      const id = (/\/status\/(\d+)/.exec(doc.location && doc.location.pathname) || [])[1];
      // The page may also show replies or the thread above: only the post whose own link carries the page's id.
      const isPageOf = (post) => !id || [...post.querySelectorAll("a")].some((link) => (link.getAttribute("href") || "").includes("/status/" + id));
      return barOf(doc, "article", X_BARS, isPageOf);
    },
    diagnose: (doc) => counts(doc, ["article", "article video", ...X_BARS]),
    observeTarget: (doc) => first(doc, ["main", '[data-testid="primaryColumn"]']) || doc.body,
    iconPath: DOWNLOAD_ICON,
    isDark: darkBackground,
    css: ROW_CSS,
  };

  // TikTok (/@<account>/video/<id>): the button leads the like / comment / share column of the video.
  // Most specific first; the icon sits in a button, itself (or its wrapper with the count) one item of the column.
  const TT_LIKES = ['[data-e2e="like-icon"]', '[data-e2e="browse-like-icon"]', '[data-e2e*="like-icon"]', 'button[aria-label*="like" i]', 'button[aria-label*="aimer" i]', '[data-e2e="share-icon"]'];
  // The column item holding `node`: climbs while the parent holds no other button (the column holds like, comment, share...).
  function columnItem(node) {
    let item = node.closest("button");
    if (!item) return node.parentElement || node;
    for (let i = 0; i < 4 && item.parentElement && item.parentElement.querySelectorAll("button").length < 2; i++) item = item.parentElement;
    return item;
  }
  const tiktok = {
    id: "tiktok",
    matches: (hostname) => /^(?:[a-z0-9-]+\.)*tiktok\.com$/i.test(hostname),
    findAnchor: (doc) => {
      const icon = first(doc, TT_LIKES);
      return icon && columnItem(icon);
    },
    diagnose: (doc) => counts(doc, TT_LIKES),
    observeTarget: (doc) => first(doc, ["main", "#app"]) || doc.body,
    iconPath: DOWNLOAD_ICON,
    isDark: darkBackground,
    css: COLUMN_CSS,
  };

  // Instagram (/reel/<id>, /p/<id>): the post (or the page's main area) holding a video; the button leads its action row (like, comment, share...).
  const IG_BARS = ["section:has(svg)", "section"];
  const instagram = {
    id: "instagram",
    matches: (hostname) => /^(?:[a-z0-9-]+\.)*instagram\.com$/i.test(hostname),
    findAnchor: (doc) => barOf(doc, "article", IG_BARS) || barOf(doc, "main", IG_BARS),
    diagnose: (doc) => counts(doc, ["article video", "main video", ...IG_BARS.map((bar) => "article " + bar), ...IG_BARS.map((bar) => "main " + bar)]),
    observeTarget: (doc) => first(doc, ["main"]) || doc.body,
    iconPath: DOWNLOAD_ICON,
    isDark: darkBackground,
    css: ROW_CSS,
  };

  const ADAPTERS = [shorts, youtube, x, tiktok, instagram];
  const adapterFor = (hostname, pathname = "") => ADAPTERS.find((adapter) => adapter.matches(hostname, pathname)) || null;

  let warned = false; // one diagnostic line per page load
  function report(what, adapter, doc) {
    if (warned) return;
    warned = true;
    console.debug("[MediaDownloader] bouton: " + what + (adapter.diagnose ? " (" + adapter.diagnose(doc) + ")" : ""));
  }
  const MARK = "[data-md-button]";

  // Keeps exactly one button, directly before the anchor. `create()` returns the element (the same one every time is fine) or null (no template).
  // -> the mounted element, or null when the anchor or the template is missing (any stale button is removed).
  function mountButton(adapter, doc, create) {
    const anchor = adapter.findAnchor(doc);
    const existing = [...doc.querySelectorAll(MARK)];
    if (!anchor) { report("ancre introuvable", adapter, doc); existing.forEach((node) => node.remove()); return null; }
    const kept = existing.find((node) => anchor.previousElementSibling === node);
    existing.forEach((node) => { if (node !== kept) node.remove(); });
    if (kept) return kept;
    const host = create();
    if (!host) { report("création du bouton impossible", adapter, doc); return null; }
    host.setAttribute("data-md-button", "");
    anchor.before(host);
    return host;
  }

  const unmountButton = (doc) => doc.querySelectorAll(MARK).forEach((node) => node.remove());

  // Box position from the button rect: left right-aligned to the button (clamped), top below it when it fits, else above, else below.
  // null = button not rendered; { close: true } = button fully outside the visible area.
  function placement(rect, vw, vh, panelHeight) {
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    if (rect.bottom <= 0 || rect.top >= vh) return { close: true };
    const height = panelHeight > 0 ? panelHeight : 420;
    const width = Math.min(400, vw - 32);
    const left = Math.max(16, Math.min(rect.right - width, vw - width - 16));
    const below = rect.bottom + 8;
    return { top: Math.max(8, below + height <= vh - 8 || rect.top - 8 - height < 8 ? below : rect.top - 8 - height), left };
  }

  const api = { ADAPTERS, adapterFor, mountButton, unmountButton, placement };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MDSites = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
