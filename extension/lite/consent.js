"use strict";
// Lite mode consent window, opened by background-lite.js when its optional permissions are missing. The click on
// "allow" is the user input that permissions.request requires; the window closes itself either way and the
// background then checks what was granted.
(function () {
  const lib = globalThis.MDLib;
  const i18n = globalThis.MDI18n;
  const close = () => browser.windows.getCurrent().then((win) => browser.windows.remove(win.id));
  document.getElementById("allow").addEventListener("click", () => {
    browser.permissions.request(lib.litePermissions(browser.runtime.getManifest())).catch(() => false).then(close);
  });
  document.getElementById("cancel").addEventListener("click", close);
  browser.storage.local.get("settings").catch(() => ({})).then((stored) => {
    const language = i18n.resolveLanguage(lib.normalizeSettings(stored.settings).language, navigator.languages);
    document.documentElement.lang = language;
    for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = i18n.translate(language, node.dataset.i18n);
    document.title = i18n.translate(language, "consent.title");
  });
})();
