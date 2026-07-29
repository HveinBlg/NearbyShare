'use strict';
/**
 * Tiny helper for chrome.i18n in DOM pages.
 * Usage in HTML:
 *   <button data-i18n="popupSend">Send</button>          -> textContent
 *   <input data-i18n-placeholder="popupTextPlaceholder"> -> placeholder attr
 *   <button data-i18n-title="popupSettings">⚙</button>   -> title attr
 *   <button data-i18n-aria="popupSend">→</button>        -> aria-label attr
 *
 * Call `applyI18n(root)` after DOMContentLoaded (or import as inline module).
 */

function t(key, subs) {
  if (!key) return '';
  const v = chrome.i18n.getMessage(key, subs);
  return v || key;
}

function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.setAttribute('placeholder', t(key));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) el.setAttribute('title', t(key));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria');
    if (key) el.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll('[data-i18n-value]').forEach((el) => {
    const key = el.getAttribute('data-i18n-value');
    if (key) el.setAttribute('value', t(key));
  });
}

// Auto-apply on DOM ready when loaded via <script>
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyI18n());
  } else {
    applyI18n();
  }
}

// Expose helpers globally for other scripts in the same page
if (typeof window !== 'undefined') {
  window.i18n = { t, apply: applyI18n };
}
