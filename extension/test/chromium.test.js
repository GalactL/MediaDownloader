"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const chromium = JSON.parse(read("manifest.chromium.json"));
const firefox = JSON.parse(read("manifest.json"));

function runShim(globals) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(read("shim.js"), context);
  return context;
}

test("shim: browser falls back to chrome, and never replaces a native browser", () => {
  const chromeApi = { runtime: {} };
  assert.equal(runShim({ chrome: chromeApi }).browser, chromeApi);
  const own = { runtime: {} };
  assert.equal(runShim({ browser: own, chrome: chromeApi }).browser, own);
  assert.equal(runShim({}).browser, undefined);
});

test("Chromium extension id derived from the manifest key matches the host's allowed_origins", () => {
  const der = Buffer.from(chromium.key, "base64");
  const id = [...crypto.createHash("sha256").update(der).digest("hex").slice(0, 32)]
    .map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
  const core = fs.readFileSync(path.join(root, "..", "src", "Core.h"), "utf8");
  assert.equal(core.match(/ChromiumExtensionId = "([a-p]{32})"/)[1], id);
});

test("Chromium manifest is MV3 and shares the Firefox code base", () => {
  assert.equal(chromium.manifest_version, 3);
  assert.equal(chromium.version, firefox.version);
  assert.equal(chromium.background.service_worker, "background.js");
  assert.deepEqual(chromium.permissions, firefox.permissions);
  const [scripts] = chromium.content_scripts;
  assert.deepEqual(scripts.js, ["shim.js", ...firefox.content_scripts[0].js]);
  assert.deepEqual(scripts.matches, firefox.content_scripts[0].matches);
  assert.deepEqual(chromium.web_accessible_resources[0].matches, scripts.matches);
  const files = [...scripts.js, chromium.background.service_worker, ...chromium.web_accessible_resources[0].resources,
    ...Object.values(chromium.icons), ...Object.values(chromium.action.default_icon)];
  for (const file of files) assert.ok(fs.existsSync(path.join(root, file)), file);
});
