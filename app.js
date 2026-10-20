/* Tenang — Budget, Tip for you, Price feel, Transfer check.
   Plain JavaScript, no libraries. All data stays in this browser (localStorage).
   Security rule: user text is only written with textContent, never innerHTML. */
(function () {
  'use strict';

  // ============================================================ helpers
  const $ = id => document.getElementById(id);
  const yuan0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const yuan2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rupiah = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

  /** ¥1,840 or ¥12.50 */
  function fmtCNY(n) {
    if (!Number.isFinite(n)) return '¥–';
    const a = Math.abs(n), r = Math.round(a * 100) / 100;
    return (n < 0 ? '−' : '') + '¥' + (Number.isInteger(r) ? yuan0.format(r) : yuan2.format(r));
  }
  /** Rp 193.500 (Indonesian separators) */
  function fmtIDR(n) {
    if (!Number.isFinite(n)) return 'Rp –';
    return (n < 0 ? '−' : '') + 'Rp ' + rupiah.format(Math.round(Math.abs(n)));
  }
  const round2 = n => Math.round(n * 100) / 100;

  /** Parse "22.000", "1.500.000", "12.50", "22,000", "1,5", "1.234,56". */
  function parseNumber(raw) {
    let s = String(raw == null ? '' : raw).replace(/[^\d.,-]/g, '');
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) {
      const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else if (hasDot) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.split('.').join('');
    } else if (hasComma) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(',').join('') : s.replace(',', '.');
    }
    const n = s === '' ? NaN : Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  /** Small safe DOM builder: text goes in as text, never as HTML. */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(k => {
      const v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    });
    (children || []).forEach(c => { if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return node;
  }
  function cleanText(s, max) {
    return String(s || '').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  // ============================================================ data
  const HOUSING = [
    { id: 'dorm', label: 'University dorm', desc: 'Shared room on campus', amount: 900 },
    { id: 'shared', label: 'Shared apartment', desc: 'Your own room in a split flat', amount: 2800 },
    { id: 'studio', label: 'Studio apartment', desc: 'Living alone, near campus', amount: 5200 }
  ];
  const FOOD = [
    { id: 'canteen', label: 'Canteen loyalist', desc: 'Campus food most days', amount: 900 },
    { id: 'mixed', label: 'Half and half', desc: 'Canteen plus eating out', amount: 1500 },
    { id: 'out', label: 'Restaurant regular', desc: 'Eating out most days', amount: 2600 }
  ];
  const OTHERS = [
    { id: 'transport', label: 'Transport' },
    { id: 'phone', label: 'Phone & data' },
    { id: 'study', label: 'Study' },
    { id: 'other', label: 'Other' }
  ];
  const FEEL_ITEMS = [
    { id: 'latte', label: 'Café latte', cny: 30, ref: 'glasses of es kopi susu', refIDR: 22000, note: 'In Beijing, café coffee is a treat, not a daily habit. Canteen coffee costs about ¥10.' },
    { id: 'metro', label: 'Metro ride', cny: 4, ref: 'TransJakarta rides', refIDR: 3500, note: 'Beijing metro fares depend on distance and start from ¥3. Still one of the cheapest ways to move around.' },
    { id: 'canteen', label: 'Canteen meal', cny: 12, ref: 'plates of warung nasi goreng', refIDR: 20000, note: 'Canteen food is the best value in the city. It is the base of a calm food budget.' },
    { id: 'data', label: '20 GB data pack', cny: 50, ref: 'Telkomsel packs', refIDR: 55000, note: 'Student SIM plans often include data. Compare before you top up.' }
  ];
  const STATIC_TIPS = [
    { title: 'Pay like a local', body: 'Set up Alipay or WeChat Pay in your first week. Cash is rare in Beijing, and foreign card fees grow fast.' },
    { title: 'The canteen rule', body: 'A canteen meal costs ¥10 to ¥15. If you eat out every day, your food budget can become three times larger.' },
    { title: 'Watch what arrives', body: 'Compare the rupiah amount that arrives, not the advertised rate. "Free" transfers can hide extra margins.' },
    { title: 'Plan the treat', body: 'Set a fixed fun budget each week. Plan the bubble tea, then enjoy it without guilt.' },
    { title: 'Ride the metro', body: 'A metro ride costs about ¥3 to ¥6. A taxi across town can cost ten times more.' },
    { title: 'Keep a small buffer', body: 'Keep about 10% of your monthly budget for surprises: a doctor visit, a lost card, a trip home.' }
  ];

  // ============================================================ state (localStorage, validated)
  const KEY = 'tenang.simple.v1';
  const RATE_MIN = 1500, RATE_MAX = 3500;      // plausible rupiah per ¥1
  const FALLBACK_RATE = 2250;
  const isSaneRate = r => typeof r === 'number' && Number.isFinite(r) && r >= RATE_MIN && r <= RATE_MAX;

  function defaults() {
    return { housing: 'dorm', food: 'mixed', costs: { transport: 150, phone: 50, study: 100, other: 200, fun: 600 }, rateMode: 'live', manualRate: null };
  }
  function sanitize(raw) {
    const s = defaults();
    if (!raw || typeof raw !== 'object') return s;
    if (HOUSING.some(o => o.id === raw.housing)) s.housing = raw.housing;
    if (FOOD.some(o => o.id === raw.food)) s.food = raw.food;
    if (raw.costs && typeof raw.costs === 'object') {
      Object.keys(s.costs).forEach(k => {
        const v = Number(raw.costs[k]);
        if (Number.isFinite(v) && v >= 0 && v <= 100000) s.costs[k] = round2(v);
      });
    }
    const mr = Number(raw.manualRate);
    s.manualRate = raw.manualRate != null && isSaneRate(mr) ? mr : null;
    s.rateMode = raw.rateMode === 'manual' && s.manualRate ? 'manual' : 'live';
    return s;
  }
  let state;
  try { state = sanitize(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch (e) { state = defaults(); }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage blocked */ } }

  // ============================================================ live exchange rate
  const FX_CACHE = 'tenang.fx.v1';
  const FX_TTL = 6 * 60 * 60 * 1000;
  const SOURCES = [
    { name: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/CNY', pick: j => j && j.result === 'success' && j.rates ? j.rates.IDR : NaN },
    { name: 'Frankfurter (ECB)', url: 'https://api.frankfurter.dev/v1/latest?base=CNY&symbols=IDR', pick: j => j && j.rates ? j.rates.IDR : NaN },
    { name: 'currency-api (jsDelivr)', url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/cny.json', pick: j => j && j.cny ? j.cny.idr : NaN }
  ];
  let live = { rate: FALLBACK_RATE, status: 'loading', sources: [], fetchedAt: Date.now(), spreadPct: 0 };

  function median(xs) {
    const s = xs.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  async function fetchSource(src) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(src.url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const rate = Number(src.pick(await res.json()));
      if (!isSaneRate(rate)) throw new Error('rate out of range');
      return { name: src.name, rate };
    } finally { clearTimeout(timer); }
  }

  /** Fresh cache → live (median of valid sources) → old cache → example rate. */
  async function loadLiveRate(force) {
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(FX_CACHE) || 'null'); } catch (e) { cached = null; }
    if (cached && !isSaneRate(cached.rate)) cached = null;
    if (!force && cached && Date.now() - cached.fetchedAt < FX_TTL) {
      live = Object.assign({}, cached, { status: 'cached' });
    } else {
      live = Object.assign({}, live, { status: 'loading' });
      renderAll();
      const results = await Promise.allSettled(SOURCES.map(fetchSource));
      const quotes = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (quotes.length) {
        const rates = quotes.map(q => q.rate), mid = median(rates);
        live = { rate: round2(mid), sources: quotes.map(q => q.name), spreadPct: round2((Math.max(...rates) - Math.min(...rates)) / mid * 100), fetchedAt: Date.now(), status: 'live' };
        try { localStorage.setItem(FX_CACHE, JSON.stringify(live)); } catch (e) { /* ignore */ }
      } else if (cached) {
        live = Object.assign({}, cached, { status: 'stale' });
      } else {
        live = { rate: FALLBACK_RATE, sources: ['Built-in example rate'], spreadPct: 0, fetchedAt: Date.now(), status: 'fallback' };
      }
    }
    if (!quotesEdited) initQuotes();
    renderAll();
  }

  /** The rate used everywhere in the app. */
  const rate = () => (state.rateMode === 'manual' && state.manualRate ? state.manualRate : live.rate);
  function rateLabel() {
    if (state.rateMode === 'manual' && state.manualRate) return 'manual rate';
    return { live: 'live', cached: 'live', stale: 'offline, last known', fallback: 'offline, example rate', loading: 'loading' }[live.status];
  }

  function renderFx() {
    const manual = state.rateMode === 'manual' && state.manualRate;
    $('fx-text').textContent = '¥1 = ' + fmtIDR(rate()) + ' · ' + rateLabel();
    $('fx-dot').className = 'fx-dot ' + (manual ? 'manual' : (live.status === 'live' || live.status === 'cached') ? 'ok' : 'warn');
  }

  // ============================================================ budget
  function budgetTotals() {
    const h = HOUSING.find(o => o.id === state.housing), f = FOOD.find(o => o.id === state.food);
    const parts = [{ label: 'Housing', amount: h.amount }, { label: 'Food', amount: f.amount }]
      .concat(OTHERS.map(o => ({ label: o.label, amount: state.costs[o.id] })))
      .concat([{ label: 'Fun', amount: state.costs.fun }]);
    return { parts, total: parts.reduce((s, p) => s + p.amount, 0) };
  }

  function optionCard(group, list, o) {
    const id = 'o-' + group + '-' + o.id;
    const input = el('input', { type: 'radio', name: 'opt-' + group, id, value: o.id, checked: state[group] === o.id || null });
    input.addEventListener('change', () => { state[group] = o.id; save(); renderAll(); });
    return el('label', { class: 'option', for: id }, [input,
      el('span', { class: 'opt-main' }, [el('strong', { text: o.label }), el('span', { class: 'muted small', text: o.desc })]),
      el('span', { class: 'opt-price', text: fmtCNY(o.amount) + '/mo' })]);
  }

  function renderBudget() {
    if (!$('opt-housing').childElementCount) {
      $('opt-housing').append(...HOUSING.map(o => optionCard('housing', HOUSING, o)));
      $('opt-food').append(...FOOD.map(o => optionCard('food', FOOD, o)));
      $('other-budgets').append(...OTHERS.map(o => {
        const inp = el('input', { inputmode: 'decimal', maxlength: '7', value: String(state.costs[o.id]), 'aria-label': o.label + ' per month in yuan' });
        inp.addEventListener('change', () => {
          const v = parseNumber(inp.value);
          if (!(v >= 0 && v <= 100000)) { inp.value = String(state.costs[o.id]); return; }   // reject and restore
          state.costs[o.id] = round2(v); save(); renderAll();
        });
        return el('label', null, [o.label, inp]);
      }));
      $('fun-slider').value = String(state.costs.fun);
    }
    $('fun-value').textContent = fmtCNY(state.costs.fun);
    const { parts, total } = budgetTotals();
    $('budget-total').textContent = fmtCNY(total);
    $('budget-idr').textContent = '≈ ' + fmtIDR(total * rate()) + ' / month';
    $('budget-breakdown').replaceChildren(...parts.filter(p => p.amount > 0).map(p =>
      el('li', null, [el('span', { text: p.label }), el('span', { text: fmtCNY(p.amount) })])));
    $('budget-comment').textContent = total <= 3500 ? 'A lean, calm student budget. Canteen food and campus housing make it work.'
      : total <= 6000 ? 'A comfortable budget with room for small treats.'
        : 'This is a high budget. Check that your scholarship or family budget can support it.';
    const t = tips()[0];
    $('mini-tip-title').textContent = t.title;
    $('mini-tip-body').textContent = t.body;
  }

  // ============================================================ tips
  /** Tips picked from the user's own budget come first, each with the reason. */
  function tips() {
    const { total } = budgetTotals();
    const out = [];
    if (state.food === 'out') out.push({ title: 'The canteen rule', body: 'Eating out most days costs ' + fmtCNY(2600) + ' a month. Two canteen days a week can save about ' + fmtCNY(450) + '.', why: 'Because you picked "Restaurant regular".' });
    if (state.housing === 'studio') out.push({ title: 'Housing is your biggest cost', body: 'A studio takes ' + fmtCNY(5200) + ' a month. A shared flat saves ' + fmtCNY(2400) + ', about ' + fmtIDR(2400 * rate()) + '.', why: 'Because you picked "Studio apartment".' });
    if (state.costs.fun > 1000) out.push({ title: 'Plan the treat', body: 'Your fun money is ' + fmtCNY(state.costs.fun) + '. Split it per week so the last week still feels free.', why: 'Because your fun money is above ¥1,000.' });
    if (total > 6000) out.push({ title: 'Check your funding', body: 'Your plan is ' + fmtIDR(total * rate()) + ' a month. Compare it with your scholarship or family transfer before you fly.', why: 'Because your budget is above ¥6,000.' });
    if (state.rateMode === 'manual') out.push({ title: 'Update your fixed rate', body: 'You use a manual rate of ' + fmtIDR(state.manualRate) + '. Check it against the live rate once a week.', why: 'Because you chose a manual rate.' });
    STATIC_TIPS.forEach(t => { if (!out.some(o => o.title === t.title)) out.push(Object.assign({ why: '' }, t)); });
    return out;
  }
  let tipIndex = 0;
  function renderTips() {
    const list = tips();
    tipIndex = ((tipIndex % list.length) + list.length) % list.length;
    const t = list[tipIndex];
    $('tip-count').textContent = 'Tip ' + (tipIndex + 1) + ' of ' + list.length;
    $('tip-title').textContent = t.title;
    $('tip-body').textContent = t.body;
    $('tip-why').textContent = t.why;
    $('tip-why').hidden = !t.why;
    $('tip-list').replaceChildren(...list.map((x, i) => {
      const b = el('button', { type: 'button', class: 'linkish' + (i === tipIndex ? ' on' : ''), text: x.title });
      b.addEventListener('click', () => { tipIndex = i; renderTips(); });
      return el('li', null, [b]);
    }));
  }

  // ============================================================ price feel
  let feelItem = FEEL_ITEMS[0], feelCustom = null;
  function renderFeel() {
    const chips = $('feel-chips');
    if (!chips.childElementCount) {
      chips.append(...FEEL_ITEMS.map(it => {
        const b = el('button', { type: 'button', class: 'chip', role: 'radio', 'data-id': it.id, text: it.label + ' · ' + fmtCNY(it.cny) });
        b.addEventListener('click', () => { feelItem = it; feelCustom = null; $('feel-custom').value = ''; renderFeel(); });
        return b;
      }));
    }
    chips.querySelectorAll('.chip').forEach(b => {
      const on = !feelCustom && b.dataset.id === feelItem.id;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
    const cny = feelCustom || feelItem.cny;
    const idr = cny * rate();
    $('feel-cny').textContent = fmtCNY(cny);
    $('feel-idr').textContent = '= ' + fmtIDR(idr);
    $('feel-units').textContent = '≈ ' + Math.round(idr / feelItem.refIDR * 10) / 10 + ' ' + feelItem.ref;
    $('feel-note').textContent = feelCustom ? 'Compared with ' + feelItem.ref + ' at ' + fmtIDR(feelItem.refIDR) + ' each.' : feelItem.note;
    $('feel-rate').textContent = 'Rate · ¥1 ≈ ' + fmtIDR(rate()) + ' (' + rateLabel() + ')';
  }

  // ============================================================ transfer check
  let quotes = [], quotesEdited = false;
  function initQuotes() {
    const mid = live.rate;
    quotes = [
      { name: 'Bank transfer (SWIFT)', feeIDR: 150000, rate: Math.round(mid * 1.025) },
      { name: 'Remittance app', feeIDR: 35000, rate: Math.round(mid * 1.01) },
      { name: '"Zero fee" service', feeIDR: 0, rate: Math.round(mid * 1.04) }
    ];
    $('tr-quotes').replaceChildren();
  }

  /**
   * What actually arrives.
   * received = (send − fee) ÷ providerRate; true cost = send − received × marketRate.
   */
  function analyze(q, send, mid) {
    const fee = Number(q.feeIDR) || 0, r = Number(q.rate);
    if (!(send > 0) || fee < 0 || fee >= send || !(r > 0) || !(mid > 0)) return null;
    const received = (send - fee) / r;
    const cost = send - received * mid;
    return { name: q.name, received: round2(received), ideal: round2(send / mid), margin: round2((r - mid) / mid * 100), cost: Math.round(cost), costPct: round2(cost / send * 100) };
  }

  function renderRateForm() {
    $('mode-live').checked = state.rateMode === 'live';
    $('mode-manual').checked = state.rateMode === 'manual';
    $('manual-rate').disabled = !$('mode-manual').checked;
    if (state.manualRate && document.activeElement !== $('manual-rate')) $('manual-rate').value = String(state.manualRate);
    // Short line on screen; full details in the tooltip.
    const n = live.sources.length;
    const short = { live: n + (n === 1 ? ' source' : ' sources'), cached: n + (n === 1 ? ' source' : ' sources'), stale: 'offline, last known', fallback: 'offline, example rate' }[live.status];
    $('live-info').textContent = live.status === 'loading' ? 'Loading…' : '¥1 = ' + fmtIDR(live.rate) + ' · ' + short;
    renderRateTooltip();
  }

  /** Rich tooltip: rate, sources, last update, method, agreement between sources. */
  function timeAgo(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 24 ? h + ' h ago' : Math.round(h / 24) + ' d ago';
  }
  function renderRateTooltip() {
    const box = $('live-tip');
    if (live.status === 'loading') { box.replaceChildren(el('p', { class: 'tt-note', text: 'Fetching the latest rate…' })); return; }
    const head = el('div', { class: 'tt-head' }, [
      el('span', { class: 'tt-eyebrow', text: live.status === 'fallback' ? 'Example rate' : live.status === 'stale' ? 'Last known rate' : 'Live rate' }),
      el('span', { class: 'tt-rate', text: '¥1 = ' + fmtIDR(live.rate) })
    ]);
    if (live.status === 'fallback') {
      box.replaceChildren(head, el('p', { class: 'tt-note warn', text: 'All rate sources are unreachable right now. Tenang uses the example rate until they are back.' }));
      return;
    }
    const d = new Date(live.fetchedAt);
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' + d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    const agree = live.spreadPct <= 2;
    const row = (label, value, extra) => el('div', { class: 'tt-row' }, [el('span', { class: 'tt-label', text: label }), el('span', { class: 'tt-value' + (extra || '') }, value)]);
    box.replaceChildren(...[
      head,
      el('div', { class: 'tt-rows' }, [
        row('Sources', [el('ul', { class: 'tt-sources' }, live.sources.map(s => el('li', { text: s })))]),
        row('Updated', [time, el('span', { class: 'tt-sub', text: timeAgo(live.fetchedAt) })]),
        row('Method', ['Median of ' + live.sources.length + (live.sources.length === 1 ? ' source' : ' sources')]),
        row('Agreement', [agree ? 'Sources agree (±' + live.spreadPct + '%)' : 'Sources differ by ' + live.spreadPct + '%'], agree ? ' good' : ' warn')
      ]),
      live.status === 'stale' ? el('p', { class: 'tt-note warn', text: 'Sources are unreachable now. This is the last known rate.' }) : null
    ].filter(Boolean));
  }

  function renderTransfer() {
    renderRateForm();
    if (!$('tr-quotes').childElementCount) {
      $('tr-quotes').append(...quotes.map((q, i) => {
        const name = el('input', { value: q.name, maxlength: '40', 'aria-label': 'Provider ' + (i + 1) + ' name' });
        const fee = el('input', { value: rupiah.format(q.feeIDR), inputmode: 'numeric', maxlength: '12', 'aria-label': 'Provider ' + (i + 1) + ' fee in rupiah' });
        const r = el('input', { value: String(q.rate), inputmode: 'decimal', maxlength: '8', 'aria-label': 'Provider ' + (i + 1) + ' rate, rupiah per yuan' });
        const upd = () => {
          quotesEdited = true;
          q.name = cleanText(name.value, 40) || 'Provider ' + (i + 1);
          q.feeIDR = parseNumber(fee.value) || 0;
          q.rate = parseNumber(r.value);
          computeTransfer();
        };
        [name, fee, r].forEach(x => x.addEventListener('input', upd));
        return el('fieldset', { class: 'quote' }, [el('legend', { text: 'Quote ' + (i + 1) }),
          el('label', null, ['Provider', name]), el('label', null, ['Fee (Rp)', fee]), el('label', null, ['Rate (Rp per ¥1)', r])]);
      }));
    }
    computeTransfer();
  }

  function computeTransfer() {
    const send = parseNumber($('tr-send').value), mid = rate();
    $('tr-mid').textContent = 'Compared against ¥1 = ' + fmtIDR(mid) + ' (' + rateLabel() + ').';
    const ranked = quotes.map(q => analyze(q, send, mid)).filter(Boolean).sort((a, b) => b.received - a.received);
    const t = $('tr-table');
    if (!ranked.length) { t.replaceChildren(); $('tr-verdict').textContent = 'Enter the amount and at least one valid quote.'; return; }
    t.replaceChildren(
      el('thead', null, [el('tr', null, ['Provider', 'Arrives', 'Rate margin', 'True cost'].map(h => el('th', { scope: 'col', text: h })))]),
      el('tbody', null, ranked.map((r, i) => el('tr', { class: i === 0 ? 'best' : null }, [
        el('th', { scope: 'row', text: r.name + (i === 0 ? ' ★' : '') }),
        el('td', { text: fmtCNY(r.received) }),
        el('td', { text: (r.margin >= 0 ? '+' : '') + r.margin + '%' }),
        el('td', { text: fmtIDR(r.cost) + ' (' + r.costPct + '%)' })]))));
    const best = ranked[0], worst = ranked[ranked.length - 1];
    $('tr-verdict').textContent = (ranked.length > 1
      ? best.name + ' delivers ' + fmtCNY(round2(best.received - worst.received)) + ' more than ' + worst.name + '.'
      : best.name + ' delivers ' + fmtCNY(best.received) + '.') + ' At this rate you would get ' + fmtCNY(best.ideal) + ' with no fee or margin.';
  }

  // ============================================================ routing + wiring
  const VIEWS = ['budget', 'tips', 'feel', 'transfer'];
  let current = 'budget';
  function route() {
    const h = (location.hash || '#budget').slice(1);
    current = VIEWS.includes(h) ? h : 'budget';
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== current; });
    document.querySelectorAll('.tabs a').forEach(a => {
      if (a.dataset.tab === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderAll();
  }
  function renderAll() {
    renderFx();
    ({ budget: renderBudget, tips: renderTips, feel: renderFeel, transfer: renderTransfer })[current]();
  }

  function wire() {
    window.addEventListener('hashchange', route);
    $('fun-slider').addEventListener('input', e => { state.costs.fun = Number(e.target.value); renderAll(); });
    $('fun-slider').addEventListener('change', save);
    $('tip-prev').addEventListener('click', () => { tipIndex--; renderTips(); });
    $('tip-next').addEventListener('click', () => { tipIndex++; renderTips(); });
    $('feel-custom').addEventListener('input', e => {
      const v = parseNumber(e.target.value);
      feelCustom = v > 0 && v <= 100000 ? v : null;
      renderFeel();
    });
    $('tr-send').addEventListener('input', computeTransfer);

    // Rate form: live or manual (fixed)
    ['mode-live', 'mode-manual'].forEach(id => $(id).addEventListener('change', () => {
      $('manual-rate').disabled = !$('mode-manual').checked;
      if ($('mode-manual').checked) $('manual-rate').focus();
      $('rate-msg').textContent = '';
    }));
    $('live-refresh').addEventListener('click', () => loadLiveRate(true));

    // Tooltip: hover or keyboard focus shows it (CSS); tap toggles it on phones; Esc or a tap elsewhere closes it.
    const wrap = document.querySelector('.tip-wrap'), infoBtn = $('live-info-btn');
    infoBtn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const open = wrap.classList.toggle('open');
      infoBtn.setAttribute('aria-expanded', String(open));
    });
    $('live-tip').addEventListener('click', e => e.preventDefault());   // reading the tooltip must not change the radio choice
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) { wrap.classList.remove('open'); infoBtn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { wrap.classList.remove('open'); infoBtn.setAttribute('aria-expanded', 'false'); } });

    $('rate-form').addEventListener('submit', e => {
      e.preventDefault();
      const msg = $('rate-msg');
      if ($('mode-live').checked) {
        state.rateMode = 'live'; save();
        msg.textContent = 'Using the live rate.'; msg.className = 'small ok';
      } else {
        const v = parseNumber($('manual-rate').value);
        if (!isSaneRate(v)) {
          msg.textContent = 'Enter a rate between Rp ' + rupiah.format(RATE_MIN) + ' and Rp ' + rupiah.format(RATE_MAX) + ' per ¥1.';
          msg.className = 'small err';
          return;
        }
        state.manualRate = round2(v); state.rateMode = 'manual'; save();
        msg.textContent = 'Using your manual rate: ¥1 = ' + fmtIDR(v) + '.'; msg.className = 'small ok';
      }
      renderAll();
    });
  }

  function init() {
    initQuotes();
    wire();
    route();
    loadLiveRate(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();