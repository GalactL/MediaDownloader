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
    if (message && message.kind === "toggle") return void toggle();
    if (!message || message.kind !== "host" || !message.message) return;
    const reply = message.message;
    const handler = handlers.get(reply.id);
    if (!handler) return;
    if (["completed", "error", "probe", "opened", "folderPicked"].includes(reply.type)) handlers.delete(reply.id);
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
  const fab = el("button", { className: "fab", hidden: true, type: "button", title: "MediaDownloader", textContent: "⬇" });

  // Outline icons (currentColor).
  function icon(...paths) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const [name, value] of [["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.8"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"]])
      svg.setAttribute(name, value);
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }
  const ICON = {
    close: ["M6 6l12 12M18 6L6 18"],
    back: ["M19 12H5M12 19l-7-7 7-7"],
    folder: ["M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7ZM3 9h18"],
    clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"],
    download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
    save: ["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z", "M17 21v-8H7v8", "M7 3v5h8"],
    gear: ["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0z"],
  };
  const headButton = (label, paths, extra) => el("button", { className: "close", type: "button", title: label, ariaLabel: label, ...extra }, [icon(...paths)]);

  // Video summary
  const thumb = el("img", { className: "thumb", alt: "", hidden: true });
  const title = el("div", { className: "title", textContent: "MediaDownloader" });
  const meta = el("span", { className: "muted" });

  // Form. A .group is one bordered control: input + a suffix text, icon or button.
  const quality = el("select", { id: "quality" });
  const nameInput = el("input", { id: "name", type: "text", placeholder: "Titre de la vidéo" });
  const maxSize = el("input", { id: "size", type: "text", inputMode: "decimal", placeholder: "Facultatif" });
  const clip = el("input", { id: "trim", type: "checkbox", role: "switch" });
  const startInput = el("input", { id: "start", type: "text", placeholder: "00:00:00", ariaLabel: "Début, heures minutes secondes", disabled: true });
  const endInput = el("input", { id: "end", type: "text", placeholder: "00:12:48", ariaLabel: "Fin, heures minutes secondes", disabled: true });
  const group = (...children) => el("div", { className: "group" }, children);
  const tail = (...children) => el("span", { className: "tail", ariaHidden: "true" }, children);
  const field = (text, input, control = input) => el("div", { className: "field" }, [el("label", { htmlFor: input.id, textContent: text }), control]);
  const form = el("fieldset", {}, [
    field("Qualité", quality),
    field("Nom du fichier", nameInput),
    field("Taille maximale (Mo, 20 max, facultatif)", maxSize, group(maxSize, tail("Mo"))),
    el("div", { className: "trim" }, [
      el("label", { className: "check" }, ["Découper la vidéo", clip]),
      el("div", { className: "times" }, [
        field("Début", startInput, group(startInput, tail(icon(...ICON.clock)))),
        field("Fin", endInput, group(endInput, tail(icon(...ICON.clock)))),
      ]),
    ]),
  ]);

  // Side button (square, next to Télécharger): only while running (cancel) and once done (open folder).
  const SIDE = { cancel: { label: "Annuler", icon: ICON.close }, folder: { label: "Ouvrir le dossier", icon: ICON.folder } };
  const side = el("button", { className: "secondary", type: "button", hidden: true });
  let sideMode = "idle";
  function setSide(mode) {
    sideMode = mode;
    side.hidden = !SIDE[mode];
    if (!SIDE[mode]) return;
    side.replaceChildren(icon(...SIDE[mode].icon));
    side.title = SIDE[mode].label;
    side.setAttribute("aria-label", SIDE[mode].label);
  }
  setSide("idle");

  // Progress fills the primary button from behind (.fill); the state text sits on top.
  const fill = el("span", { className: "fill" });
  const label = el("span", { className: "label", textContent: "Télécharger" });
  const download = el("button", { className: "primary", type: "button" }, [fill, icon(...ICON.download), label]);
  const status = el("span");
  const statusBox = el("div", { className: "status", role: "status" }, [status]);
  function setStatus(text, kind) { // kind: "ready" | "busy" | "error" (colours the dot); empty text hides the line
    status.textContent = text;
    statusBox.dataset.kind = kind || "";
  }
  setStatus("Prêt à télécharger", "ready");
  const notice = el("p", { className: "notice", role: "status", hidden: true });

  // Settings. Radio groups are native fieldset + radios.
  function radioGroup(name, legend, options, stack) {
    const inputs = options.map(([value]) => el("input", { type: "radio", name, value }));
    const node = el("fieldset", { className: "field" }, [
      el("legend", { textContent: legend }),
      el("div", { className: "choices" + (stack ? " stack" : "") }, options.map(([, text], i) => el("label", { className: "choice" }, [inputs[i], text]))),
    ]);
    return { node, get: () => inputs.find((i) => i.checked).value, set: (v) => inputs.forEach((i) => { i.checked = i.value === v; }) };
  }
  const DIR_HINT = "Par défaut : dossier Vidéos.";
  const dirInput = el("input", { id: "dir", type: "text", placeholder: "Dossier Vidéos par défaut", spellcheck: false });
  const browse = el("button", { className: "browse", type: "button", title: "Parcourir…", ariaLabel: "Parcourir…" }, [icon(...ICON.folder)]);
  const dirHint = el("span", { className: "muted hint", textContent: DIR_HINT });
  const themeChoice = radioGroup("theme", "Thème", [["light", "Clair"], ["dark", "Sombre"]]);
  const modeChoice = radioGroup("mode", "Affichage du bouton", [["page", "Sur la page"], ["icon", "Icône de la barre uniquement"]], true);
  const settingsNotice = el("p", { className: "notice", role: "status", hidden: true });
  const save = el("button", { className: "primary", type: "button" }, [icon(...ICON.save), "Enregistrer"]);

  const gear = headButton("Réglages", ICON.gear);
  const back = headButton("Retour", ICON.back);
  const sep = el("span", { className: "sep", ariaHidden: "true" });
  const cardOf = (id, name, view, headLeft, headRight, body) => {
    const card = el("section", { className: "card " + view }, [
      el("header", {}, [
        el("div", { className: "head-left" }, [...headLeft, el("div", {}, [el("h3", { id, textContent: name }), el("span", { className: "brand", textContent: "MediaDownloader" })])]),
        el("div", { className: "head-right" }, headRight),
      ]),
      ...body,
    ]);
    card.setAttribute("aria-labelledby", id);
    return card;
  };
  const mainCard = cardOf("h-main", "Télécharger la vidéo", "main", [], [gear, sep, headButton("Fermer", ICON.close)], [
    el("div", { className: "video" }, [thumb, el("div", {}, [title, meta])]),
    form,
    statusBox,
    notice,
    el("div", { className: "actions" }, [download, side]),
  ]);
  const settingsCard = cardOf("h-settings", "Réglages", "settings", [back], [headButton("Fermer", ICON.close)], [
    el("div", { className: "body" }, [
      el("div", { className: "field" }, [el("label", { htmlFor: "dir", textContent: "Dossier de téléchargement" }), group(dirInput, browse), dirHint]),
      el("hr"),
      themeChoice.node,
      el("hr"),
      modeChoice.node,
      settingsNotice,
      el("div", { className: "actions" }, [save]),
    ]),
  ]);
  // Two sibling cards in one clipped box: the view switch slides them (CSS, off with reduced motion).
  const panel = el("div", { className: "dialog", hidden: true }, [mainCard, settingsCard]);
  panel.dataset.view = "main";
  shadow.append(style, fab, panel);
  // Typing in the box must not trigger the page's shortcuts (space, k, f, arrows...): events leave the shadow root retargeted to the host.
  for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (event) => event.stopPropagation());

  // Green check that draws itself (see .check-mark in content.css).
  function checkmark() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.setAttribute("class", "check-mark");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    path.setAttribute("d", "M5 12.5l4.5 4.5L19 7.5");
    path.setAttribute("pathLength", "1");
    svg.append(path);
    return svg;
  }

  function say(text, kind, box = notice) { // kind: "ok" | "error"; empty text hides the notice
    box.textContent = text ? (kind === "ok" ? "✓ " : "") + text : "";
    box.className = "notice" + (kind === "ok" ? " success" : kind === "error" ? " error" : "");
    box.hidden = !text;
    box.setAttribute("role", kind === "error" ? "alert" : "status");
  }

  // Settings: persisted in storage.local, applied live (also when changed from another tab).
  let settings = lib.normalizeSettings();
  function fillSettings() {
    dirInput.value = settings.outputDirectory;
    themeChoice.set(settings.theme);
    modeChoice.set(settings.buttonMode);
  }
  function applySettings(next) {
    settings = next;
    host.dataset.theme = next.theme;
    fab.hidden = next.buttonMode === "icon";
    if (panel.dataset.view !== "settings") fillSettings(); // never clobber an edit in progress
  }
  function setView(name) {
    const inSettings = name === "settings";
    panel.dataset.view = name;
    // The outgoing card is inert and hidden from assistive tech at once; CSS drops its visibility once the slide ends.
    for (const [card, active] of [[mainCard, !inSettings], [settingsCard, inSettings]]) {
      card.inert = !active;
      if (active) card.removeAttribute("aria-hidden"); else card.setAttribute("aria-hidden", "true");
    }
    if (inSettings) { fillSettings(); say("", "", settingsNotice); }
    // preventScroll: the incoming card is still offset, focusing it must not scroll the clipped box.
    if (!panel.hidden) (inSettings ? settingsCard : mainCard).querySelector("button, input, select").focus({ preventScroll: true });
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
    setSide(value ? "cancel" : "idle"); // a successful run then switches it to the folder
    setStatus(value ? "En cours…" : "Prêt à télécharger", value ? "busy" : "ready");
    if (!value) { fill.style.width = "0"; label.textContent = "Télécharger"; }
  }

  // After a result, any edit goes back to the idle state.
  function resetResult() {
    if (running || !download.classList.contains("complete")) return;
    download.classList.remove("complete");
    download.disabled = false;
    label.textContent = "Télécharger";
    setStatus("Prêt à télécharger", "ready");
    setSide("idle");
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
    fill.style.transition = "";
    fill.style.width = "0";
    label.textContent = "Démarrage…";
    const startedAt = Date.now();
    const requestedDir = settings.outputDirectory;
    let usedDir = "";
    say("");
    request(lib.buildDownloadRequest({
      url: lib.canonicalUrl(location.href), quality: quality.value, maxSizeMb: size, start: startTime, end: endTime, name: nameInput.value, outputDirectory: settings.outputDirectory,
    }), (reply) => {
      if (reply.type === "started") {
        usedDir = String(reply.outputDirectory || "");
      } else if (reply.type === "progress") {
        fill.style.width = Math.min(100, Math.max(0, Number(reply.percent) || 0)) + "%";
        label.textContent = lib.progressText(reply.stage, reply.percent, reply.pass).replace(" : ", "… ");
      } else if (reply.type === "completed") {
        // Very short jobs still show a full left-to-right run: the bar fills to 100 % over whatever is left of one second.
        const left = Math.max(0, 1000 - (Date.now() - startedAt));
        const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
        label.textContent = lib.progressText("download", 100);
        fill.style.transition = calm ? "none" : "width " + Math.max(left, 200) + "ms linear";
        fill.style.width = "100%";
        setTimeout(() => {
          fill.style.transition = "";
          setRunning(false);
          download.classList.add("complete");
          download.disabled = true;
          label.replaceChildren(checkmark(), "Terminé");
          setStatus("");
          setSide("folder");
          // The engine fell back to the Videos folder: say where the file really went.
          if (requestedDir && usedDir && !lib.sameFolder(requestedDir, usedDir))
            say("Le dossier choisi est inutilisable : la vidéo a été enregistrée dans " + usedDir + ".");
        }, calm ? 0 : Math.max(left, 200));
      } else if (reply.type === "error") {
        setRunning(false);
        fill.style.transition = "";
        setStatus("Interrompu", "error");
        say(lib.errorText(reply.code, reply.message), "error");
      }
    });
  }

  function toggle() {
    if (!host.isConnected) return; // not on a video page: no box to show
    panel.hidden = !panel.hidden;
    if (panel.hidden) setView("main");
    if (!panel.hidden && !running && probedUrl !== location.href) probe();
  }
  fab.addEventListener("click", toggle);
  const closeBox = () => { panel.hidden = true; setView("main"); };
  gear.addEventListener("click", () => setView("settings"));
  back.addEventListener("click", () => setView("main"));
  const pickLabel = (text) => { browse.title = text; browse.setAttribute("aria-label", text); };
  browse.addEventListener("click", () => {
    browse.disabled = true;
    pickLabel("Sélection…");
    dirHint.textContent = "Sélection du dossier en cours…";
    say("", "", settingsNotice);
    request({ type: "pickFolder" }, (reply) => {
      browse.disabled = false;
      pickLabel("Parcourir…");
      dirHint.textContent = DIR_HINT;
      if (reply.type === "folderPicked" && reply.path) dirInput.value = String(reply.path); // no path = cancelled; saved only by « Enregistrer »
      else if (reply.type === "error") say(lib.errorText(reply.code, reply.message), "error", settingsNotice);
    });
  });
  save.addEventListener("click", () => {
    const error = lib.validateOutputDirectory(dirInput.value);
    if (error) return say(error, "error", settingsNotice);
    const next = lib.normalizeSettings({ outputDirectory: dirInput.value, theme: themeChoice.get(), buttonMode: modeChoice.get() });
    browser.storage.local.set({ settings: next }).then(() => {
      applySettings(next);
      setView("main");
      say("Réglages enregistrés.", "ok");
    }).catch(() => say("Impossible d'enregistrer les réglages.", "error", settingsNotice));
  });
  browser.storage.local.get("settings").then((stored) => applySettings(lib.normalizeSettings(stored.settings))).catch(() => applySettings(settings));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) applySettings(lib.normalizeSettings(changes.settings.newValue));
  });
  for (const button of shadow.querySelectorAll("header .close[title=Fermer]")) button.addEventListener("click", closeBox);
  nameInput.addEventListener("input", () => { nameEdited = true; });
  clip.addEventListener("change", () => { startInput.disabled = endInput.disabled = !clip.checked; });
  form.addEventListener("input", resetResult);
  form.addEventListener("change", resetResult);
  side.addEventListener("click", () => {
    if (sideMode === "cancel") request({ type: "cancel" }, () => {});
    else request({ type: "openFolder" }, (reply) => {
      if (reply.type === "error") say(lib.errorText(reply.code, reply.message), "error");
    });
  });
  download.addEventListener("click", start);

  setView("main"); // marks the settings card inert from the start

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
        label.textContent = "Télécharger";
        setStatus("Prêt à télécharger", "ready");
        setSide("idle");
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
