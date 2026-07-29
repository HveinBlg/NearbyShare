'use strict';

const $ = (id) => document.getElementById(id);

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
  cfg = r.data || { serverUrl: 'http://localhost:3000', displayName: '扩展' };
  els.onlineUrl.textContent = cfg.serverUrl;
  await checkStatus();
  wireUI();
}

async function checkStatus() {
  const r = await sendMsg('ping');
  online = !!r.ok;
  els.dot.classList.toggle('online', online);
  els.dot.classList.toggle('offline', !online);
  els.offline.hidden = online;
  els.online.hidden = !online;
  els.sendBtn.disabled = !online;
  els.fileBtn.disabled = !online;
  els.sendPage.disabled = !online;
  els.sendSel.disabled = !online;
  if (online) refreshRecent();
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
    els.recent.innerHTML = '<div class="empty">暂无</div>';
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
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = fmtTime(it.timestamp);
    item.append(who, c, t);
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
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return Math.floor(d / 60_000) + '分';
  if (d < 86_400_000) return Math.floor(d / 3_600_000) + '时';
  return Math.floor(d / 86_400_000) + '天';
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
      setStatus(`上传 ${f.name}…`);
      const b64 = await fileToBase64(f);
      const r = await sendMsg('send-file', { name: f.name, mime: f.type, b64 });
      if (!r.ok) throw new Error(r.error);
    }
    els.file.value = '';
    setStatus('已发送 ✓', 'ok');
    refreshRecent();
  } catch (err) {
    setStatus('发送失败：' + err.message, 'error');
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
      setStatus(`已选择 ${els.file.files.length} 个文件`);
    }
  });
  els.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault(); doSend();
    }
  });

  els.retryBtn.addEventListener('click', checkStatus);
  els.downloadBtn.addEventListener('click', () => {
    // 用户在源码中可替换为自己的 Releases 页面地址
    chrome.tabs.create({ url: 'https://github.com/your-user/nearby-share/releases' });
  });
  els.cmdBtn.addEventListener('click', () => {
    const cmd = 'npx nearby-share@latest';
    navigator.clipboard.writeText(cmd).then(
      () => setStatus('已复制：' + cmd, 'ok'),
      () => setStatus('复制失败', 'error'),
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
    setStatus(r.ok ? '已发送当前页 ✓' : '失败：' + r.error, r.ok ? 'ok' : 'error');
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
      if (!text) return setStatus('未选中任何文字', 'error');
      const r = await sendMsg('send-text', { text });
      setStatus(r.ok ? '已发送选中文字 ✓' : '失败：' + r.error, r.ok ? 'ok' : 'error');
      if (r.ok) refreshRecent();
    } catch (err) {
      setStatus('无法读取选中文字：' + err.message, 'error');
    }
  });
}

init();
