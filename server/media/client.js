'use strict';
/**
 * NearbyShare 浏览器端逻辑（其它设备访问 http://电脑IP:端口/ 时加载）。
 * 依赖：SSE (EventSource)、fetch、FileReader、Drag & Drop。
 */

const feedEl = document.getElementById('feed');
const hintEl = document.getElementById('hint');
const nameEl = document.getElementById('myName');
const deviceCountEl = document.getElementById('deviceCount');
const devicesPanel = document.getElementById('devicesPanel');
const devicesBtn = document.getElementById('devicesBtn');
const clearBtn = document.getElementById('clearBtn');
const fileBtn = document.getElementById('fileBtn');
const fileInput = document.getElementById('fileInput');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');
const dropZone = document.getElementById('dropZone');
const uploadsEl = document.getElementById('uploads');

// -------- 身份 --------
function loadIdentity() {
  let id = localStorage.getItem('nearbyshare.id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 12);
    localStorage.setItem('nearbyshare.id', id);
  }
  let name = localStorage.getItem('nearbyshare.name') || guessName();
  return { id, name };
}
function guessName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  return '设备';
}
const me = loadIdentity();
nameEl.value = me.name;

nameEl.addEventListener('change', () => {
  const v = nameEl.value.trim().slice(0, 20) || guessName();
  me.name = v;
  localStorage.setItem('nearbyshare.name', v);
  register();
});

async function register() {
  try {
    await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: me.id, name: me.name }),
    });
  } catch (_) {}
}

// -------- 渲染 --------
const rendered = new Set();

function renderMessage(m, opts = {}) {
  if (rendered.has(m.id)) return;
  rendered.add(m.id);
  hintEl && hintEl.remove();

  const el = document.createElement('div');
  const isSelf = m.senderId === me.id;
  el.className = `msg ${isSelf ? 'self' : ''} ${m.kind}`;
  el.dataset.id = m.id;

  const sender = document.createElement('div');
  sender.className = 'sender';
  const nameSpan = document.createElement('span');
  nameSpan.textContent = m.sender || 'Anonymous';
  const timeSpan = document.createElement('span');
  timeSpan.className = 'time';
  timeSpan.textContent = fmtTime(m.timestamp);
  sender.append(nameSpan, timeSpan);
  el.append(sender);

  if (m.kind === 'text') {
    const t = document.createElement('div');
    t.className = 'text';
    // 将 URL 转成可点链接（简单处理）
    t.append(...linkify(m.text));
    el.append(t);
  } else if (m.kind === 'file') {
    el.append(renderFile(m, isSelf));
  }

  feedEl.append(el);
  if (!opts.silent) {
    const stickToBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 200;
    if (stickToBottom || isSelf) scrollBottom();
  }
}

function renderFile(f, isSelf) {
  const wrap = document.createDocumentFragment();
  const isImage = /^image\//.test(f.mime);
  const isVideo = /^video\//.test(f.mime);

  if (isImage) {
    const img = document.createElement('img');
    img.className = 'preview';
    img.loading = 'lazy';
    img.src = `/api/files/${f.id}`;
    img.alt = f.name;
    img.addEventListener('click', () => openViewer(img.src));
    wrap.append(img);
  } else if (isVideo) {
    const v = document.createElement('video');
    v.className = 'preview';
    v.controls = true;
    v.preload = 'metadata';
    v.src = `/api/files/${f.id}`;
    wrap.append(v);
  }

  const row = document.createElement('div');
  row.className = 'filerow';

  if (!isImage && !isVideo) {
    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.textContent = fileIcon(f.mime, f.name);
    row.append(icon);
  }

  const meta = document.createElement('div');
  meta.className = 'fmeta';
  const fname = document.createElement('div');
  fname.className = 'fname';
  fname.textContent = f.name;
  const fsize = document.createElement('div');
  fsize.className = 'fsize';
  fsize.textContent = fmtSize(f.size);
  meta.append(fname, fsize);
  row.append(meta);

  wrap.append(row);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const dl = document.createElement('a');
  dl.href = `/api/files/${f.id}?download=1`;
  dl.download = f.name;
  dl.textContent = '下载';
  actions.append(dl);

  if (isSelf) {
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      if (!confirm(`删除「${f.name}」？`)) return;
      await fetch(`/api/files/${f.id}`, { method: 'DELETE' });
    });
    actions.append(del);
  }
  wrap.append(actions);
  return wrap;
}

function removeItem(id) {
  const el = feedEl.querySelector(`[data-id="${id}"]`);
  if (el) el.remove();
  rendered.delete(id);
}

function linkify(text) {
  const parts = [];
  const re = /(https?:\/\/[^\s]+)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.href = m[0]; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = m[0];
    parts.push(a);
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(document.createTextNode(text.slice(last)));
  return parts;
}

