'use strict';

const t = (k, s) => (window.i18n ? window.i18n.t(k, s) : chrome.i18n.getMessage(k, s));

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
  nameInput.value = displayName || t('popupDefaultName');
}

saveBtn.addEventListener('click', async () => {
  const serverUrl = urlInput.value.trim().replace(/\/$/, '');
  const displayName = nameInput.value.trim() || t('popupDefaultName');
  try { new URL(serverUrl); } catch (_) { return setMsg(t('optionsInvalidUrl'), true); }
  await chrome.storage.local.set({ serverUrl, displayName });
  setMsg(t('optionsSaved'));
});

testBtn.addEventListener('click', async () => {
  const serverUrl = urlInput.value.trim().replace(/\/$/, '');
  try {
    const res = await fetch(serverUrl + '/api/ping');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    setMsg(t('optionsConnectOk'));
  } catch (err) {
    setMsg(t('optionsConnectFailed', [err.message]), true);
  }
});

load();
