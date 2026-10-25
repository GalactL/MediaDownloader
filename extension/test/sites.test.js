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
  hasAttribute(name) { return name in this.attrs; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  append(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
  replaceChildren(...nodes) { this.children.forEach((child) => { child.parent = null; }); this.children = []; nodes.forEach((node) => this.append(node)); }
  setAttribute(name, value) { this.attrs[name] = value; }
  cloneNode() { const copy = new Node(this.name, this.attrs); this.children.forEach((child) => copy.append(child.cloneNode())); return copy; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  before(node) { node.remove(); node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 0, node); }
  get previousElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) - 1] || null : null; }
  get nextElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] || null : null; }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelectorAll(selector) { return find(this, selector); }
  querySelector(selector) { return find(this, selector)[0] || null; }
}
// Selector shapes used here: "tag", "#id", ".class", "[attr]", and descendant chains of those.
const matches = (node, simple) =>
  simple[0] === "#" ? node.attrs.id === simple.slice(1)
    : simple[0] === "." ? (node.attrs.class || "").split(" ").includes(simple.slice(1))
      : simple[0] === "[" ? simple.slice(1, -1) in node.attrs
        : simple === "*" || simple === node.name;
function find(root, selector) {
  const parts = selector.split(" ");
  return root.all().filter((node) => {
    if (!matches(node, parts[parts.length - 1])) return false;
    let up = node.parent;
    for (let i = parts.length - 2; i >= 0; i--) { while (up && !matches(up, parts[i])) up = up.parent; if (!up) return false; up = up.parent; }
    return true;
  });
}
const fakeDocument = (root) => ({ createElement: (name) => new Node(name), body: root, querySelector: (selector) => find(root, selector)[0] || null, querySelectorAll: (selector) => find(root, selector) });
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
  assert.equal(sites.placement(rect(400), 1280, 800, 420).top, 444); // neither side fits: below
  assert.deepEqual(sites.placement(rect(-500), 1280, 800, 420), { close: true });
  assert.deepEqual(sites.placement(rect(-36), 1280, 800, 420), { close: true });
  assert.deepEqual(sites.placement(rect(900), 1280, 800, 420), { close: true });
  assert.equal(sites.placement(rect(100), 360, 700, 0).left, 16);
  assert.equal(sites.placement({ ...rect(100), width: 0 }, 1280, 800, 420), null);
  assert.equal(sites.placement({ ...rect(100), height: 0 }, 1280, 800, 420), null);
});

test("createButton clones the native button: no id/aria, icon only, our icon and click", () => {
  const page = youtubePage();
  const svg = new Node("svg", { mine: "" });
  let clicks = 0;
  const wrapper = adapter.createButton(page.doc, svg, () => { clicks++; });
  const clone = wrapper.children[0];
  const button = clone.querySelector("button");
  assert.equal(wrapper.style.width, "0"); // takes no space in the row
  assert.equal(clone.style.position, "absolute");
  assert.equal(clone.name, "yt-button-view-model");
  assert.ok(!clone.hasAttribute("id") && !button.hasAttribute("id") && !button.hasAttribute("aria-label"));
  assert.ok(button.className.includes("--icon-button") && !button.className.includes("--icon-leading"));
  assert.equal(clone.querySelector(".yt-spec-button-shape-next__button-text-content"), null);
  assert.equal(button.children.length, 1); // only the branch to the icon survives
  assert.deepEqual(clone.querySelector(".yt-spec-button-shape-next__icon").children, [svg]);
  adapter.labelButton(wrapper, "Télécharger");
  assert.equal(button.attrs["aria-label"], "Télécharger");
  assert.equal(button.attrs.title, "Télécharger");
  button.handlers.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(clicks, 1);
  assert.ok(page.share.querySelector("button").hasAttribute("aria-label"), "template untouched");
});

test("createButton is icon-only even when the label has an unknown class", () => {
  const page = youtubePage();
  const button = page.share.querySelector("button");
  button.children[1].attrs.class = "weird-label";
  button.append(new Node("yt-touch-feedback-shape"));
  const clone = adapter.createButton(page.doc, new Node("svg"), () => {}).children[0];
  assert.deepEqual(clone.querySelector("button").children.map((node) => node.attrs.class), ["yt-spec-button-shape-next__icon"]);
  assert.equal(page.share.querySelector("button").children.length, 3, "template untouched");
});

test("mount puts the wrapper right before the like group", () => {
  const page = youtubePage();
  const host = sites.mountButton(adapter, page.doc, () => adapter.createButton(page.doc, new Node("svg"), () => {}));
  assert.equal(page.group.previousElementSibling, host);
  assert.ok(host.hasAttribute("data-md-button"));
});

test("createButton returns null without a native template, and mountButton then mounts nothing", () => {
  const page = youtubePage();
  page.share.remove();
  assert.equal(adapter.createButton(page.doc, new Node("svg"), () => {}), null);
  assert.equal(sites.mountButton(adapter, page.doc, () => adapter.createButton(page.doc, new Node("svg"), () => {})), null);
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
  assert.match(out, /yt-button-view-model=1/);
});
