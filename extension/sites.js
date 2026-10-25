"use strict";
// Per-site adapters: the ONLY place with page selectors. Adding a site = adding one object to ADAPTERS (+ its host match in manifest.json).
// An adapter is { id, matches(hostname), findAnchor(document), observeTarget(document), createButton(document, onClick), labelButton(node, text) }: the button is inserted right before the anchor.
(function (root) {
  // YouTube keeps hidden duplicate action bars, so only a rendered node counts (no getClientRects = fake DOM, treated as rendered).
  const rendered = (node) => typeof node.getClientRects !== "function" || node.getClientRects().length > 0;
  const first = (doc, selectors) => {
    for (const selector of selectors) {
      try { const node = [...doc.querySelectorAll(selector)].find(rendered); if (node) return node; } catch { /* bad selector: try the next */ }
    }
    return null;
  };

  const YT_ANCHORS = [
    "#top-level-buttons-computed segmented-like-dislike-button-view-model",
    "#actions segmented-like-dislike-button-view-model",
    "ytd-watch-metadata segmented-like-dislike-button-view-model",
    "#top-level-buttons-computed ytd-segmented-like-dislike-button-renderer",
    "#actions ytd-segmented-like-dislike-button-renderer",
    "segmented-like-dislike-button-view-model",
    "ytd-segmented-like-dislike-button-renderer",
    "#top-level-buttons-computed > :first-child", // last resort: the like group leads the row
  ];
  // Native pill hosts to clone, then bare buttons.
  const YT_TEMPLATES = ["#top-level-buttons-computed yt-button-view-model", "#actions yt-button-view-model", "yt-button-view-model", "button-view-model", "ytd-button-renderer", "button.yt-spec-button-shape-next"];
  const DOWNLOAD_PATH = "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"; // Material "download", filled like the native icons
  const ICON_BOX = ".yt-spec-button-shape-next__icon";

  const youtube = {
    id: "youtube",
    matches: (hostname) => /^(?:[a-z0-9-]+\.)*youtube\.com$/i.test(hostname) || hostname.toLowerCase() === "youtu.be",
    // Like/dislike group (the button goes before it so the native buttons do not move), most specific first (YouTube renames these often; unverified on the live site).
    findAnchor: (doc) => first(doc, YT_ANCHORS),
    // What matched, for the one-time console.debug when mounting fails (the owner can paste it).
    diagnose: (doc) => [...YT_ANCHORS, ...YT_TEMPLATES].map((selector) => { try { return selector + "=" + doc.querySelectorAll(selector).length; } catch { return selector + "=err"; } }).join(" | "),
    // Where to watch for the action bar being recreated (narrow layout, navigation).
    observeTarget: (doc) => first(doc, ["ytd-watch-flexy", "ytd-page-manager"]) || doc.body,
    // Clone of a native icon-only action button ("..." menu, else Share) so YouTube's own CSS gives the size, centring, chip background and hover.
    // Only the icon's vector content is swapped. null = no template found.
    createButton(doc, onClick) {
      const skip = ["segmented-like-dislike-button-view-model", "ytd-segmented-like-dislike-button-renderer"];
      const inside = (node) => { for (let up = node; up; up = up.parentElement) if (up.hasAttribute && (up.hasAttribute("data-md-button") || skip.includes(up.localName))) return true; return false; };
      const hasIcon = (node) => node.querySelector(ICON_BOX) || node.querySelector("svg");
      const innerButton = (node) => (node.localName === "button" ? node : node.querySelector("button"));
      const iconOnly = (node) => { const b = innerButton(node); return !!b && b.className.includes("--icon-button"); };
      const candidates = YT_TEMPLATES.flatMap((selector) => [...doc.querySelectorAll(selector)].filter((node) => rendered(node) && !inside(node) && hasIcon(node)));
      const template = candidates.find(iconOnly) || candidates[0];
      if (!template) return null;
      const clone = template.cloneNode(true);
      for (const node of [clone, ...clone.querySelectorAll("*")]) {
        for (const { name } of [...node.attributes]) if (name === "id" || name === "href" || name.startsWith("aria-")) node.removeAttribute(name);
      }
      const button = innerButton(clone);
      const icon = clone.querySelector(ICON_BOX) || (clone.querySelector("svg") || {}).parentElement;
      if (!button || !icon) return null;
      if (!iconOnly(template)) {
        // Share-like fallback: keep just the chain from the button down to the icon box, drop every other branch and text node.
        const chain = [];
        for (let up = icon; up && up !== button.parentElement; up = up.parentElement) chain.push(up);
        for (const node of chain) for (const child of [...(node.childNodes || node.children)]) if (!chain.includes(child) && node !== icon) child.remove();
      }
      // Same chip look as the neighbouring pills: tonal + mono, size M, icon-only; any other token (e.g. experiment flags) is kept.
      const P = "yt-spec-button-shape-next";
      const variant = new RegExp("^" + P + "--(?:text|outline|filled|call-to-action|overlay|tonal|mono|icon-leading|icon-trailing|icon-button|size-\\w+)$");
      button.className = [...button.className.split(/\s+/).filter((token) => token && !variant.test(token)), P + "--tonal", P + "--mono", P + "--size-m", P + "--icon-button"].join(" ");
      button.removeAttribute("style"); // nothing inline that could make it transparent
      // Swap only the drawing: keep the native svg (size, viewBox, wrappers) and put our filled glyph in it.
      let svg = icon.querySelector("svg");
      if (!svg) {
        svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "24");
        svg.setAttribute("height", "24");
        icon.replaceChildren(svg);
      }
      const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", DOWNLOAD_PATH);
      path.setAttribute("fill", "currentColor");
      const size = Number((svg.getAttribute("viewBox") || "").split(/\s+/)[2]);
      if (size > 0 && size !== 24) { // our glyph is drawn on 24 units
        const group = doc.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("transform", "scale(" + size / 24 + ")");
        group.append(path);
        svg.replaceChildren(group);
      } else svg.replaceChildren(path);
      button.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); onClick(); });
      // Zero-size wrapper: the clone hangs to the left of the like group without taking space, so YouTube's like bar keeps its position.
      const wrapper = doc.createElement("div");
      for (const [name, value] of [["display", "block"], ["position", "relative"], ["width", "0"], ["height", "36px"], ["flex", "none"], ["margin", "0"], ["padding", "0"], ["overflow", "visible"], ["align-self", "center"]])
        wrapper.style.setProperty(name, value, "important");
      for (const [name, value] of [["position", "absolute"], ["right", "8px"], ["top", "0"]]) clone.style.setProperty(name, value, "important");
      wrapper.append(clone);
      return wrapper;
    },
    // Accessible name and tooltip (re-applied on a language change).
    labelButton(node, text) {
      const button = node.localName === "button" ? node : node.querySelector("button");
      button.setAttribute("aria-label", text);
      button.setAttribute("title", text);
    },
  };

  const ADAPTERS = [youtube];
  const adapterFor = (hostname) => ADAPTERS.find((adapter) => adapter.matches(hostname)) || null;

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
    if (!host) { report("bouton natif modèle introuvable", adapter, doc); return null; }
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
