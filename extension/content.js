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
    if (["completed", "error", "probe", "opened"].includes(reply.type)) handlers.delete(reply.id);
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
  const nameInput = el("input", { type: "text", placeholder: "Titre de la vidéo" });
  const maxSize = el("input", { type: "text", inputMode: "decimal", placeholder: "Non précisée" });
  const clip = el("input", { type: "checkbox" });
  const startInput = el("input", { type: "text", placeholder: "0 ou 1:30", disabled: true });
  const endInput = el("input", { type: "text", placeholder: "60 ou 2:00", disabled: true });
  // Side button (10 % of the row): close -> cancel while running -> open folder once done. Icons are outlines (currentColor).
  const SIDE = {
    close: { label: "Fermer", path: "M6 6l12 12M18 6L6 18" },
    cancel: { label: "Annuler", path: "M6 6l12 12M18 6L6 18" },
    folder: { label: "Ouvrir le dossier", path: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
  };
  const side = el("button", { className: "btn secondary side", type: "button" });
  let sideMode = "close";
  function setSide(mode) {
    sideMode = mode;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const [name, value] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"]])
      svg.setAttribute(name, value);
    path.setAttribute("d", SIDE[mode].path);
    svg.append(path);
    side.replaceChildren(svg);
    side.title = SIDE[mode].label;
    side.setAttribute("aria-label", SIDE[mode].label);
  }
  setSide("close");
  // Progress fills the button from behind; the state text sits on top of it.
  const fill = el("span", { className: "fill" });
  const label = el("span", { className: "label", textContent: "Télécharger" });
  const download = el("button", { className: "btn dl", type: "button" }, [fill, label]);
  const message = el("div", { className: "message", role: "status" });
  const panel = el("div", { className: "panel", hidden: true }, [
    title,
    el("label", { textContent: "Qualité" }, [quality]),
    el("label", { textContent: "Nom de la vidéo" }, [nameInput]),
    el("label", { textContent: "Taille maximale (Mo, 20 max, facultatif)" }, [maxSize]),
    el("label", { className: "check" }, [clip, " Découper la vidéo"]),
    el("div", { className: "row" }, [
      el("label", { textContent: "Début (s)" }, [startInput]),
      el("label", { textContent: "Fin (s)" }, [endInput]),
    ]),
    el("div", { className: "actions" }, [download, side]),
    el("div", { className: "status" }, [message]),
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
  let nameEdited = false;
  let currentUrl = location.href;

  function setRunning(value) {
    running = value;
    download.disabled = value;
    download.classList.toggle("running", value);
    setSide(value ? "cancel" : "close"); // a successful run then switches it to the folder
    if (!value) { fill.style.width = "0"; label.textContent = "Télécharger"; }
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
        if (!nameEdited) nameInput.value = String(reply.data.title || ""); // never overwrite what the user typed
      } else if (reply.type === "error") {
        title.textContent = "MediaDownloader";
        probedUrl = null; // retry on next open
        say(lib.errorText(reply.code, reply.message), "error");
      }
    });
  }

  function start() {
    // Timecodes are ignored while the box is unchecked; once checked, start and end are both required.
    const startTime = clip.checked ? lib.parseTime(startInput.value) : null;
    const endTime = clip.checked ? lib.parseTime(endInput.value) : null;
    const size = lib.parseMaxSize(maxSize.value);
    const rangeError = clip.checked && (startTime === null || endTime === null) && !Number.isNaN(startTime) && !Number.isNaN(endTime)
      ? "Renseignez le début et la fin du découpage." : lib.validateRange(startTime, endTime);
    if (rangeError) return say(rangeError, "error");
    if (Number.isNaN(size)) return say("La taille maximale doit être comprise entre 0 et " + lib.MAX_SIZE_MB + " Mo.", "error");
    setRunning(true);
    fill.style.width = "0";
    label.textContent = "Démarrage…";
    say("");
    request(lib.buildDownloadRequest({
      url: lib.canonicalUrl(location.href), quality: quality.value, maxSizeMb: size, start: startTime, end: endTime, name: nameInput.value,
    }), (reply) => {
      if (reply.type === "progress") {
        fill.style.width = Math.min(100, Math.max(0, Number(reply.percent) || 0)) + "%";
        label.textContent = lib.progressText(reply.stage, reply.percent, reply.pass);
      } else if (reply.type === "completed") {
        setRunning(false);
        say("Terminé", "ok");
        setSide("folder");
      } else if (reply.type === "error") {
        setRunning(false);
        say(lib.errorText(reply.code, reply.message), "error");
      }
    });
  }

  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !running && probedUrl !== location.href) probe();
  });
  nameInput.addEventListener("input", () => { nameEdited = true; });
  clip.addEventListener("change", () => { startInput.disabled = endInput.disabled = !clip.checked; });
  side.addEventListener("click", () => {
    if (sideMode === "cancel") request({ type: "cancel" }, () => {});
    else if (sideMode === "close") panel.hidden = true;
    else request({ type: "openFolder" }, (reply) => {
      if (reply.type === "error") say(lib.errorText(reply.code, reply.message), "error");
    });
  });
  download.addEventListener("click", start);

  // SPA navigation: YouTube changes the URL without reloading.
  function sync() {
    const visible = lib.isVideoPage(location.href);
    if (visible && !host.isConnected) document.documentElement.append(host);
    if (!visible && host.isConnected) host.remove();
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      if (!running) {
        probedUrl = null;
        nameInput.value = "";
        nameEdited = false;
        title.textContent = "MediaDownloader";
        setSide("close");
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
