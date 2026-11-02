"use strict";

// Chromium service worker: load the `browser` shim (Firefox defines `browser` natively).
if (typeof browser === "undefined") importScripts("shim.js");

const HOST_NAME = "media_downloader";
const FORWARDED_TYPES = new Set(["probe", "download", "cancel", "doctor", "openFolder", "pickFolder"]);
const TERMINAL_TYPES = new Set(["completed", "error", "probe", "doctor", "opened", "folderPicked"]);

let port = null;
let counter = 0;
// host id -> { tabId, clientId }, so concurrent tabs never mix up replies.
const routes = new Map();

function sendToTab(tabId, message) {
  browser.tabs.sendMessage(tabId, { kind: "host", message }).catch(() => {});
}

function onHostMessage(message) {
  const route = routes.get(message && message.id);
  if (!route) return;
  if (TERMINAL_TYPES.has(message.type)) routes.delete(message.id);
  sendToTab(route.tabId, { ...message, id: route.clientId });
}

// Errors carry only a code: the page renders the text from its message catalogue (extension/i18n.js).
function onDisconnect() {
  port = null;
  for (const route of routes.values()) sendToTab(route.tabId, { type: "error", id: route.clientId, code: "host_disconnected" });
  routes.clear();
}

function getPort() {
  if (!port) {
    port = browser.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener(onHostMessage);
    port.onDisconnect.addListener(onDisconnect);
  }
  return port;
}

browser.runtime.onMessage.addListener((request, sender) => {
  const payload = request && request.payload;
  if (!sender.tab || !payload || !FORWARDED_TYPES.has(payload.type)) return;
  const hostId = String(++counter);
  // cancel has no reply of its own: the job's terminal error carries the job's id.
  if (payload.type !== "cancel") routes.set(hostId, { tabId: sender.tab.id, clientId: String(request.id) });
  try {
    getPort().postMessage({ ...payload, id: hostId });
  } catch (e) {
    routes.delete(hostId);
    port = null;
    sendToTab(sender.tab.id, { type: "error", id: String(request.id), code: "host_disconnected" });
  }
});

// Toolbar icon: toggles the box of the current tab (ignored where no content script runs).
(browser.action || browser.browserAction).onClicked.addListener((tab) => {
  browser.tabs.sendMessage(tab.id, { kind: "toggle" }).catch(() => {});
});
