/**
 * NearbyShare background service worker (MV3)
 *
 * Responsibilities:
 * 1. Register context menus (Send selection / link / image / page to LAN)
 * 2. Expose sendText / sendFile / sendImageUrl APIs for the popup
 * 3. Periodically ping the local server and reflect status in storage + badge
 */

const DEFAULT_SERVER = 'http://localhost:3000';

function t(key, subs) {
  const v = chrome.i18n.getMessage(key, subs);
  return v || key;
}

async function getConfig() {
  const { serverUrl, displayName, deviceId } = await chrome.storage.local.get([
    'serverUrl',
    'displayName',
    'deviceId',
  ]);
  let id = deviceId;
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    await chrome.storage.local.set({ deviceId: id });
  }
  return {
    serverUrl: (serverUrl || DEFAULT_SERVER).replace(/\/$/, ''),
    displayName: displayName || t('popupDefaultName'),
    deviceId: id,
  };
}

/* ------------------------- Context menus ------------------------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'nearby-share-selection',
      title: t('ctxSendSelection'),
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'nearby-share-link',
      title: t('ctxSendLink'),
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'nearby-share-image',
      title: t('ctxSendImage'),
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'nearby-share-page',
      title: t('ctxSendPage'),
      contexts: ['page'],
    });
  });
  chrome.alarms.create('nearby-share-ping', { periodInMinutes: 0.25 });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'nearby-share-selection' && info.selectionText) {
      await sendText(info.selectionText);
      notify(t('notifSentSelection'));
    } else if (info.menuItemId === 'nearby-share-link' && info.linkUrl) {
      await sendText(info.linkUrl);
      notify(t('notifSentLink'));
    } else if (info.menuItemId === 'nearby-share-page') {
      const url = (tab && tab.url) || info.pageUrl;
      const title = tab && tab.title;
      await sendText(title ? `${title}\n${url}` : url);
      notify(t('notifSentPage'));
    } else if (info.menuItemId === 'nearby-share-image' && info.srcUrl) {
      await sendImageUrl(info.srcUrl);
      notify(t('notifSentImage'));
    }
  } catch (err) {
    notify(t('notifSendFailed', [err.message]), true);
  }
});

/* ------------------------- Status probing ------------------------- */
if (!chrome.alarms.onAlarm.hasListener(handleAlarm)) {
  chrome.alarms.onAlarm.addListener(handleAlarm);
}
function handleAlarm(a) {
  if (a.name === 'nearby-share-ping') pingServer();
}
pingServer();

async function pingServer() {
  const cfg = await getConfig();
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch(cfg.serverUrl + '/api/ping', { signal: ctrl.signal });
    clearTimeout(to);
    if (res.ok) {
      const info = await res.json();
      await setStatus({ online: true, info });
      fetch(cfg.serverUrl + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cfg.deviceId, name: cfg.displayName }),
      }).catch(() => {});
      return true;
    }
  } catch (_) {}
  await setStatus({ online: false });
  return false;
}

async function setStatus(status) {
  await chrome.storage.local.set({ serverStatus: status, statusAt: Date.now() });
  chrome.action.setBadgeText({ text: status.online ? '' : 'off' });
  chrome.action.setBadgeBackgroundColor({ color: status.online ? '#10b981' : '#9ca3af' });
}

/* ------------------------- Core send API ------------------------- */
async function sendText(text) {
  const cfg = await getConfig();
  const res = await fetch(cfg.serverUrl + '/api/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      sender: cfg.displayName,
      senderId: cfg.deviceId,
    }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function sendFile(file, filename) {
  const cfg = await getConfig();
  const params = new URLSearchParams({
    name: filename || file.name || 'file',
    sender: cfg.displayName,
    senderId: cfg.deviceId,
  });
  const res = await fetch(cfg.serverUrl + '/api/upload?' + params.toString(), {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function sendImageUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('fetch image ' + res.status);
  const blob = await res.blob();
  let name = url.split('/').pop().split('?')[0] || 'image';
  if (!/\.[a-z0-9]+$/i.test(name)) {
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    name = name + '.' + ext;
  }
  const file = new File([blob], name, { type: blob.type });
  return sendFile(file, name);
}

/* ------------------------- Message channel ------------------------- */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'ping') sendResponse({ ok: await pingServer() });
      else if (msg.type === 'send-text') sendResponse({ ok: true, data: await sendText(msg.text) });
      else if (msg.type === 'send-file') {
        const bin = base64ToBytes(msg.b64);
        const file = new Blob([bin], { type: msg.mime || 'application/octet-stream' });
        sendResponse({ ok: true, data: await sendFile(file, msg.name) });
      } else if (msg.type === 'open-panel') {
        const cfg = await getConfig();
        chrome.tabs.create({ url: cfg.serverUrl + '/' });
        sendResponse({ ok: true });
      } else if (msg.type === 'get-config') {
        sendResponse({ ok: true, data: await getConfig() });
      } else {
        sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

function base64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function notify(message, isError = false) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: t('notifTitle') + (isError ? t('notifErrorSuffix') : ''),
      message,
      priority: 0,
    });
  } catch (_) {}
}
