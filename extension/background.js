/**
 * NearbyShare 浏览器扩展 background service worker (MV3)
 * 职责：
 * 1. 注册右键菜单（发送选中文字/图片/链接/当前页到局域网）
 * 2. 提供 sendText / sendUrl / sendImageUrl 等 API 供 popup 调用
 * 3. 定期 ping 本地服务器，把状态放到 storage 供 popup 读取
 * 4. 监听服务端 SSE，收到新消息时更新扩展图标 badge
 */

const DEFAULT_SERVER = 'http://localhost:3000';

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
    displayName: displayName || '浏览器扩展',
    deviceId: id,
  };
}

/* ------------------------- 右键菜单 ------------------------- */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'nearby-share-selection',
      title: '发送选中文字到局域网',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'nearby-share-link',
      title: '发送链接到局域网',
      contexts: ['link'],
    });
    chrome.contextMenus.create({
      id: 'nearby-share-image',
      title: '发送图片到局域网',
      contexts: ['image'],
    });
    chrome.contextMenus.create({
      id: 'nearby-share-page',
      title: '发送当前页面链接到局域网',
      contexts: ['page'],
    });
  });
  // 启动定时器
  chrome.alarms.create('nearby-share-ping', { periodInMinutes: 0.25 });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'nearby-share-selection' && info.selectionText) {
      await sendText(info.selectionText);
      notify('已发送选中文字');
    } else if (info.menuItemId === 'nearby-share-link' && info.linkUrl) {
      await sendText(info.linkUrl);
      notify('已发送链接');
    } else if (info.menuItemId === 'nearby-share-page') {
      const url = (tab && tab.url) || info.pageUrl;
      const title = tab && tab.title;
      await sendText(title ? `${title}\n${url}` : url);
      notify('已发送当前页面');
    } else if (info.menuItemId === 'nearby-share-image' && info.srcUrl) {
      await sendImageUrl(info.srcUrl);
      notify('已发送图片');
    }
  } catch (err) {
    notify('发送失败：' + err.message, true);
  }
});

/* ------------------------- 状态检测 ------------------------- */

// alarms 触发时 ping 服务器
if (!chrome.alarms.onAlarm.hasListener(handleAlarm)) {
  chrome.alarms.onAlarm.addListener(handleAlarm);
}
function handleAlarm(a) {
  if (a.name === 'nearby-share-ping') pingServer();
}
// 兜底：service worker 冷启动后也 ping 一次
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
      // 注册设备
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

/* ------------------------- 核心发送 API ------------------------- */

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
  // 通过 fetch 下载图片再上传到局域网
  const res = await fetch(url);
  if (!res.ok) throw new Error('抓取图片失败 ' + res.status);
  const blob = await res.blob();
  let name = url.split('/').pop().split('?')[0] || 'image';
  if (!/\.[a-z0-9]+$/i.test(name)) {
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    name = name + '.' + ext;
  }
  const file = new File([blob], name, { type: blob.type });
  return sendFile(file, name);
}

/* ------------------------- 消息通道 ------------------------- */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'ping') sendResponse({ ok: await pingServer() });
      else if (msg.type === 'send-text') sendResponse({ ok: true, data: await sendText(msg.text) });
      else if (msg.type === 'send-file') {
        // popup 传来 base64，因为 File/Blob 不能直接跨消息传
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
  return true; // async
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
      title: 'NearbyShare' + (isError ? ' · 错误' : ''),
      message,
      priority: 0,
    });
  } catch (_) {}
}
