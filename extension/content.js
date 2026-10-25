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

  // Header and video summary
  const closeX = el("button", { className: "close", type: "button", textContent: "×", title: "Fermer", ariaLabel: "Fermer" });
  const thumb = el("img", { className: "thumb", alt: "", hidden: true });
  const title = el("div", { className: "title", textContent: "MediaDownloader" });
  const meta = el("span", { className: "muted" });

  // Form
  const quality = el("select", { id: "quality" });
  const nameInput = el("input", { id: "name", type: "text", placeholder: "Titre de la vidéo" });
  const maxSize = el("input", { id: "size", type: "text", inputMode: "decimal", placeholder: "Ex. : 20" });
  const clip = el("input", { id: "trim", type: "checkbox" });
  const startInput = el("input", { id: "start", type: "text", placeholder: "00:00:00", ariaLabel: "Début, heures minutes secondes", disabled: true });
  const endInput = el("input", { id: "end", type: "text", placeholder: "00:12:48", ariaLabel: "Fin, heures minutes secondes", disabled: true });
  const field = (text, input) => el("div", { className: "field" }, [el("label", { htmlFor: input.id, textContent: text }), input]);
  const form = el("fieldset", {}, [
    field("Qualité", quality),
    field("Nom de la vidéo", nameInput),
    field("Taille maximale (Mo, 20 max, facultatif)", maxSize),
    el("label", { className: "check" }, [clip, "Découper la vidéo"]),
    el("div", { className: "times" }, [field("Début", startInput), field("Fin", endInput)]),
  ]);

  // Side button (square, next to Télécharger): close -> cancel while running -> open folder once done. Outline icons (currentColor).
  const SIDE = {
    close: { label: "Fermer", path: "M6 6l12 12M18 6L6 18" },
    cancel: { label: "Annuler", path: "M6 6l12 12M18 6L6 18" },
    folder: { label: "Ouvrir le dossier", path: "M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7ZM3 9h18" },
  };
  const side = el("button", { className: "secondary", type: "button" });
  let sideMode = "close";
  function setSide(mode) {
    sideMode = mode;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const [name, value] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.8"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]])
      svg.setAttribute(name, value);
    path.setAttribute("d", SIDE[mode].path);
    svg.append(path);
    side.replaceChildren(svg);
    side.title = SIDE[mode].label;
    side.setAttribute("aria-label", SIDE[mode].label);
  }
  setSide("close");

  // Progress fills the primary button from behind (CSS ::before, --progress); the state text sits on top.
  const download = el("button", { className: "primary", type: "button", textContent: "Télécharger" });
  const status = el("span", { textContent: "Prêt à télécharger" });
  const notice = el("p", { className: "notice", role: "status", hidden: true });
  const panel = el("article", { className: "dialog", hidden: true }, [
    el("header", {}, [
      el("div", {}, [el("h3", { textContent: "Télécharger la vidéo" }), el("span", { className: "brand", textContent: "MediaDownloader" })]),
      closeX,
    ]),
    el("div", { className: "video" }, [thumb, el("div", {}, [title, meta])]),
    form,
    el("div", { className: "status", role: "status" }, [status]),
    notice,
    el("div", { className: "actions" }, [download, side]),
  ]);
  shadow.append(style, fab, panel);

  function say(text, kind) { // kind: "ok" | "error"; empty text hides the notice
    notice.textContent = text ? (kind === "ok" ? "✓ " : "") + text : "";
    notice.className = "notice" + (kind === "ok" ? " success" : kind === "error" ? " error" : "");
    notice.hidden = !text;
    notice.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  function setQualities(heights) {
    quality.replaceChildren(...lib.qualityOptions(heights).map((o) => el("option", { value: o.value, textContent: o.label })));
  }

  function duration(seconds) {
    const total = Math.round(Number(seconds));
    if (!(total > 0)) return "";
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
  }

  // State
  let probedUrl = null;   // page URL already probed (or being probed)
  let running = false;
  let nameEdited = false;
  let currentUrl = location.href;

  function setRunning(value) {
    running = value;
    form.disabled = download.disabled = value;
    download.classList.remove("complete");
    download.classList.toggle("loading", value);
    download.toggleAttribute("aria-busy", value);
    setSide(value ? "cancel" : "close"); // a successful run then switches it to the folder
    status.textContent = value ? "En cours…" : "Prêt à télécharger";
    if (!value) { download.style.removeProperty("--progress"); download.textContent = "Télécharger"; }
  }

  // After a result, any edit goes back to the idle state.
  function resetResult() {
    if (running || !download.classList.contains("complete")) return;
    download.classList.remove("complete");
    download.disabled = false;
    download.textContent = "Télécharger";
    status.textContent = "Prêt à télécharger";
    setSide("close");
    say("");
  }

  function resetVideo() {
    thumb.hidden = true;
    thumb.removeAttribute("src");
    meta.textContent = "";
    title.textContent = "MediaDownloader";
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
        meta.textContent = [duration(reply.data.duration), "Vidéo"].filter(Boolean).join(" · ");
        if (/^https:\/\//.test(reply.data.thumbnail || "")) { thumb.src = reply.data.thumbnail; }
        setQualities(reply.data.heights);
        if (!nameEdited) nameInput.value = String(reply.data.title || ""); // never overwrite what the user typed
      } else if (reply.type === "error") {
        resetVideo();
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
    download.style.setProperty("--progress", "0%");
    download.textContent = "Démarrage…";
    say("");
    request(lib.buildDownloadRequest({
      url: lib.canonicalUrl(location.href), quality: quality.value, maxSizeMb: size, start: startTime, end: endTime, name: nameInput.value,
    }), (reply) => {
      if (reply.type === "progress") {
        download.style.setProperty("--progress", Math.min(100, Math.max(0, Number(reply.percent) || 0)) + "%");
        download.textContent = lib.progressText(reply.stage, reply.percent, reply.pass).replace(" : ", "… ");
      } else if (reply.type === "completed") {
        setRunning(false);
        download.classList.add("complete");
        download.disabled = true;
        download.textContent = "Terminé";
        status.textContent = "Téléchargement terminé";
        say("Vidéo téléchargée.", "ok");
        setSide("folder");
      } else if (reply.type === "error") {
        setRunning(false);
        status.textContent = "Interrompu";
        say(lib.errorText(reply.code, reply.message), "error");
      }
    });
  }

  fab.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !running && probedUrl !== location.href) probe();
  });
  closeX.addEventListener("click", () => { panel.hidden = true; });
  nameInput.addEventListener("input", () => { nameEdited = true; });
  clip.addEventListener("change", () => { startInput.disabled = endInput.disabled = !clip.checked; });
  form.addEventListener("input", resetResult);
  form.addEventListener("change", resetResult);
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
        resetVideo();
        download.classList.remove("complete");
        download.disabled = false;
        download.textContent = "Télécharger";
        status.textContent = "Prêt à télécharger";
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
