'use strict';

const $ = (id) => document.getElementById(id);
const t = (k, s) => (window.i18n ? window.i18n.t(k, s) : chrome.i18n.getMessage(k, s));

const els = {
  dot: $('statusDot'),
  offline: $('offlineBanner'),
  online: $('onlineBanner'),
  onlineUrl: $('onlineUrl'),
  downloadBtn: $('downloadBtn'),
  cmdBtn: $('cmdBtn'),
  retryBtn: $('retryBtn'),
  openPanel: $('openPanelBtn'),
  options: $('optionsBtn'),
  text: $('text'),
  file: $('file'),
  fileBtn: $('fileBtn'),
  sendBtn: $('sendBtn'),
  uploadStatus: $('uploadStatus'),
  sendPage: $('sendPageBtn'),
  sendSel: $('sendSelBtn'),
  recent: $('recentList'),
  openFull: $('openFullBtn'),
};

let cfg = null;
let online = false;

async function sendMsg(type, extra = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...extra }, (resp) => resolve(resp || { ok: false }));
  });
}

async function init() {
  const r = await sendMsg('get-config');
  cfg = r.data || { serverUrl: 'http://localhost:3000', displayName: t('popupDefaultName') };
  els.onlineUrl.textContent = cfg.serverUrl;
  await checkStatus();
  wireUI();
}

async function checkStatus() {
  // 让 background 也同步更新一次徽标
  sendMsg('ping');

  let info = null;
  try {
    const res = await fetch(cfg.serverUrl + '/api/ping', {
      cache: 'no-store',
      signal: AbortSignal.timeout ? AbortSignal.timeout(2000) : undefined,
    });
    if (res.ok) info = await res.json();
  } catch (_) {}

  online = !!info;
  els.dot.classList.toggle('online', online);
  els.dot.classList.toggle('offline', !online);
  els.offline.hidden = online;
  els.online.hidden = !online;
  els.sendBtn.disabled = !online;
  els.fileBtn.disabled = !online;
  els.sendPage.disabled = !online;
  els.sendSel.disabled = !online;
  if (online) {
    renderLanUrls(info && info.lanUrls);
    refreshRecent();
  }
}

function renderLanUrls(urls) {
  const box = document.getElementById('lanUrls');
  if (!box) return;
  box.innerHTML = '';
  if (!urls || !urls.length) {
    const empty = document.createElement('div');
    empty.className = 'lan-empty';
    empty.textContent = t('popupNoLanUrls');
    box.append(empty);
    return;
  }
  for (const { url, iface } of urls) {
    const row = document.createElement('div');
    row.className = 'lan-url';
    row.title = iface || '';

    const link = document.createElement('span');
    link.className = 'lan-url-addr';
    link.textContent = url;
    row.append(link);

    const label = ifaceLabel(iface);
    if (label) {
      const badge = document.createElement('span');
      badge.className = 'lan-iface';
      badge.textContent = label;
      row.append(badge);
    }

    const hint = document.createElement('span');
    hint.className = 'copy-hint';
    hint.textContent = t('popupClickToCopy');
    row.append(hint);

    row.addEventListener('click', () => {
      navigator.clipboard.writeText(url).then(() => {
        row.classList.add('copied');
        hint.textContent = t('popupCopiedToClipboard');
        setTimeout(() => {
          row.classList.remove('copied');
          hint.textContent = t('popupClickToCopy');
        }, 1500);
      });
    });
    box.append(row);
  }
}

/**
 * 把系统接口名规范化为一小段人类可读的标签。
 * 用来提示用户哪个是无线、哪个是有线。
 */
function ifaceLabel(name) {
  if (!name) return '';
  const s = String(name).toLowerCase();
  if (/wlan|wi-?fi|wireless|无线/.test(s) || /wlan|wi-?fi|wireless|无线/i.test(name)) return 'Wi-Fi';
  if (/ethernet|以太网|eth\d/.test(s) || /ethernet|以太网|eth\d/i.test(name)) return t('popupIfaceEthernet');
  if (/en\d/.test(s)) return t('popupIfaceEthernet');
  return '';
}

async function refreshRecent() {
  try {
    const res = await fetch(cfg.serverUrl + '/api/state');
    const state = await res.json();
    renderRecent(state);
  } catch (_) {}
}

