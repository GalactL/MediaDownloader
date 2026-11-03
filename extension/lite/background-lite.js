"use strict";
// Firefox only (background scripts of manifest.json, after i18n.js and lib.js): lite mode jobs, yt-dlp and FFmpeg
// in a worker (lite/engine.js) instead of the native host. One job at a time, driven by a "lite" port from content.js.
(function (root) {
  // Header rewrite of the worker's requests (contract in the header of lite/engine.js). Pure: details in, blocking
  // response out. ownPrefix = browser.runtime.getURL(""): a web page can never trigger the rewrite.
  function createRewriter(ownPrefix) {
    const chains = new Map(); // requestId -> { host, cookie, setCookies } over the redirect chain
    const lower = (h) => h.name.toLowerCase();

    function beforeSendHeaders(details) {
      const headers = details.requestHeaders || [];
      let chain = chains.get(details.requestId);
      if (!chain) {
        if (!headers.some((h) => lower(h) === "x-mdl") || !String(details.originUrl || "").startsWith(ownPrefix)) return {};
        chain = { host: new URL(details.url).hostname, cookie: null, setCookies: [] };
        chains.set(details.requestId, chain);
      }
      const wanted = new Map();
      for (const h of headers) if (lower(h).startsWith("x-mdl-h-")) wanted.set(lower(h).slice(8), h.value);
      if (wanted.has("cookie") && chain.cookie === null) chain.cookie = wanted.get("cookie");
      wanted.delete("cookie");
      // yt-dlp's jar replaces the browser's Cookie, and only on the jar's host (yt-dlp drops Cookie across origins).
      const kept = headers.filter((h) => !lower(h).startsWith("x-mdl") && !wanted.has(lower(h)) && lower(h) !== "cookie" && lower(h) !== "origin");
      for (const [name, value] of wanted) kept.push({ name, value });
      if (chain.cookie !== null && new URL(details.url).hostname === chain.host) kept.push({ name: "Cookie", value: chain.cookie });
      return { requestHeaders: kept };
    }

    function headersReceived(details) {
      const chain = chains.get(details.requestId);
      if (!chain) return {};
      const headers = details.responseHeaders || [];
      for (const h of headers) if (lower(h) === "set-cookie") chain.setCookies.push(...String(h.value).split("\n"));
      if (!chain.setCookies.length) return {};
      return { responseHeaders: [...headers, { name: "x-mdl-set-cookie", value: encodeURIComponent(JSON.stringify(chain.setCookies)) }] };
    }

    const forget = (details) => { chains.delete(details.requestId); };
    return { beforeSendHeaders, headersReceived, forget, chains };
  }

  if (typeof module !== "undefined" && module.exports) return void (module.exports = { createRewriter });

  const lib = root.MDLib;
  const wanted = lib.litePermissions(browser.runtime.getManifest());
  // Once per background start, before any job: sweeps what a killed job left in OPFS.
  const engine = import("./engine.js").then(async (module) => {
    await module.cleanupLite().catch(() => {});
    return module;
  });
  engine.catch(() => {}); // no unhandled rejection at start; `await engine` in run() still throws and reports internal_error
  let busy = false;

  // The listeners exist only during a job: registered for <all_urls> in an event page, they would otherwise
  // wake it (and hold every request of the browser) whenever a page loads anything.
  function listen(rewriter) {
    const filter = { urls: ["<all_urls>"] };
    const pairs = [
      [browser.webRequest.onBeforeSendHeaders, rewriter.beforeSendHeaders, ["blocking", "requestHeaders"]],
      [browser.webRequest.onHeadersReceived, rewriter.headersReceived, ["blocking", "responseHeaders"]],
      [browser.webRequest.onCompleted, rewriter.forget],
      [browser.webRequest.onErrorOccurred, rewriter.forget],
    ];
    for (const [event, listener, extra] of pairs) event.addListener(listener, filter, ...(extra ? [extra] : []));
    return () => { for (const [event, listener] of pairs) event.removeListener(listener); };
  }

  // permissions.request needs a click in an extension page: content scripts have no permissions API and a message
  // from them is not user input. The consent window (lite/consent.html) asks, then closes itself.
  async function granted(signal, onAsk) {
    if (await browser.permissions.contains(wanted)) return true;
    onAsk();
    const win = await browser.windows.create({ type: "popup", url: browser.runtime.getURL("lite/consent.html"), width: 560, height: 520 });
    if (signal.aborted) { browser.windows.remove(win.id).catch(() => {}); return false; } // aborted while the window was opening
    await new Promise((resolve) => {
      const closed = (id) => { if (id === win.id) { browser.windows.onRemoved.removeListener(closed); resolve(); } };
      browser.windows.onRemoved.addListener(closed);
      signal.addEventListener("abort", () => { browser.windows.remove(win.id).catch(() => {}); }, { once: true });
    });
    return !signal.aborted && browser.permissions.contains(wanted);
  }

  function downloadFinished(id) {
    return new Promise((resolve, reject) => {
      const settle = (state) => {
        if (state !== "complete" && state !== "interrupted") return;
        browser.downloads.onChanged.removeListener(changed);
        if (state === "complete") resolve(); else reject(new Error("download interrupted"));
      };
      const changed = (delta) => { if (delta.id === id && delta.state) settle(delta.state.current); };
      browser.downloads.onChanged.addListener(changed);
      browser.downloads.search({ id }).then(([item]) => item && settle(item.state), () => {});
    });
  }

  // OPFS file -> Firefox's download folder; the blob URL and the OPFS entry go away once Firefox is done with them.
  async function save({ opfsName, title }, name) {
    const dir = await navigator.storage.getDirectory();
    let url = null;
    try {
      url = URL.createObjectURL(await (await dir.getFileHandle(opfsName)).getFile());
      const id = await browser.downloads.download({ url, filename: lib.liteFileName(name || title), conflictAction: "uniquify", saveAs: false });
      await downloadFinished(id);
    } catch (e) {
      throw Object.assign(new Error(String((e && e.message) || e)), { code: "save_failed" });
    } finally {
      if (url) URL.revokeObjectURL(url);
      await dir.removeEntry(opfsName).catch(() => {});
    }
  }

  async function run(port, { url, startSec = null, endSec = null, maxSizeMb, name }) {
    const send = (message) => { try { port.postMessage(message); } catch {} };
    if (busy) return send({ type: "error", code: "busy" });
    busy = true;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort()); // tab closed or reloaded: the job stops
    port.onMessage.addListener((message) => { if (message && message.type === "cancel") controller.abort(); });
    let unlisten = null;
    try {
      if (!(await granted(controller.signal, () => send({ type: "progress", phase: "permission" })))) throw { code: "permission_denied" };
      unlisten = listen(createRewriter(browser.runtime.getURL("")));
      const { runLite } = await engine;
      const result = await runLite({ url, startSec, endSec, maxSizeMb, signal: controller.signal, onProgress: (p) => send({ type: "progress", ...p }) });
      send({ type: "progress", phase: "save" });
      await save(result, name);
      send({ type: "completed" });
    } catch (e) {
      // Engine messages carry no URL path nor cookie (lite/engine.js); the page only shows the code's text.
      if (e && e.message) console.warn("MediaDownloader lite:", e.code, e.message);
      send({ type: "error", code: controller.signal.aborted ? "cancelled" : (e && e.code) || "internal_error" });
    } finally {
      if (unlisten) unlisten();
      busy = false;
    }
  }

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== "lite" || !port.sender || !port.sender.tab) return;
    port.onMessage.addListener((message) => { if (message && message.type === "start") run(port, message); });
  });
})(globalThis);
