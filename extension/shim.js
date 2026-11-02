"use strict";
// Chromium only: expose the promise-based `browser` namespace that the shared code uses (Firefox already has it).
(function (root) {
  if (typeof root.browser === "undefined" && typeof root.chrome !== "undefined") root.browser = root.chrome;
})(globalThis);