function renderRecent(state) {
  const all = [...(state.messages || []), ...(state.files || [])]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 6);
  if (!all.length) {
    els.recent.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = t('popupEmpty');
    els.recent.append(empty);
    return;
  }
  els.recent.innerHTML = '';
  for (const it of all) {
    const item = document.createElement('div');
    item.className = 'item';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = it.sender;
    const c = document.createElement('span');
    c.className = 'content';
    c.textContent = it.kind === 'file' ? '📎 ' + it.name : it.text;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = fmtTime(it.timestamp);
    item.append(who, c, time);
    if (it.kind === 'file') {
      item.title = it.name + ' · ' + fmtSize(it.size);
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        chrome.tabs.create({ url: `${cfg.serverUrl}/api/files/${it.id}?download=1` });
      });
    }
    els.recent.append(item);
  }
}

function fmtTime(ts) {
  const d = Date.now() - ts;
  if (d < 60_000) return t('timeJustNow') || 'now';
  if (d < 3_600_000) return Math.floor(d / 60_000) + 'm';
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + 'h';
  return Math.floor(d / 86_400_000) + 'd';
}
function fmtSize(n) {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + 'KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + 'MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + 'GB';
}

function setStatus(text, kind) {
  els.uploadStatus.textContent = text;
  els.uploadStatus.className = 'status ' + (kind || '');
  if (text) setTimeout(() => { if (els.uploadStatus.textContent === text) setStatus(''); }, 3000);
}

async function doSend() {
  const text = els.text.value.trim();
  const files = Array.from(els.file.files || []);
  if (!text && !files.length) return;
  els.sendBtn.disabled = true;
  try {
    if (text) {
      const r = await sendMsg('send-text', { text });
      if (!r.ok) throw new Error(r.error);
      els.text.value = '';
    }
    for (const f of files) {
      setStatus(t('popupUploadingFile', [f.name]));
      const b64 = await fileToBase64(f);
      const r = await sendMsg('send-file', { name: f.name, mime: f.type, b64 });
      if (!r.ok) throw new Error(r.error);
    }
    els.file.value = '';
    setStatus(t('popupSent'), 'ok');
    refreshRecent();
  } catch (err) {
    setStatus(t('popupSendFailed', [err.message]), 'error');
  } finally {
    els.sendBtn.disabled = !online;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function wireUI() {
  els.sendBtn.addEventListener('click', doSend);
  els.fileBtn.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    if (els.file.files.length) {
      setStatus(t('popupSelectedFiles', [String(els.file.files.length)]));
    }
  });
  els.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); doSend();
    }
  });

  els.retryBtn.addEventListener('click', checkStatus);
  els.downloadBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/HveinBlg/NearbyShare/releases' });
  });
  els.cmdBtn.addEventListener('click', () => {
    const cmd = 'npx nearby-share@latest';
    navigator.clipboard.writeText(cmd).then(
      () => setStatus(t('popupCopiedCommand', [cmd]), 'ok'),
      () => setStatus(t('popupCopyFailed'), 'error'),
    );
  });

  els.openPanel.addEventListener('click', () => sendMsg('open-panel'));
  els.openFull.addEventListener('click', (e) => {
    e.preventDefault();
    sendMsg('open-panel');
  });
  els.options.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.sendPage.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;
    const text = tab.title ? `${tab.title}\n${tab.url}` : tab.url;
    const r = await sendMsg('send-text', { text });
    setStatus(r.ok ? t('popupSentPage') : t('popupSendFailed', [r.error]), r.ok ? 'ok' : 'error');
    if (r.ok) refreshRecent();
  });

  els.sendSel.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => String(window.getSelection() || ''),
      });
      const text = res && res.result;
      if (!text) return setStatus(t('popupNoSelection'), 'error');
      const r = await sendMsg('send-text', { text });
      setStatus(r.ok ? t('popupSentSelection') : t('popupSendFailed', [r.error]), r.ok ? 'ok' : 'error');
      if (r.ok) refreshRecent();
    } catch (err) {
      setStatus(t('popupCantReadSelection', [err.message]), 'error');
    }
  });
}

init();
