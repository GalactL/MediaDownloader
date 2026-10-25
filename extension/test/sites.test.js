"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sites = require("../sites.js");

// Minimal fake DOM: nodes with a parent/children list, enough for before/remove/nextElementSibling/querySelector(All).
class Node {
  constructor(name, attrs = {}) { this.name = name; this.localName = name; this.attrs = { ...attrs }; this.children = []; this.parent = null; this.handlers = {}; this.style = { setProperty: (name, value) => { this.style[name] = value; } }; }
  get parentElement() { return this.parent; }
  get childNodes() { return this.children; }
  get attributes() { return Object.keys(this.attrs).map((name) => ({ name })); }
  get className() { return this.attrs.class || ""; }
  set className(value) { this.attrs.class = value; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return name in this.attrs; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  append(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children.forEach((child) => { child.parent = null; }); this.children = []; nodes.forEach((node) => this.append(node)); }
  setAttribute(name, value) { this.attrs[name] = value; }
  cloneNode() { const copy = new Node(this.name, this.attrs); this.children.forEach((child) => copy.append(child.cloneNode())); return copy; }
  after(node) { node.remove(); node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  before(node) { node.remove(); node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 0, node); }
  get previousElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) - 1] || null : null; }
  get nextElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] || null : null; }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelectorAll(selector) { return find(this, selector); }
  querySelector(selector) { return find(this, selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parent) if (selector.split(" ").length === 1 && matches(node, selector)) return node; return null; }
}
// Selector shapes used here: "tag", "#id", ".class", "[attr]", "[attr=value]", compounds of those ("tag[attr]") and descendant chains. Anything else (":has", ">") matches nothing.
const PARTS = /[#.][\w-]+|\[[^\]]+\]/g;
const matches = (node, simple) => {
  const m = /^([\w-]*|\*)((?:[#.][\w-]+|\[[^\]]+\])*)$/.exec(simple);
  if (!m || (m[1] && m[1] !== "*" && m[1] !== node.name)) return false;
  return (m[2].match(PARTS) || []).every((part) => {
    if (part[0] === "#") return node.attrs.id === part.slice(1);
    if (part[0] === ".") return (node.attrs.class || "").split(" ").includes(part.slice(1));
    const [name, value] = part.slice(1, -1).split("=");
    return value === undefined ? name in node.attrs : node.attrs[name] === value.replace(/"/g, "");
  });
};
function find(root, selector) {
  const parts = selector.split(" ");
  return root.all().filter((node) => {
    if (!matches(node, parts[parts.length - 1])) return false;
    let up = node.parent;
    for (let i = parts.length - 2; i >= 0; i--) { while (up && !matches(up, parts[i])) up = up.parent; if (!up) return false; up = up.parent; }
    return true;
  });
}
const fakeDocument = (root, pathname) => ({ location: { pathname }, createElement: (name) => new Node(name), createElementNS: (ns, name) => new Node(name), body: root, querySelector: (selector) => find(root, selector)[0] || null, querySelectorAll: (selector) => find(root, selector) });
function youtubePage() {
  const root = new Node("body");
  const bar = root.append(new Node("div", { id: "top-level-buttons-computed" }));
  const group = bar.append(new Node("segmented-like-dislike-button-view-model"));
  const share = bar.append(new Node("yt-button-view-model", { id: "share-host" }));
  const shareButton = share.append(new Node("button", { class: "yt-spec-button-shape-next yt-spec-button-shape-next--icon-leading", "aria-label": "Partager", id: "sb" }));
  shareButton.append(new Node("div", { class: "yt-spec-button-shape-next__icon" })).append(new Node("svg"));
  shareButton.append(new Node("div", { class: "yt-spec-button-shape-next__button-text-content" }));
  return { root, bar, group, share, doc: fakeDocument(root) };
}
const adapter = sites.adapterFor("www.youtube.com");
const make = () => new Node("div");

test("adapterFor matches YouTube hosts only", () => {
  assert.equal(sites.adapterFor("m.youtube.com").id, "youtube");
  assert.equal(sites.adapterFor("youtu.be").id, "youtube");
  assert.equal(sites.adapterFor("youtube.com.evil.example"), null);
});

test("findAnchor returns null without throwing when the structure is missing", () => {
  const doc = fakeDocument(new Node("body"));
  assert.equal(adapter.findAnchor(doc), null);
  assert.equal(sites.mountButton(adapter, doc, make), null);
  assert.equal(adapter.findAnchor({ querySelector() { throw new Error("bad selector"); } }), null);
});

test("mountButton inserts right before the like/dislike group", () => {
  const page = youtubePage();
  const host = sites.mountButton(adapter, page.doc, make);
  assert.equal(page.group.previousElementSibling, host);
  assert.equal(host.nextElementSibling, page.group);
});

test("mountButton is idempotent", () => {
  const page = youtubePage();
  sites.mountButton(adapter, page.doc, make);
  sites.mountButton(adapter, page.doc, make);
  assert.equal(page.doc.querySelectorAll("[data-md-button]").length, 1);
});

test("mountButton removes stray duplicates", () => {
  const page = youtubePage();
  sites.mountButton(adapter, page.doc, make);
  const stray = page.root.append(make());
  stray.setAttribute("data-md-button", "");
  sites.mountButton(adapter, page.doc, make);
  assert.equal(page.doc.querySelectorAll("[data-md-button]").length, 1);
});

test("remounts after the action bar is replaced", () => {
  const page = youtubePage();
  const host = sites.mountButton(adapter, page.doc, make);
  page.bar.remove(); // button goes with the old bar
  const fresh = youtubePage();
  assert.equal(sites.mountButton(adapter, fresh.doc, () => host), host);
  assert.equal(fresh.group.previousElementSibling, host);
  assert.equal(fresh.doc.querySelectorAll("[data-md-button]").length, 1);
});

test("a stale button is removed when the anchor disappears; unmountButton removes it (buttonMode icon)", () => {
  const page = youtubePage();
  sites.mountButton(adapter, page.doc, make);
  sites.unmountButton(page.doc);
  assert.equal(page.doc.querySelectorAll("[data-md-button]").length, 0);
  sites.mountButton(adapter, page.doc, make);
  page.group.remove();
  assert.equal(sites.mountButton(adapter, page.doc, make), null);
  assert.equal(page.doc.querySelectorAll("[data-md-button]").length, 0);
});

test("placement: below, above, close when off-screen, null when unrendered", () => {
  const rect = (top) => ({ width: 100, height: 36, top, bottom: top + 36, right: 700 });
  assert.deepEqual(sites.placement(rect(100), 1280, 800, 420), { top: 144, left: 300 });
  assert.deepEqual(sites.placement(rect(650), 1280, 800, 420), { top: 222, left: 300 });
  assert.equal(sites.placement(rect(400), 1280, 800, 420).top, 372); // neither side fits: pushed up, bottom edge at vh - 8
  for (const top of [200, 300, 400, 500, 600]) {
    const place = sites.placement(rect(top), 1280, 800, 700);
    assert.ok(place.top >= 8 && place.top + 700 <= 800 - 8, "top " + top);
  }
  assert.equal(sites.placement(rect(100), 1280, 600, 700).top, 8); // taller than the viewport: top edge wins
  assert.deepEqual(sites.placement(rect(-500), 1280, 800, 420), { close: true });
  assert.deepEqual(sites.placement(rect(-36), 1280, 800, 420), { close: true });
  assert.deepEqual(sites.placement(rect(900), 1280, 800, 420), { close: true });
  assert.equal(sites.placement(rect(100), 360, 700, 0).left, 16);
  assert.equal(sites.placement({ ...rect(100), width: 0 }, 1280, 800, 420), null);
  assert.equal(sites.placement({ ...rect(100), height: 0 }, 1280, 800, 420), null);
});

test("placement side right: beside the button, top aligned, clamped; falls back when there is no room", () => {
  const rect = (top, right) => ({ width: 48, height: 48, top, bottom: top + 48, right });
  assert.deepEqual(sites.placement(rect(200, 700), 1280, 800, 420, "right"), { top: 200, left: 708 });
  assert.deepEqual(sites.placement(rect(600, 700), 1280, 800, 420, "right"), { top: 372, left: 708 }); // clamped to the bottom margin
  assert.equal(sites.placement(rect(4, 700), 1280, 800, 420, "right").top, 8);
  assert.deepEqual(sites.placement(rect(200, 1000), 1280, 800, 420, "right"), sites.placement(rect(200, 1000), 1280, 800, 420)); // no room right: default behaviour
  assert.deepEqual(sites.placement(rect(200, 700), 1280, 800, 420), { top: 256, left: 300 }); // no option: unchanged
  assert.deepEqual(sites.placement(rect(-100, 700), 1280, 800, 420, "right"), { close: true });
  assert.equal(sites.adapterFor("www.tiktok.com", "/").panel, "right");
  assert.equal(sites.adapterFor("x.com", "/").panel, undefined);
});

test("adapter css: zero-width host, 36px square button, explicit colours; isDark reads <html dark>", () => {
  assert.match(adapter.css, /width: 0 !important/);
  assert.match(adapter.css, /width: 36px; height: 36px/);
  assert.match(adapter.css, /:host\(\[data-dark\]\)/);
  assert.match(adapter.iconPath, /^M5 20h14/);
  const doc = (dark) => ({ documentElement: { hasAttribute: (name) => dark && name === "dark" } });
  assert.equal(adapter.isDark(doc(true)), true);
  assert.equal(adapter.isDark(doc(false)), false);
  assert.equal(adapter.isDark({}), false);
});

test("mount puts the wrapper right before the like group", () => {
  const page = youtubePage();
  const host = sites.mountButton(adapter, page.doc, () => new Node("div"));
  assert.equal(page.group.previousElementSibling, host);
  assert.ok(host.hasAttribute("data-md-button"));
});

test("mountButton mounts nothing when create() returns null", () => {
  const page = youtubePage();
  assert.equal(sites.mountButton(adapter, page.doc, () => null), null);
  assert.equal(page.doc.querySelectorAll("[data-md-button]").length, 0);
});

test("findAnchor skips hidden duplicates and returns null when none is rendered", () => {
  const root = new Node("body");
  const hidden = root.append(new Node("segmented-like-dislike-button-view-model"));
  const shown = root.append(new Node("segmented-like-dislike-button-view-model"));
  hidden.getClientRects = () => [];
  shown.getClientRects = () => [{}];
  assert.equal(adapter.findAnchor(fakeDocument(root)), shown);
  shown.getClientRects = () => [];
  assert.equal(adapter.findAnchor(fakeDocument(root)), null);
});

test("diagnose lists every selector with its match count", () => {
  const out = adapter.diagnose(youtubePage().doc);
  assert.match(out, /segmented-like-dislike-button-view-model=1/);
});

// --- Shorts, X, TikTok, Instagram ---
const add = (parent, name, attrs) => parent.append(new Node(name, attrs));

test("adapterFor picks the adapter from host and path", () => {
  assert.equal(sites.adapterFor("www.youtube.com", "/shorts/abc").id, "youtube-shorts");
  assert.equal(sites.adapterFor("www.youtube.com", "/watch").id, "youtube");
  assert.equal(sites.adapterFor("www.youtube.com", "/").id, "youtube");
  for (const [host, id] of [["x.com", "x"], ["twitter.com", "x"], ["www.x.com", "x"], ["www.tiktok.com", "tiktok"], ["www.instagram.com", "instagram"]])
    assert.equal(sites.adapterFor(host, "/").id, id);
  for (const host of ["evilx.com", "x.com.evil.example", "tiktok.com.evil.example", "notinstagram.com"]) assert.equal(sites.adapterFor(host, "/"), null);
});

test("Shorts: the button leads the like button of the active short only", () => {
  const root = new Node("body");
  const idle = add(add(root, "ytd-reel-video-renderer"), "like-button-view-model");
  const active = add(root, "ytd-reel-video-renderer", { "is-active": "" });
  const column = add(active, "div", { id: "actions" });
  const like = add(column, "like-button-view-model");
  add(column, "button-view-model");
  const shorts = sites.adapterFor("www.youtube.com", "/shorts/abc");
  const doc = fakeDocument(root, "/shorts/abc");
  assert.equal(shorts.findAnchor(doc), like);
  const host = sites.mountButton(shorts, doc, make);
  assert.equal(like.previousElementSibling, host);
  assert.equal(idle.previousElementSibling, null);
  assert.match(shorts.css, /width: 48px; height: 48px/);
  assert.match(shorts.diagnose(doc), /like-button-view-model=1/);
  assert.equal(shorts.findAnchor(fakeDocument(new Node("body"), "/shorts/abc")), null);
});

function xPage(pathname, { video = true, id = "123" } = {}) {
  const root = new Node("body");
  const main = add(root, "main");
  const thread = add(main, "article", { "data-testid": "tweet" }); // a post above the page's own
  add(thread, "a", { href: "/other/status/1" });
  add(thread, "video");
  add(add(thread, "div", { role: "group" }), "div");
  const post = add(main, "article", { "data-testid": "tweet" });
  add(post, "a", { href: "/user/status/" + id });
  if (video) add(add(post, "div", { "data-testid": "videoPlayer" }), "video");
  const bar = add(post, "div", { role: "group" });
  const reply = add(bar, "div");
  add(add(reply, "div"), "button", { "data-testid": "reply" });
  const share = add(bar, "div");
  return { root, reply, share, doc: fakeDocument(root, pathname) };
}

test("X: the button leads the action bar of the page's own post, only with a video", () => {
  const x = sites.adapterFor("x.com", "/user/status/123");
  const page = xPage("/user/status/123");
  assert.equal(x.findAnchor(page.doc), page.share);
  const host = sites.mountButton(x, page.doc, make);
  assert.equal(page.share.nextElementSibling, host);
  assert.equal(page.reply.previousElementSibling, null);
  assert.match(x.css, /align-self: center/);
  const none = xPage("/user/status/123", { video: false });
  assert.equal(x.findAnchor(none.doc), null); // the thread above has a video, but it is not this post
  assert.equal(sites.mountButton(x, none.doc, make), null);
  assert.equal(none.doc.querySelectorAll("[data-md-button]").length, 0);
  assert.equal(x.findAnchor(xPage("/user/status/999").doc), null); // page id not found among the posts
});

test("TikTok: the button leads the like button of the video, falling back to its icon's parent", () => {
  const tiktok = sites.adapterFor("www.tiktok.com", "/@a/video/1");
  const root = new Node("body");
  const column = add(root, "div");
  const likeButton = add(column, "button");
  add(likeButton, "span", { "data-e2e": "like-icon" });
  add(column, "button");
  const doc = fakeDocument(root, "/@a/video/1");
  assert.equal(tiktok.findAnchor(doc), likeButton);
  assert.equal(sites.mountButton(tiktok, doc, make), likeButton.previousElementSibling);
  const bare = new Node("body");
  const wrap = add(bare, "div");
  add(wrap, "span", { "data-e2e": "browse-like-icon" });
  assert.equal(tiktok.findAnchor(fakeDocument(bare, "/@a/video/1")), wrap);
  assert.equal(tiktok.findAnchor(fakeDocument(new Node("body"), "/@a/video/1")), null);
});

test("Instagram: the button leads the action row of a post (or of main) holding a video", () => {
  const instagram = sites.adapterFor("www.instagram.com", "/reel/abc");
  const page = (box, video) => {
    const root = new Node("body");
    const post = add(add(root, "main"), box);
    if (video) add(post, "video");
    const row = add(post, "section");
    add(row, "svg");
    return { doc: fakeDocument(root, "/reel/abc") };
  };
  const post = page("article", true);
  assert.equal(instagram.findAnchor(post.doc), post.doc.querySelector("svg")); // first child of the row
  assert.equal(instagram.findAnchor(page("article", false).doc), null);
  const reel = page("div", true);
  assert.equal(instagram.findAnchor(reel.doc), reel.doc.querySelector("svg"));
});

test("a missing anchor logs one diagnostic line and leaves the page untouched", () => {
  delete require.cache[require.resolve("../sites.js")];
  const fresh = require("../sites.js");
  const x = fresh.adapterFor("x.com", "/user/status/123");
  const logs = [];
  const original = console.debug;
  console.debug = (line) => logs.push(line);
  try {
    const doc = fakeDocument(new Node("body"), "/user/status/123");
    fresh.mountButton(x, doc, make);
    fresh.mountButton(x, doc, make);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /ancre introuvable/);
    assert.equal(doc.querySelectorAll("*").length, 0);
  } finally { console.debug = original; }
});

test("isDark reads the page background where the site has no theme attribute", () => {
  const doc = (backgroundColor) => ({ body: {}, defaultView: { getComputedStyle: () => ({ backgroundColor }) } });
  for (const id of ["x", "tiktok", "instagram"]) {
    const adapterOf = sites.ADAPTERS.find((a) => a.id === id);
    assert.equal(adapterOf.isDark(doc("rgb(0, 0, 0)")), true);
    assert.equal(adapterOf.isDark(doc("rgb(255, 255, 255)")), false);
    assert.equal(adapterOf.isDark({}), false);
  }
});

// The mounted button leads the action bar: the anchor must stay the native first item, or every sync would remove and re-add it (flicker on X).
test("mounting is stable on X and Instagram: the button is never taken as its own anchor", () => {
  const x = sites.adapterFor("x.com", "/user/status/123");
  const page = xPage("/user/status/123");
  const host = sites.mountButton(x, page.doc, make);
  for (let i = 0; i < 3; i++) assert.equal(sites.mountButton(x, page.doc, make), host);
  assert.equal(x.findAnchor(page.doc), page.share);
  assert.equal(page.doc.querySelectorAll("[data-md-button]").length, 1);
  assert.equal(page.share.nextElementSibling, host);
  assert.equal(page.share.parent.children[page.share.parent.children.length - 1], host);

  const instagram = sites.adapterFor("www.instagram.com", "/reel/abc");
  const root = new Node("body");
  const post = add(add(root, "main"), "article");
  add(post, "video");
  const row = add(post, "section");
  const like = add(row, "div");
  add(row, "div");
  const doc = fakeDocument(root, "/reel/abc");
  const mounted = sites.mountButton(instagram, doc, make);
  assert.equal(sites.mountButton(instagram, doc, make), mounted);
  assert.equal(instagram.findAnchor(doc), like);
});

test("TikTok: the button is a sibling of the column items, whether the like button is wrapped with its count or not", () => {
  const tiktok = sites.adapterFor("www.tiktok.com", "/@a/video/1");
  const build = (wrapped) => {
    const root = new Node("body");
    const column = add(add(root, "section"), "div");
    const item = (icon) => { const box = wrapped ? add(column, "div") : column; const button = add(box, "button"); add(button, "span", { "data-e2e": icon }); add(box, "strong"); return wrapped ? box : button; };
    const like = item("browse-like-icon");
    item("comment-icon");
    return { like, column, doc: fakeDocument(root, "/@a/video/1") };
  };
  for (const wrapped of [false, true]) {
    const page = build(wrapped);
    assert.equal(tiktok.findAnchor(page.doc), page.like);
    const host = sites.mountButton(tiktok, page.doc, make);
    assert.equal(host.parent, page.column);
    assert.equal(sites.mountButton(tiktok, page.doc, make), host); // stable
    assert.equal(tiktok.findAnchor(page.doc), page.like);
  }
  const root = new Node("body");
  const column = add(root, "div");
  const share = add(column, "button");
  add(share, "span", { "data-e2e": "share-icon" });
  add(column, "button");
  assert.equal(tiktok.findAnchor(fakeDocument(root, "/@a/video/1")), share); // fallback when the like icon is not found
});
