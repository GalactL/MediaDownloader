"use strict";

(function () {
  const lib = globalThis.MDLib;
  let requestCounter = 0;
  const handlers = new Map(); // client id -> callback(message)

  function request(payload, onMessage) {
    const id = String(++requestCounter);
    handlers.set(id, onMessage);
    browser.runtime.sendMessage({ id, payload }).catch(() => {
      handlers.delete(id);
      onMessage({ type: "error", id, code: "host_disconnected", message: "Impossible de joindre l'extension en arrière-plan." });
    });
    return id;
  }

  browser.runtime.onMessage.addListener((message) => {
    if (!message || message.kind !== "host" || !message.message) return;
    const reply = message.message;
    const handler = handlers.get(reply.id);
    if (!handler) return;
    if (["completed", "error", "probe"].includes(reply.type)) handlers.delete(reply.id);
    handler(reply);
  });

  // UI (closed shadow root: page scripts cannot reach in; every host/page string goes through textContent).
  const host = document.createElement("div");
  const shadow = host.attachShadow({ mode: "closed" });

  function el(tag, props, children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const child of children || []) node.append(child);
    return node;
  }

  const style = el("link", { rel: "stylesheet", href: browser.runtime.getURL("content.css") });
  const fab = el("button", { className: "fab", type: "button", title: "MediaDownloader", textContent: "⬇" });
  const title = el("p", { className: "title", textContent: "MediaDownloader" });
  const quality = el("select");
  const maxSize = el("input", { type: "text", inputMode: "decimal", placeholder: "Illimitée" });
  const presetSize = el("button", { className: "btn secondary", type: "button", textContent: "10 Mo" });
  const startInput = el("input", { type: "text", placeholder: "0 ou 1:30" });
  const endInput = el("input", { type: "text", placeholder: "60 ou 2:00" });
  const download = el("button", { className: "btn", type: "button", textContent: "Télécharger" });
  const cancel = el("button", { className: "btn secondary", type: "button", textContent: "Annuler", hidden: true });
  const bar = el("progress", { max: 100, value: 0, hidden: true });
  const barText = el("div", { className: "progress-text", hidden: true });
  const message = el("div", { className: "message", role: "status" });
  const panel = el("div", { className: "panel", hidden: true }, [
    title,
    el("label", { textContent: "Qualité" }, [quality]),
    el("label", { textContent: "Taille maximale (Mo)" }, [maxSize]),
    el("div", { className: "actions" }, [presetSize]),
    el("div", { className: "row" }, [
      el("label", { textContent: "Début (s)" }, [startInput]),
      el("label", { textContent: "Fin (s)" }, [endInput]),
    ]),
    el("div", { className: "actions" }, [download, cancel]),
    bar, barText, message,
  ]);
  shadow.append(style, fab, panel);

  function say(text, kind) {
    message.textContent = text || "";
    message.className = "message" + (kind ? " " + kind : "");
  }

  function setQualities(heights) {
    quality.replaceChildren(...lib.qualityOptions(heights).map((o) => el("option", { value: o.value, textContent: o.label })));
  }

  // State
  let probedUrl = null;   // page URL already probed (or being probed)
  let running = false;
  let currentUrl = location.href;

  function setRunning(value) {
    running = value;
    download.disabled = value;
    cancel.hidden = !value;
    bar.hidden = barText.hidden = !value;
    if (!value) bar.value = 0;
  }

  function probe() {
    const url = lib.canonicalUrl(location.href);
    probedUrl = location.href;
    title.textContent = "Analyse de la vidéo…";
    setQualities([]);
    say("");
    request({ type: "probe", url }, (reply) => {
      if (probedUrl !== location.href) return; // navigated away meanwhile
      if (reply.type === "probe" && reply.data) {
        title.textContent = String(reply.data.title || "Vidéo");
        setQualities(reply.data.heights);
      } else if (reply.type === "error") {
        title.textContent = "MediaDownloader";
        probedUrl = null; // retry on next open
        say(reply.message || "Échec de l'analyse.", "error");
      }
    });
  }

  function start() {
    const startTime = lib.parseTime(startInput.value);
    const endTime = lib.parseTime(endInput.value);
    const size = lib.parseMaxSize(maxSize.value);
    const rangeError = lib.validateRange(startTime, endTime);
    if (rangeError) return say(rangeError, "error");
    if (Number.isNaN(size)) return say("La taille maximale doit être un nombre strictement positif.", "error");
    setRunning(true);
    bar.removeAttribute("value"); // indeterminate until first progress
    barText.textContent = "Démarrage…";
    say("");
    request(lib.buildDownloadRequest({
      url: lib.canonicalUrl(location.href), quality: quality.value, maxSizeMb: size, start: startTime, end: endTime,
    }), (reply) => {
      if (reply.type === "progress") {
        bar.value = Number(reply.percent) || 0;
        barText.textContent = lib.progressText(reply.stage, reply.percent, reply.pass);
      } else if (reply.type === "completed") {
        setRunning(false);
        say("Terminé : " + reply.path, "ok");
      } else if (reply.type === "error") {
        setRunning(false);
        say(reply.message || "Échec du téléchargement.", "error"); // includes the host's `busy` and `cancelled` messages
      }
    });
  }

  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !running && probedUrl !== location.href) probe();
  });
  presetSize.addEventListener("click", () => { maxSize.value = "10"; });
  download.addEventListener("click", start);
  cancel.addEventListener("click", () => request({ type: "cancel" }, () => {}));

  // SPA navigation: YouTube changes the URL without reloading.
  function sync() {
    const visible = lib.isVideoPage(location.href);
    if (visible && !host.isConnected) document.documentElement.append(host);
    if (!visible && host.isConnected) host.remove();
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      if (!running) {
        probedUrl = null;
        title.textContent = "MediaDownloader";
        say("");
        if (!panel.hidden && visible) probe();
      }
    }
  }
  window.addEventListener("popstate", sync);
  document.addEventListener("yt-navigate-finish", sync);
  setInterval(sync, 1000); // fallback for pushState, which fires no event
  sync();
})();
