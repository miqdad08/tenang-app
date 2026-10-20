/* Tenang — shared helpers (formatting, validation, dates).
   Classic script (no modules) so the app also runs from file:// */
(function (T) {
  'use strict';

  const yuanFmt0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const yuanFmt2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rpFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

  /** ¥1,840 or ¥12.50 */
  function fmtCNY(n) {
    if (!Number.isFinite(n)) return '¥–';
    const sign = n < 0 ? '−' : '';
    const a = Math.abs(n);
    const s = Number.isInteger(Math.round(a * 100) / 100) ? yuanFmt0.format(a) : yuanFmt2.format(a);
    return sign + '¥' + s;
  }

  /** Rp 193.500 (Indonesian separators) */
  function fmtIDR(n) {
    if (!Number.isFinite(n)) return 'Rp –';
    const sign = n < 0 ? '−' : '';
    return sign + 'Rp ' + rpFmt.format(Math.round(Math.abs(n)));
  }

  function round2(n) { return Math.round(n * 100) / 100; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  /** Remove control characters and trim; cap length. Output is plain text only. */
  function cleanText(s, max) {
    if (typeof s !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u001F\u007F​-‏‪-‮]/g, ' ')
      .replace(/\s+/g, ' ').trim().slice(0, max || 80);
  }

  /** Validate a money amount in CNY. */
  const LIMITS = { MIN_AMOUNT: 0.01, MAX_AMOUNT_CNY: 100000, MAX_NOTE: 80 };
  function isValidAmount(n) {
    return typeof n === 'number' && Number.isFinite(n) && n >= LIMITS.MIN_AMOUNT && n <= LIMITS.MAX_AMOUNT_CNY;
  }

  // ---- dates (local time, YYYY-MM-DD) ----
  function pad(n) { return String(n).padStart(2, '0'); }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function monthKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
  function isValidIsoDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.random() * 256; });
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }

  /** Create an element with text only (never innerHTML for user data). */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    (children || []).forEach(c => { if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return node;
  }

  T.utils = { fmtCNY, fmtIDR, round2, clamp, cleanText, isValidAmount, LIMITS, isoDate, monthKey, daysInMonth, isValidIsoDate, WEEKDAYS, MONTHS, uid, el };
})(window.Tenang = window.Tenang || {});
