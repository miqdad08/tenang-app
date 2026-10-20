/* Tenang — live exchange rate engine (CNY -> IDR).
   Fetches from several free, key-less public APIs, validates each value,
   cross-checks the sources, caches the result and falls back safely. */
(function (T) {
  'use strict';

  const CACHE_KEY = 'tenang.fx.v1';
  const TTL_MS = 6 * 60 * 60 * 1000;          // refresh every 6 hours
  const TIMEOUT_MS = 6000;                     // per source
  const SANE_MIN = 1500, SANE_MAX = 3500;     // plausible IDR per 1 CNY
  const DISAGREE_PCT = 2;                      // warn when sources differ more than 2%
  const FALLBACK_RATE = 2250;                  // example rate from the landing page

  /** Each source returns IDR per 1 CNY or throws. */
  const SOURCES = [
    {
      id: 'open-er-api',
      name: 'ExchangeRate-API (open access)',
      url: 'https://open.er-api.com/v6/latest/CNY',
      parse: j => { if (j && j.result === 'success' && j.rates) return j.rates.IDR; throw new Error('bad payload'); }
    },
    {
      id: 'frankfurter',
      name: 'Frankfurter (ECB reference rates)',
      url: 'https://api.frankfurter.dev/v1/latest?base=CNY&symbols=IDR',
      parse: j => { if (j && j.rates) return j.rates.IDR; throw new Error('bad payload'); }
    },
    {
      id: 'currency-api',
      name: 'fawazahmed0 currency-api (jsDelivr)',
      url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json',
      parse: j => { if (j && j.cny) return j.cny.idr; throw new Error('bad payload'); }
    }
  ];

  function isSaneRate(r) { return typeof r === 'number' && Number.isFinite(r) && r >= SANE_MIN && r <= SANE_MAX; }

  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** Spread between the highest and lowest value, in percent of the median. */
  function spreadPct(xs) {
    if (xs.length < 2) return 0;
    return (Math.max(...xs) - Math.min(...xs)) / median(xs) * 100;
  }

  async function fetchOne(src, fetchImpl) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(src.url, {
        signal: ctrl ? ctrl.signal : undefined,
        credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rate = Number(src.parse(await res.json()));
      if (!isSaneRate(rate)) throw new Error('rate out of range: ' + rate);
      return { id: src.id, name: src.name, rate };
    } finally { clearTimeout(timer); }
  }

  /** Combine the valid quotes: median value, plus a warning when sources disagree. */
  function combine(quotes) {
    const rates = quotes.map(q => q.rate);
    const spread = spreadPct(rates);
    return {
      rate: Math.round(median(rates) * 100) / 100,
      sources: quotes.map(q => q.name),
      spreadPct: Math.round(spread * 100) / 100,
      disagree: spread > DISAGREE_PCT
    };
  }

  function readCache(storage) {
    try {
      const raw = storage.getItem(CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !isSaneRate(c.rate) || typeof c.fetchedAt !== 'number') return null;
      return c;
    } catch (e) { return null; }
  }

  /**
   * Get the current rate.
   * Order: fresh cache -> live sources (cross-checked) -> stale cache -> fallback.
   * opts: { fetchImpl, storage, now, force }
   */
  async function getRate(opts) {
    const o = opts || {};
    const storage = o.storage || window.localStorage;
    const now = o.now || Date.now();
    const fetchImpl = o.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(window) : null);
    const cached = readCache(storage);

    if (!o.force && cached && now - cached.fetchedAt < TTL_MS) {
      return Object.assign({}, cached, { status: 'cached' });
    }

    if (fetchImpl) {
      const settled = await Promise.allSettled(SOURCES.map(s => fetchOne(s, fetchImpl)));
      const quotes = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (quotes.length) {
        const c = combine(quotes);
        const result = Object.assign(c, { fetchedAt: now, status: 'live' });
        try { storage.setItem(CACHE_KEY, JSON.stringify(result)); } catch (e) { /* storage full or blocked */ }
        return result;
      }
    }

    if (cached) return Object.assign({}, cached, { status: 'stale' });
    return { rate: FALLBACK_RATE, sources: ['Built-in example rate'], spreadPct: 0, disagree: false, fetchedAt: now, status: 'fallback' };
  }

  T.fx = { getRate, combine, median, spreadPct, isSaneRate, SOURCES, FALLBACK_RATE, SANE_MIN, SANE_MAX, TTL_MS, CACHE_KEY };
})(window.Tenang = window.Tenang || {});
