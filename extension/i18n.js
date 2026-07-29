'use strict';
/**
 * Tiny helper for chrome.i18n in DOM pages.
 *
 * Wrapped in an IIFE so that helpers (t, applyI18n) do NOT leak to the global
 * scope. Only `window.i18n` is exposed — this avoids conflicts with any
 * `const t = ...` / `let t = ...` declarations in the page's own script
 * (which was causing "Uncaught SyntaxError: Identifier 't' has already been
 * declared" when both files share the classic-script global scope).
 *
 * Usage in HTML:
 *   <button data-i18n="popupSend">Send</button>          -> textContent
 *   <input data-i18n-placeholder="popupTextPlaceholder"> -> placeholder attr
 *   <button data-i18n-title="popupSettings">⚙</button>   -> title attr
 *   <button data-i18n-aria="popupSend">→</button>        -> aria-label attr
 *
 * Access from other page scripts:
 *   window.i18n.t('someKey', ['arg1'])
 *   window.i18n.apply(fragment)
 */

(function () {
  function t(key, subs) {
    if (!key) return '';
    const v = chrome.i18n.getMessage(key, subs);
    return v || key;
  }

  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    root.querySelectorAll('[data-i18n-aria]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    root.querySelectorAll('[data-i18n-value]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-value');
      if (key) el.setAttribute('value', t(key));
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        applyI18n();
      });
    } else {
      applyI18n();
    }
  }

  if (typeof window !== 'undefined') {
    window.i18n = { t: t, apply: applyI18n };
  }
})();
