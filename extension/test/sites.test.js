"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const sites = require("../sites.js");

// Minimal fake DOM: nodes with a parent/children list, enough for before/remove/nextElementSibling/querySelector(All).
class Node {
  constructor(name, attrs = {}) { this.name = name; this.attrs = { ...attrs }; this.children = []; this.parent = null; }
  append(child) { child.remove(); child.parent = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attrs[name] = value; }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  before(node) { node.remove(); node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this), 0, node); }
  after(node) { node.remove(); node.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, node); }
  get previousElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) - 1] || null : null; }
  get nextElementSibling() { return this.parent ? this.parent.children[this.parent.children.indexOf(this) + 1] || null : null; }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
}
// Supports only the selector shapes the tests use: "[data-md-button]", "tag", "#id tag", "#id".
const matches = (node, simple) => simple === `[${Object.keys(node.attrs).find((key) => `[${key}]` === simple)}]` || simple === node.name || simple === "#" + node.attrs.id;
function fakeDocument(root) {
  const find = (selector) => {
    const parts = selector.split(" ");
    return root.all().filter((node) => {
      if (!matches(node, parts[parts.length - 1])) return false;
      let up = node.parent;
      for (let i = parts.length - 2; i >= 0; i--) { while (up && !matches(up, parts[i])) up = up.parent; if (!up) return false; up = up.parent; }
      return true;
    });
  };
  return { body: root, querySelector: (selector) => find(selector)[0] || null, querySelectorAll: find };
}
function youtubePage() {
  const root = new Node("body");
  const bar = root.append(new Node("div", { id: "top-level-buttons-computed" }));
  const group = bar.append(new Node("segmented-like-dislike-button-view-model"));
  const share = bar.append(new Node("share"));
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

test("placement: below, above, off-screen, and corner when nothing fits", () => {
  const rect = (top) => ({ width: 100, top, bottom: top + 36, right: 700 });
  const normal = sites.placement(rect(100), 1280, 800, 420);
  assert.deepEqual(normal, { mode: "below", top: 144, left: 300 });
  assert.deepEqual(sites.placement(rect(650), 1280, 800, 420), { mode: "above", top: 222, left: 300 });
  assert.equal(sites.placement(rect(900), 1280, 800, 420).mode, "fixed");
  assert.equal(sites.placement({ ...rect(100), width: 0 }, 1280, 800, 420).mode, "fixed");
  assert.equal(sites.placement(rect(100), 1280, 300, 420).mode, "fixed");
  assert.equal(sites.placement(rect(400), 1280, 800, 420).mode, "fixed"); // 348 below, 384 above: neither fits
  assert.equal(sites.placement(rect(100), 360, 700, 0).left, 16);
});

test("isDark reads the dark attribute on <html>", () => {
  const doc = (dark) => ({ documentElement: { hasAttribute: (name) => dark && name === "dark" } });
  assert.equal(adapter.isDark(doc(true)), true);
  assert.equal(adapter.isDark(doc(false)), false);
  assert.equal(adapter.isDark({}), false);
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
