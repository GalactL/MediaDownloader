"use strict";

(function () {
  const lib = globalThis.MDLib;
  const i18n = globalThis.MDI18n;
  const sites = globalThis.MDSites;
  // Every visible string comes from the catalogue (i18n.js). `bind` registers a renderer that runs now and again on a language change.
  let language = i18n.resolveLanguage("auto", navigator.languages);
  const t = (key, params) => i18n.translate(language, key, params);
  const bindings = [];
  const bind = (render) => { bindings.push(render); render(); };
  const text = (node, key, prop = "textContent", params) => bind(() => { node[prop] = t(key, params && params()); });
  let requestCounter = 0;
  const handlers = new Map(); // client id -> callback(message)

  function request(payload, onMessage) {
    const id = String(++requestCounter);
    handlers.set(id, onMessage);
    browser.runtime.sendMessage({ id, payload }).catch(() => {
      handlers.delete(id);
      onMessage({ type: "error", id, code: "host_disconnected" });
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
    discord: ["M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"],
    close: ["M6 6l12 12M18 6L6 18"],
    back: ["M19 12H5M12 19l-7-7 7-7"],
    folder: ["M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7ZM3 9h18"],
    clock: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 7v5l3 2"],
    download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
    save: ["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z", "M17 21v-8H7v8", "M7 3v5h8"],
    gear: ["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0z"],
  };
  const headButton = (labelKey, paths, extra) => {
    const button = el("button", { className: "close", type: "button", ...extra }, [icon(...paths)]);
    text(button, labelKey, "title");
    text(button, labelKey, "ariaLabel");
    return button;
  };

  // Video summary
  const thumb = el("img", { className: "thumb", alt: "", hidden: true });
  const title = el("div", { className: "title" });
  const meta = el("span", { className: "muted" });
  // titleText = the real video title when known; otherwise the catalogue key to show.
  let video = { titleKey: "app.name", titleText: "", duration: "", shown: false };
  function renderVideo() {
    title.textContent = video.titleText || t(video.titleKey);
    meta.textContent = video.shown ? [video.duration, t("video.word")].filter(Boolean).join(" · ") : "";
  }
  bind(renderVideo);

  // Form. A .group is one bordered control: input + a suffix text, icon or button.
  const quality = el("select", { id: "quality" });
  const nameInput = el("input", { id: "name", type: "text" });
  text(nameInput, "field.namePlaceholder", "placeholder");
  const maxSize = el("input", { id: "size", type: "text", inputMode: "decimal" });
  text(maxSize, "field.optional", "placeholder");
  const discord = el("button", { className: "discord", type: "button", textContent: lib.DISCORD_SIZE_MB + " Mo" });
  text(discord, "action.discord", "title");
  text(discord, "action.discord", "ariaLabel");
  discord.prepend(icon(...ICON.discord));
  discord.addEventListener("click", () => { maxSize.value = String(lib.DISCORD_SIZE_MB); maxSize.dispatchEvent(new Event("input", { bubbles: true })); });
  const clip = el("input", { id: "trim", type: "checkbox", role: "switch" });
  // The timecode examples are not language-dependent; the end one follows the analysed video (reset with it).
  const startInput = el("input", { id: "start", type: "text", placeholder: "00:00:00", disabled: true });
  const endInput = el("input", { id: "end", type: "text", placeholder: "00:00:00", disabled: true });
  text(startInput, "field.startAria", "ariaLabel");
  text(endInput, "field.endAria", "ariaLabel");
  const group = (...children) => el("div", { className: "group" }, children);
  const tail = (...children) => el("span", { className: "tail", ariaHidden: "true" }, children);
  // A node whose text follows the language.
  const tr = (key, params, tag = "span") => { const node = el(tag); text(node, key, "textContent", params); return node; };
  const field = (key, input, control = input, params) => el("div", { className: "field" }, [el("label", { htmlFor: input.id }, [tr(key, params, "span")]), control]);
  const form = el("fieldset", {}, [
    field("field.quality", quality),
    field("field.name", nameInput),
    field("field.maxSize", maxSize, group(maxSize, tail(tr("unit.mb")), discord)),
    el("div", { className: "trim" }, [
      el("label", { className: "check" }, [tr("field.trim"), clip]),
      el("div", { className: "times" }, [
        field("field.start", startInput, group(startInput, tail(icon(...ICON.clock)))),
        field("field.end", endInput, group(endInput, tail(icon(...ICON.clock)))),
      ]),
    ]),
  ]);

  // Side button (square, next to Télécharger): only while running (cancel) and once done (open folder).
  const SIDE = { cancel: { labelKey: "action.cancel", icon: ICON.close }, folder: { labelKey: "action.openFolder", icon: ICON.folder } };
  const side = el("button", { className: "secondary", type: "button", hidden: true });
  let sideMode = "idle";
  function setSide(mode) {
    sideMode = mode;
    side.hidden = !SIDE[mode];
    if (!SIDE[mode]) return;
    side.replaceChildren(icon(...SIDE[mode].icon));
    renderSide();
  }
  function renderSide() {
    if (!SIDE[sideMode]) return;
    side.title = t(SIDE[sideMode].labelKey);
    side.setAttribute("aria-label", t(SIDE[sideMode].labelKey));
  }
  setSide("idle");
  bind(renderSide);

  // Progress fills the primary button from behind (.fill); the state text sits on top.
  const fill = el("span", { className: "fill" });
  const label = el("span", { className: "label" });
  const download = el("button", { className: "primary", type: "button" }, [fill, icon(...ICON.download), label]);
  // Download button label: idle | progress (last `progress` reply) | done.
  let labelState = { kind: "idle" };
  let jobHasEncode = false;
  let barPercent = 0;
  function renderLabel() {
    if (labelState.kind === "done") return label.replaceChildren(checkmark(), t("status.done"));
    if (labelState.kind === "idle") {
      fill.classList.remove("indeterminate");
      return void (label.textContent = t("action.download"));
    }
    // The bar follows the whole job (monotonic); phases without a number get an indeterminate bar, never a frozen one.
    const view = lib.progressView(language, labelState.reply, jobHasEncode);
    label.textContent = view.text;
    fill.classList.toggle("indeterminate", view.percent === null);
    if (view.percent !== null) {
      barPercent = Math.max(barPercent, view.percent);
      fill.style.width = barPercent + "%";
    }
  }
  function setLabel(state) { labelState = state; renderLabel(); }
  bind(renderLabel);
  const status = el("span");
  const statusBox = el("div", { className: "status", role: "status" }, [status]);
  let statusState = { key: "status.ready", kind: "ready" };
  function renderStatus() {
    status.textContent = statusState.key ? t(statusState.key) : "";
    statusBox.dataset.kind = statusState.kind;
  }
  function setStatus(key, kind) { // kind: "ready" | "busy" | "error" (colours the dot); empty key hides the line
    statusState = { key, kind: kind || "" };
    renderStatus();
  }
  bind(renderStatus);
  const notice = el("p", { className: "notice", role: "status", hidden: true });

  // Settings. Radio groups are native fieldset + radios.
  function radioGroup(name, legendKey, options, stack) {
    const inputs = options.map(([value]) => el("input", { type: "radio", name, value }));
    const node = el("fieldset", { className: "field" }, [
      el("legend", {}, [tr(legendKey)]),
      el("div", { className: "choices" + (stack ? " stack" : "") }, options.map(([, key], i) => el("label", { className: "choice" }, [inputs[i], tr(key)]))),
    ]);
    return { node, get: () => inputs.find((i) => i.checked).value, set: (v) => inputs.forEach((i) => { i.checked = i.value === v; }) };
  }
  const dirInput = el("input", { id: "dir", type: "text", spellcheck: false });
  text(dirInput, "settings.dirPlaceholder", "placeholder");
  const browse = el("button", { className: "browse", type: "button" }, [icon(...ICON.folder)]);
  const dirHint = el("span", { className: "muted hint" });
  let picking = false;
  function renderBrowse() {
    const name = t(picking ? "settings.picking" : "settings.browse");
    browse.title = name;
    browse.setAttribute("aria-label", name);
    dirHint.textContent = t(picking ? "settings.pickingHint" : "settings.dirHint");
  }
  bind(renderBrowse);
  const themeChoice = radioGroup("theme", "settings.theme", [["light", "settings.themeLight"], ["dark", "settings.themeDark"]]);
  const modeChoice = radioGroup("mode", "settings.button", [["page", "settings.buttonPage"], ["icon", "settings.buttonIcon"]], true);
  const langSelect = el("select", { id: "lang" });
  function renderLanguages() {
    const keep = langSelect.value || "auto";
    langSelect.replaceChildren(el("option", { value: "auto", textContent: t("settings.languageAuto") }),
      ...i18n.LANGUAGES.map((code) => el("option", { value: code, textContent: t("lang." + code) })));
    langSelect.value = keep;
  }
  bind(renderLanguages);
  const lowInput = el("input", { id: "low", type: "checkbox", role: "switch" });
  const settingsNotice = el("p", { className: "notice", role: "status", hidden: true });
  const save = el("button", { className: "primary", type: "button" }, [icon(...ICON.save), tr("action.save")]);

  const gear = headButton("settings.title", ICON.gear);
  const back = headButton("action.back", ICON.back);
  const sep = el("span", { className: "sep", ariaHidden: "true" });
  const cardOf = (id, nameKey, view, headLeft, headRight, body) => {
    const card = el("section", { className: "card " + view }, [
      el("header", {}, [
        el("div", { className: "head-left" }, [...headLeft, el("div", {}, [el("h3", { id }, [tr(nameKey)]), el("span", { className: "brand" }, [tr("app.name")])])]),
        el("div", { className: "head-right" }, headRight),
      ]),
      ...body,
    ]);
    card.setAttribute("aria-labelledby", id);
    return card;
  };
  const mainCard = cardOf("h-main", "main.title", "main", [], [gear, sep, headButton("action.close", ICON.close, { className: "close closer" })], [
    el("div", { className: "video" }, [thumb, el("div", {}, [title, meta])]),
    form,
    statusBox,
    notice,
    el("div", { className: "actions" }, [download, side]),
  ]);
  const settingsCard = cardOf("h-settings", "settings.title", "settings", [back], [headButton("action.close", ICON.close, { className: "close closer" })], [
    el("div", { className: "body" }, [
      el("div", { className: "field" }, [el("label", { htmlFor: "dir" }, [tr("settings.dir")]), group(dirInput, browse), dirHint]),
      el("hr"),
      themeChoice.node,
      el("hr"),
      modeChoice.node,
      el("hr"),
      el("div", { className: "field" }, [el("label", { htmlFor: "lang" }, [tr("settings.language")]), langSelect]),
      el("hr"),
      el("div", { className: "field" }, [
        el("label", { className: "check" }, [tr("settings.lowResources"), lowInput]),
        el("span", { className: "muted hint" }, [tr("settings.lowResourcesHint")]),
      ]),
      settingsNotice,
      el("div", { className: "actions" }, [save]),
    ]),
  ]);
  // Two sibling cards in one clipped box: the view switch slides them (CSS, off with reduced motion).
  const panel = el("div", { className: "dialog", hidden: true }, [mainCard, settingsCard]);
  panel.dataset.view = "main";
  shadow.append(style, panel);
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

  // Notices keep their catalogue key so a language change re-renders them. Empty key hides the notice.
  const notices = new Map(); // box -> { key, params, kind } | null
  function renderNotice(box) {
    const current = notices.get(box);
    box.textContent = current ? (current.kind === "ok" ? "✓ " : "") + t(current.key, current.params) : "";
    if (current && current.key === "error.host_disconnected") box.append(" ", el("a", { href: lib.INSTALL_URL, target: "_blank", rel: "noopener", textContent: lib.INSTALL_URL }));
    box.className = "notice" + (current && current.kind === "ok" ? " success" : current && current.kind === "error" ? " error" : "");
    box.hidden = !current;
    box.setAttribute("role", current && current.kind === "error" ? "alert" : "status");
  }
  function say(key, kind, box = notice, params) { // kind: "ok" | "error"
    notices.set(box, key ? { key, params, kind } : null);
    renderNotice(box);
  }
  bind(() => notices.forEach((_, box) => renderNotice(box)));

  // Settings: persisted in storage.local, applied live (also when changed from another tab).
  let settings = lib.normalizeSettings();
  function fillSettings() {
    dirInput.value = settings.outputDirectory;
    themeChoice.set(settings.theme);
    modeChoice.set(settings.buttonMode);
    langSelect.value = settings.language;
    lowInput.checked = settings.lowResources;
  }

  // Reduced animations: the resource-saving option or the system preference (the CSS reads [data-calm]).
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const isCalm = () => lib.isCalm(settings, motion.matches);
  const applyMotion = () => host.toggleAttribute("data-calm", isCalm());
  motion.addEventListener("change", applyMotion);
  // SPA navigation fallback (pushState fires no event). Resource saving relies on YouTube's events only, so nothing ticks while idle.
  let poll = null;
  function applyPolling() {
    if (settings.lowResources) { clearInterval(poll); poll = null; }
    else if (poll === null) poll = setInterval(sync, 1000);
  }
  function applySettings(next) {
    settings = next;
    host.dataset.theme = next.theme;
    applyMotion();
    applyPolling();
    syncButton();
    const resolved = i18n.resolveLanguage(next.language, navigator.languages);
    if (resolved !== language) {
      language = resolved;
      host.lang = resolved;
      bindings.forEach((render) => render());
    }
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

  let heights = [];
  function renderQualities() {
    const keep = quality.value;
    quality.replaceChildren(...lib.qualityOptions(heights, language).map((o) => el("option", { value: o.value, textContent: o.label })));
    if ([...quality.options].some((o) => o.value === keep)) quality.value = keep;
  }
  function setQualities(list) { heights = list; renderQualities(); }
  bind(renderQualities);

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
  const pageUrl = () => lib.canonicalUrl(location.href); // same post = same URL (X /photo/1, tracking parameters)
  let currentUrl = pageUrl();

  function setRunning(value) {
    running = value;
    form.disabled = download.disabled = value;
    download.classList.remove("complete");
    download.classList.toggle("loading", value);
    download.toggleAttribute("aria-busy", value);
    setSide(value ? "cancel" : "idle"); // a successful run then switches it to the folder
    setStatus(value ? "status.running" : "status.ready", value ? "busy" : "ready");
    if (!value) { fill.style.width = "0"; barPercent = 0; setLabel({ kind: "idle" }); }
  }

  // After a result, any edit goes back to the idle state.
  function resetResult() {
    if (running || !download.classList.contains("complete")) return;
    download.classList.remove("complete");
    download.disabled = false;
    setLabel({ kind: "idle" });
    setStatus("status.ready", "ready");
    setSide("idle");
    say("");
  }

  function resetVideo() {
    thumb.hidden = true;
    thumb.removeAttribute("src");
    video = { titleKey: "app.name", titleText: "", duration: "", shown: false };
    renderVideo();
    endInput.placeholder = lib.timecode(0);
  }

  let probing = false; // a probe is in flight; the host runs one job at a time, so a new one waits for it to end
  function probe() {
    if (probing) return void (probedUrl === pageUrl() || request({ type: "cancel" }, () => {})); // a stale probe is cancelled; its last reply restarts this one (below)
    const url = pageUrl();
    probedUrl = url;
    probing = true;
    video = { titleKey: "video.analyzing", titleText: "", duration: "", shown: false };
    renderVideo();
    setQualities([]);
    say("");
    request({ type: "probe", url }, (reply) => {
      if (reply.type === "probe" || reply.type === "error") probing = false;
      if (url !== pageUrl() || reply.code === "cancelled") { // navigated away meanwhile (or cancelled for that): drop the answer, analyse the page if the box is open
        if (!probing && !panel.hidden && !running && probedUrl !== pageUrl() && lib.isVideoPage(location.href)) probe();
        return;
      }
      if (reply.type === "probe" && reply.data) {
        video = { titleKey: "video.word", titleText: String(reply.data.title || ""), duration: duration(reply.data.duration), shown: true };
        renderVideo();
        if (/^https:\/\//.test(reply.data.thumbnail || "")) { thumb.src = reply.data.thumbnail; }
        setQualities(reply.data.heights);
        endInput.placeholder = lib.timecode(reply.data.duration);
        if (!nameEdited) nameInput.value = String(reply.data.title || ""); // never overwrite what the user typed
      } else if (reply.type === "error") {
        resetVideo();
        probedUrl = null; // retry on next open
        say(lib.errorKey(reply.code), "error");
      }
    });
  }

  function start() {
    // Timecodes are ignored while the box is unchecked; once checked, start and end are both required.
    const startTime = clip.checked ? lib.parseTime(startInput.value) : null;
    const endTime = clip.checked ? lib.parseTime(endInput.value) : null;
    const size = lib.parseMaxSize(maxSize.value);
    const rangeError = clip.checked && (startTime === null || endTime === null) && !Number.isNaN(startTime) && !Number.isNaN(endTime)
      ? "error.rangeRequired" : lib.validateRange(startTime, endTime);
    if (rangeError) return say(rangeError, "error");
    if (Number.isNaN(size)) return say("error.sizeRange", "error", notice);
    setRunning(true);
    fill.style.transition = "";
    fill.style.width = "0";
    barPercent = 0;
    jobHasEncode = size !== null;
    setLabel({ kind: "progress", reply: { stage: "inspection" } }); // phase name right away, never a frozen "starting"
    const startedAt = Date.now();
    const requestedDir = settings.outputDirectory;
    let usedDir = "";
    say("");
    request(lib.buildDownloadRequest({
      url: lib.canonicalUrl(location.href), quality: quality.value, maxSizeMb: size, start: startTime, end: endTime, name: nameInput.value, outputDirectory: settings.outputDirectory, lowResources: settings.lowResources,
    }), (reply) => {
      if (reply.type === "started") {
        usedDir = String(reply.outputDirectory || "");
      } else if (reply.type === "progress") {
        setLabel({ kind: "progress", reply: { stage: reply.stage, percent: reply.percent, pass: reply.pass } });
      } else if (reply.type === "phase") {
        setLabel({ kind: "progress", reply: { stage: reply.stage } }); // no percent: indeterminate bar
      } else if (reply.type === "completed") {
        // Very short jobs still show a full left-to-right run: the bar fills to 100 % over whatever is left of one second.
        const left = Math.max(0, 1000 - (Date.now() - startedAt));
        const calm = isCalm();
        fill.style.transition = calm ? "none" : "width " + Math.max(left, 200) + "ms linear";
        jobHasEncode = false;
        setLabel({ kind: "progress", reply: { stage: "download", percent: 100 } }); // fills the bar to 100 % and drops the stripes
        setTimeout(() => {
          fill.style.transition = "";
          setRunning(false);
          download.classList.add("complete");
          download.disabled = true;
          setLabel({ kind: "done" });
          setStatus("");
          setSide("folder");
          // The engine fell back to the Videos folder: say where the file really went.
          if (requestedDir && usedDir && !lib.sameFolder(requestedDir, usedDir))
            say("notice.dirFallback", "", notice, { dir: usedDir });
        }, calm ? 0 : Math.max(left, 200));
      } else if (reply.type === "error") {
        setRunning(false);
        fill.style.transition = "";
        setStatus("status.interrupted", "error");
        say(lib.errorKey(reply.code), "error");
      }
    });
  }

  function toggle() {
    sync(); // catches a navigation missed while polling is off
    if (!host.isConnected) return; // not on a video page: no box to show
    panel.hidden = !panel.hidden;
    for (const name of ["top", "left", "right", "bottom"]) panel.style[name] = ""; // fresh spot on each open
    placePanel();
    if (panel.hidden) setView("main");
    if (!panel.hidden && !running && probedUrl !== pageUrl()) probe();
  }
  window.addEventListener("resize", placePanel);
  new ResizeObserver(placePanel).observe(panel); // the box grows once the video is analysed or the view changes: keep it inside the viewport
  window.addEventListener("scroll", placePanel, { passive: true });
  const closeBox = () => { panel.hidden = true; setView("main"); };
  gear.addEventListener("click", () => setView("settings"));
  back.addEventListener("click", () => setView("main"));
  browse.addEventListener("click", () => {
    browse.disabled = true;
    picking = true;
    renderBrowse();
    say("", "", settingsNotice);
    request({ type: "pickFolder" }, (reply) => {
      browse.disabled = false;
      picking = false;
      renderBrowse();
      if (reply.type === "folderPicked" && reply.path) dirInput.value = String(reply.path); // no path = cancelled; saved only by « Enregistrer »
      else if (reply.type === "error") say(lib.errorKey(reply.code), "error", settingsNotice);
    });
  });
  save.addEventListener("click", () => {
    const error = lib.validateOutputDirectory(dirInput.value);
    if (error) return say(error, "error", settingsNotice);
    const next = lib.normalizeSettings({
      outputDirectory: dirInput.value, theme: themeChoice.get(), buttonMode: modeChoice.get(), language: langSelect.value, lowResources: lowInput.checked,
    });
    browser.storage.local.set({ settings: next }).then(() => {
      applySettings(next);
      setView("main");
    }).catch(() => say("settings.saveFailed", "error", settingsNotice));
  });
  browser.storage.local.get("settings").then((stored) => applySettings(lib.normalizeSettings(stored.settings))).catch(() => applySettings(settings));
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) applySettings(lib.normalizeSettings(changes.settings.newValue));
  });
  for (const button of shadow.querySelectorAll("header .closer")) button.addEventListener("click", closeBox);
  nameInput.addEventListener("input", () => { nameEdited = true; });
  clip.addEventListener("change", () => { startInput.disabled = endInput.disabled = !clip.checked; });
  form.addEventListener("input", resetResult);
  form.addEventListener("change", resetResult);
  side.addEventListener("click", () => {
    if (sideMode === "cancel") request({ type: "cancel" }, () => {});
    else request({ type: "openFolder" }, (reply) => {
      if (reply.type === "error") say(lib.errorKey(reply.code), "error");
    });
  });
  download.addEventListener("click", start);

  setView("main"); // marks the settings card inert from the start

  // Page button (site adapter in sites.js): a host element (closed shadow root) carrying the button; created once per adapter and reused.
  let adapter = sites.adapterFor(location.hostname, location.pathname);
  let pageButton = null; // the host element
  let pageControl = null; // the <button> inside its shadow root
  function createPageButton() {
    if (!pageButton) {
      pageButton = document.createElement("div");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      path.setAttribute("d", adapter.iconPath);
      svg.append(path);
      pageControl = el("button", { type: "button" }, [svg]);
      pageControl.addEventListener("click", toggle);
      pageButton.attachShadow({ mode: "closed" }).append(el("style", { textContent: adapter.css }), pageControl);
      for (const type of ["keydown", "keyup", "keypress"]) pageButton.addEventListener(type, (event) => event.stopPropagation());
      const control = pageControl; // the module-level one is nulled when the adapter changes
      bind(() => { control.title = t("button.download"); control.setAttribute("aria-label", t("button.download")); });
    }
    return pageButton;
  }
  let watcher = null;
  let watched = null;
  let timer = 0;
  // Mounts or removes the page button; a missing anchor does nothing (the toolbar icon still works).
  function syncButton() {
    const next = sites.adapterFor(location.hostname, location.pathname); // YouTube <-> Shorts changes adapter without a reload
    if (next !== adapter) {
      sites.unmountButton(document);
      adapter = next;
      pageButton = pageControl = watched = null;
    }
    const want = adapter && settings.buttonMode === "page" && lib.isVideoPage(location.href);
    if (!want || !sites.mountButton(adapter, document, createPageButton)) {
      sites.unmountButton(document);
      if (!want && watcher) { watcher.disconnect(); watched = null; }
    }
    if (want) {
      if (pageButton) pageButton.toggleAttribute("data-dark", adapter.isDark(document));
      const target = adapter.observeTarget(document);
      if (target && target !== watched) {
        watcher = watcher || new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(sync, 300); });
        watcher.disconnect();
        watcher.observe(target, { childList: true, subtree: true });
        watched = target;
      }
    }
  }
  // The open box stays glued to the page button (scroll and resize) and closes when the button leaves the viewport.
  // Opened without a usable button (toolbar icon, button off-screen or missing) it stays in the fixed corner and is never glued.
  function placePanel() {
    if (panel.hidden || !pageButton || !pageButton.isConnected) return;
    const place = sites.placement(pageControl.getBoundingClientRect(), innerWidth, innerHeight, panel.offsetHeight, adapter.panel);
    const glued = panel.style.left !== "";
    if (!place || place.close) return glued ? closeBox() : undefined;
    panel.style.right = panel.style.bottom = "auto";
    panel.style.left = place.left + "px";
    panel.style.top = place.top + "px";
  }

  // SPA navigation: these sites change the URL without reloading.
  function sync() {
    const visible = lib.isVideoPage(location.href);
    syncButton();
    if (visible && !host.isConnected) document.documentElement.append(host);
    if (!visible && host.isConnected) host.remove();
    if (pageUrl() !== currentUrl) {
      currentUrl = pageUrl();
      if (!running) {
        probedUrl = null;
        nameInput.value = "";
        nameEdited = false;
        resetVideo();
        download.classList.remove("complete");
        download.disabled = false;
        setLabel({ kind: "idle" });
        setStatus("status.ready", "ready");
        setSide("idle");
        say("");
        if (!panel.hidden && visible) probe();
      }
    }
  }
  window.addEventListener("popstate", sync);
  document.addEventListener("yt-navigate-finish", sync);
  applyPolling(); // fallback for pushState (see applyPolling); resource saving turns it off
  sync();
})();