function fileIcon(mime, name) {
  if (/pdf/.test(mime)) return '📄';
  if (/zip|compressed|tar|7z|rar/.test(mime) || /\.(zip|rar|7z|tar|gz)$/i.test(name)) return '🗜';
  if (/audio/.test(mime)) return '🎵';
  if (/video/.test(mime)) return '🎞';
  if (/text|json|xml|javascript/.test(mime)) return '📝';
  if (/word|excel|powerpoint|officedocument/.test(mime)) return '📎';
  return '📦';
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function fmtTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
function scrollBottom() {
  feedEl.scrollTop = feedEl.scrollHeight;
}

// -------- 设备面板 --------
function renderDevices(list) {
  deviceCountEl.textContent = String(list.length);
  devicesPanel.innerHTML = '';
  for (const d of list) {
    const chip = document.createElement('div');
    chip.className = 'dev-chip';
    const isMe = d.id === me.id;
    chip.textContent = isMe ? `${d.name}（你）` : d.name;
    if (d.ip && !isMe) chip.title = d.ip;
    devicesPanel.append(chip);
  }
}
devicesBtn.addEventListener('click', () => {
  devicesPanel.hidden = !devicesPanel.hidden;
});

// -------- SSE --------
let es;
function connectSSE() {
  if (es) es.close();
  es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => {
    const snap = JSON.parse(e.data);
    feedEl.innerHTML = '';
    rendered.clear();
    hintEl && feedEl.append(hintEl);
    const merged = [...snap.messages, ...snap.files].sort((a, b) => a.timestamp - b.timestamp);
    for (const item of merged) renderMessage(item, { silent: true });
    scrollBottom();
    renderDevices(snap.devices);
  });
  es.onmessage = (e) => {
    let evt;
    try { evt = JSON.parse(e.data); } catch (_) { return; }
    if (evt.type === 'message' || evt.type === 'file-added') {
      renderMessage(evt.payload);
      if (evt.payload.senderId !== me.id) beep();
    } else if (evt.type === 'file-removed') {
      removeItem(evt.payload.id);
    } else if (evt.type === 'devices') {
      renderDevices(evt.payload);
    } else if (evt.type === 'cleared') {
      feedEl.innerHTML = '';
      rendered.clear();
      feedEl.append(hintEl || createHint());
    }
  };
  es.onerror = () => {
    // 浏览器会自动按 retry 间隔重连
  };
}
function createHint() {
  const h = document.createElement('div');
  h.className = 'hint';
  h.textContent = '等待消息与文件…';
  return h;
}

// -------- 提示音 --------
let audioCtx;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 660;
    g.gain.value = 0.05;
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.08);
  } catch (_) {}
}

// -------- 发送文本 --------
async function sendText() {
  const text = msgInput.value.trim();
  if (!text) return;
  msgInput.value = '';
  autosize();
  try {
    await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sender: me.name, senderId: me.id }),
    });
  } catch (err) {
    alert('发送失败：' + err.message);
  }
}
sendBtn.addEventListener('click', sendText);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendText();
  }
});
msgInput.addEventListener('input', autosize);
function autosize() {
  msgInput.style.height = 'auto';
  msgInput.style.height = Math.min(120, msgInput.scrollHeight) + 'px';
}

// -------- 上传 --------
fileBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  uploadFiles(fileInput.files);
  fileInput.value = '';
});

function uploadFiles(files) {
  for (const f of files) uploadOne(f);
}

function uploadOne(file) {
  const item = document.createElement('div');
  item.className = 'upload-item';
  item.innerHTML = `<div class="name"></div><div class="bar"><span></span></div>`;
  item.querySelector('.name').textContent = `${file.name} · ${fmtSize(file.size)}`;
  const bar = item.querySelector('.bar > span');
  uploadsEl.append(item);

  const params = new URLSearchParams({
    name: file.name,
    sender: me.name,
    senderId: me.id,
  });
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload?' + params.toString());
  xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      bar.style.width = (e.loaded / e.total * 100).toFixed(1) + '%';
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200) {
      item.classList.add('done');
      bar.style.width = '100%';
      setTimeout(() => item.remove(), 1200);
    } else {
      item.classList.add('error');
      item.querySelector('.name').textContent += ` · 失败 (${xhr.status})`;
      setTimeout(() => item.remove(), 4000);
    }
  };
  xhr.onerror = () => {
    item.classList.add('error');
    item.querySelector('.name').textContent += ` · 网络错误`;
    setTimeout(() => item.remove(), 4000);
  };
  xhr.send(file);
}

// -------- 拖放 --------
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
  dragDepth++;
  dropZone.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropZone.hidden = true;
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
    e.preventDefault();
  }
});
window.addEventListener('drop', (e) => {
  dragDepth = 0; dropZone.hidden = true;
  if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
  e.preventDefault();
  uploadFiles(e.dataTransfer.files);
});

// -------- 粘贴文件/图片 --------
window.addEventListener('paste', (e) => {
  if (document.activeElement === msgInput) {
    const items = e.clipboardData && e.clipboardData.files;
    if (items && items.length > 0) {
      e.preventDefault();
      uploadFiles(items);
    }
  } else if (e.clipboardData && e.clipboardData.files && e.clipboardData.files.length) {
    e.preventDefault();
    uploadFiles(e.clipboardData.files);
  }
});

// -------- 图片查看器 --------
function openViewer(src) {
  const viewer = document.createElement('div');
  viewer.className = 'viewer';
  const img = document.createElement('img');
  img.src = src;
  img.addEventListener('click', (e) => e.stopPropagation());
  viewer.append(img);
  viewer.addEventListener('click', () => viewer.remove());
  document.body.append(viewer);
}

// -------- 清空 --------
clearBtn.addEventListener('click', async () => {
  if (!confirm('清空所有消息与文件？(所有设备生效)')) return;
  await fetch('/api/clear', { method: 'POST' });
});

// -------- 心跳 --------
setInterval(register, 30_000);

// -------- 启动 --------
register().then(connectSSE);
