'use strict';

const urlInput = document.getElementById('serverUrl');
const nameInput = document.getElementById('displayName');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const msg = document.getElementById('msg');

function setMsg(text, isError) {
  msg.textContent = text;
  msg.style.color = isError ? 'var(--danger)' : 'var(--success)';
  if (text) setTimeout(() => { if (msg.textContent === text) msg.textContent = ''; }, 2500);
}

async function load() {
  const { serverUrl, displayName } = await chrome.storage.local.get(['serverUrl', 'displayName']);
  urlInput.value = serverUrl || 'http://localhost:3000';
  nameInput.value = displayName || '浏览器扩展';
}

saveBtn.addEventListener('click', async () => {
  const serverUrl = urlInput.value.trim().replace(/\/$/, '');
  const displayName = nameInput.value.trim() || '浏览器扩展';
  try { new URL(serverUrl); } catch (_) { return setMsg('URL 格式无效', true); }
  await chrome.storage.local.set({ serverUrl, displayName });
  setMsg('已保存');
});

testBtn.addEventListener('click', async () => {
  const serverUrl = urlInput.value.trim().replace(/\/$/, '');
  try {
    const res = await fetch(serverUrl + '/api/ping');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    setMsg('连接成功 ✓');
  } catch (err) {
    setMsg('连接失败：' + err.message, true);
  }
});

load();
