/* Tenang — UI controller. Renders views and wires events.
   Security rule for this file: user data is only ever written with
   textContent / el(), never innerHTML. */
(function (T) {
  'use strict';
  const U = T.utils, A = T.agentCore, el = U.el;
  const $ = id => document.getElementById(id);

  const store = T.store.createStore(window.localStorage);
  const log = T.audit.createLog(window.localStorage);
  let fxInfo = { rate: T.fx.FALLBACK_RATE, status: 'loading', sources: [], fetchedAt: Date.now() };
  const rate = () => store.get().settings.manualRate || fxInfo.rate;
  const agent = T.agent.createAgent({ store, audit: log, getRate: rate });
  const catLabel = id => (T.store.CATEGORIES.find(c => c.id === id) || { label: id }).label;

  // ---------------------------------------------------------------- dialogs
  function confirmDialog(title, body, reasons) {
    const d = $('confirm-dialog');
    if (!d || typeof d.showModal !== 'function') return Promise.resolve(window.confirm(title + '\n\n' + body));
    $('cd-title').textContent = title;
    $('cd-body').textContent = body;
    const ul = $('cd-reasons'); ul.replaceChildren(...(reasons || []).map(r => el('li', { text: r })));
    return new Promise(resolve => {
      const done = v => { d.close(); $('cd-yes').onclick = null; $('cd-no').onclick = null; d.oncancel = null; resolve(v); };
      $('cd-yes').onclick = () => done(true);
      $('cd-no').onclick = () => done(false);
      d.oncancel = e => { e.preventDefault(); done(false); };
      d.showModal();
      $('cd-no').focus();
    });
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------- routing
  const VIEWS = ['today', 'budget', 'expenses', 'transfer', 'feel', 'activity', 'settings'];
  let current = 'today';
  function route() {
    const h = (location.hash || '#today').slice(1);
    current = VIEWS.includes(h) ? h : 'today';
    VIEWS.forEach(v => { $('view-' + v).hidden = v !== current; });
    document.querySelectorAll('.tabs a').forEach(a => {
      if (a.dataset.tab === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderCurrent();
  }
  function renderCurrent() {
    ({ today: renderToday, budget: renderBudget, expenses: renderExpenses, transfer: renderTransfer,
      feel: renderFeel, activity: renderActivity, settings: renderSettings })[current]();
  }

  // ------------------------------------------------------------- FX header
  function renderFx() {
    const manual = store.get().settings.manualRate;
    const r = rate();
    const labels = { live: 'live', cached: 'live (cached)', stale: 'offline, last known', fallback: 'offline, example rate', loading: 'loading' };
    const status = manual ? 'fixed by you' : labels[fxInfo.status] || fxInfo.status;
    $('fx-text').textContent = '¥1 = ' + U.fmtIDR(r) + ' · ' + status + (fxInfo.disagree && !manual ? ' · sources differ' : '');
    $('fx-dot').className = 'fx-dot ' + (manual ? 'manual' : (fxInfo.status === 'live' || fxInfo.status === 'cached') ? 'ok' : 'warn');
    $('fx').title = manual ? 'Fixed rate from Settings' :
      'Sources: ' + (fxInfo.sources || []).join(', ') + '\nUpdated: ' + new Date(fxInfo.fetchedAt).toLocaleString() +
      (fxInfo.spreadPct ? '\nSpread between sources: ' + fxInfo.spreadPct + '%' : '');
  }

  async function loadRate(force) {
    const prev = fxInfo.rate;
    fxInfo = await T.fx.getRate({ force });
    if (fxInfo.status === 'live' || force) {
      log.append('system', 'fx_update', 0, 'info', '¥1 = Rp ' + fxInfo.rate + ' · ' + fxInfo.status + ' · ' + (fxInfo.sources || []).length + ' source(s)' + (fxInfo.disagree ? ' · DISAGREE ' + fxInfo.spreadPct + '%' : ''));
    }
    renderFx();
    if (prev !== fxInfo.rate) renderCurrent();
  }

  // ------------------------------------------------------------------ TODAY
  const STATIC_TIPS = [
    { title: 'Pay like a local', body: 'Set up Alipay or WeChat Pay in your first week. Cash is rare in Beijing, and foreign card fees grow fast.' },
    { title: 'The canteen rule', body: 'A canteen meal costs ¥10 to ¥15. If you eat out every day, your food budget can become three times larger.' },
    { title: 'Watch what arrives', body: 'Compare the rupiah amount that arrives, not the advertised rate. "Free" transfers can hide extra margins.' },
    { title: 'Plan the treat', body: 'Set a fixed fun budget each week. Plan the bubble tea, then enjoy it without guilt.' }
  ];
  let tipIndex = 0;

  function renderToday() {
    const now = new Date();
    const m = A.computeMonth(store.get(), now);
    $('today-date').textContent = 'Today · ' + U.WEEKDAYS[now.getDay()];
    $('today-spent').textContent = U.fmtCNY(m.spentToday);
    $('today-idr').textContent = '≈ ' + U.fmtIDR(m.spentToday * rate()) + ' spent today';
    const msg = { 'on-track': 'You are on track this month.', watch: 'Watch your pace a little this week.', over: 'You are heading over budget. A calm reset helps.' };
    $('today-status').textContent = m.count ? msg[m.status] : 'Add your first expense to start.';
    $('today-status').className = 'status ' + m.status;
    $('today-safe').textContent = U.fmtCNY(m.safeToday);
    $('today-month').textContent = U.fmtCNY(m.spentTotal) + ' of ' + U.fmtCNY(m.budgetTotal);
    $('today-proj').textContent = U.fmtCNY(m.projectedTotal);
    $('today-bar').style.width = Math.min(100, m.budgetTotal ? m.spentTotal / m.budgetTotal * 100 : 0) + '%';
    $('today-bar').className = m.status;
    $('empty-card').hidden = store.get().expenses.length > 0;
    renderTip(m);
  }

  function renderTip(m) {
    const list = A.tips(m || A.computeMonth(store.get(), new Date())).concat(STATIC_TIPS);
    const t = list[tipIndex % list.length];
    $('tip-title').textContent = t.title;
    $('tip-body').textContent = t.body;
  }

  function chatPush(who, text, extra) {
    const li = el('li', { class: 'msg ' + who });
    li.append(el('p', { text }));
    if (extra && extra.tier != null && who === 'agent') {
      const mode = { auto: 'ran automatically', confirm: 'needs your OK', block: 'blocked' }[extra.mode] || extra.mode;
      li.append(el('span', { class: 'tier t' + extra.tier, text: 'Tier ' + extra.tier + ' · ' + T.agentCore.TIERS[extra.tier].name + ' · ' + mode }));
    }
    if (extra && extra.pending) {
      const box = el('div', { class: 'pending' });
      box.append(el('p', { class: 'small', text: 'Why I am asking:' }));
      box.append(el('ul', { class: 'reasons' }, extra.reasons.map(r => el('li', { text: r }))));
      const yes = el('button', { class: 'btn small', type: 'button', text: 'Confirm' });
      const no = el('button', { class: 'btn ghost small', type: 'button', text: 'Cancel' });
      const act = approve => {
        yes.disabled = no.disabled = true;
        const r = agent.resolve(extra.pending.id, approve);
        chatPush('agent', r.reply);
        renderCurrent();
      };
      yes.addEventListener('click', () => act(true));
      no.addEventListener('click', () => act(false));
      box.append(el('div', { class: 'row' }, [yes, no]));
      li.append(box);
    }
    $('chat').append(li);
    li.scrollIntoView({ block: 'nearest' });
  }

  function send(text) {
    chatPush('user', text);
    const r = agent.handle(text);
    chatPush('agent', r.reply, r);
    if (r.navigate) setTimeout(() => { location.hash = '#' + r.navigate; }, 600);
    renderCurrent();
  }

  // ----------------------------------------------------------------- BUDGET
  function optionCard(kind, o, checked) {
    const id = 'o-' + kind + '-' + o.id;
    const input = el('input', { type: 'radio', name: 'opt-' + kind, id, value: o.id, checked: checked || null });
    input.addEventListener('change', () => {
      store.setPlan(kind, o.id);
      log.append('user', 'set_plan', 2, 'direct', kind + ' = ' + o.id + ' (¥' + o.amount + ')');
    });
    return el('label', { class: 'option', for: id }, [input,
      el('span', { class: 'opt-main' }, [el('strong', { text: o.label }), el('span', { class: 'muted small', text: o.desc })]),
      el('span', { class: 'opt-price', text: U.fmtCNY(o.amount) + '/mo' })]);
  }

  function renderBudget() {
    const s = store.get();
    $('opt-housing').replaceChildren(...T.store.PLAN_OPTIONS.housing.map(o => optionCard('housing', o, s.plan.housingOption === o.id)));
    $('opt-food').replaceChildren(...T.store.PLAN_OPTIONS.food.map(o => optionCard('food', o, s.plan.foodOption === o.id)));
    const others = ['transport', 'phone', 'study', 'other'];
    $('other-budgets').replaceChildren(...others.map(c => {
      const inp = el('input', { inputmode: 'decimal', maxlength: '7', value: String(s.budget[c]), 'aria-label': catLabel(c) + ' budget in yuan' });
      inp.addEventListener('change', () => {
        const v = A.parseNumber(inp.value);
        if (!(v >= 0 && v <= U.LIMITS.MAX_AMOUNT_CNY)) { inp.value = String(store.get().budget[c]); return; }
        store.setBudget(c, v);
        log.append('user', 'set_budget', 2, 'direct', c + ' = ' + v);
      });
      return el('label', null, [catLabel(c), inp]);
    }));
    const slider = $('fun-slider');
    slider.value = String(s.budget.fun);
    $('fun-value').textContent = U.fmtCNY(s.budget.fun);

    const total = T.store.CAT_IDS.reduce((x, c) => x + s.budget[c], 0);
    $('budget-total').textContent = U.fmtCNY(total);
    $('budget-idr').textContent = '≈ ' + U.fmtIDR(total * rate()) + ' / month';
    $('budget-breakdown').textContent = T.store.CATEGORIES.filter(c => s.budget[c.id] > 0).map(c => c.label + ' ' + U.fmtCNY(s.budget[c.id])).join(' · ');
    $('budget-comment').textContent = total <= 3500 ? 'A lean, calm student budget. Canteen food and campus housing make it work.'
      : total <= 6000 ? 'A comfortable budget with room for small treats.'
        : 'This is a high budget. Check that your scholarship or family budget can support it.';

    const m = A.computeMonth(s, new Date());
    $('cat-progress').replaceChildren(...m.categories.filter(c => c.budget > 0 || c.spent > 0).map(c => {
      const bar = el('span');
      bar.style.width = Math.min(100, c.usedPct) + '%';
      const cls = c.usedPct > 100 ? 'over' : c.ahead ? 'watch' : 'ok';
      bar.className = cls;
      const text = c.id === 'housing' && c.spent >= c.budget && c.budget > 0 ? U.fmtCNY(c.spent) + ' · paid' : U.fmtCNY(c.spent) + ' of ' + U.fmtCNY(c.budget);
      return el('li', null, [el('div', { class: 'row between' }, [el('span', { text: c.label }), el('span', { class: 'muted small', text })]), el('div', { class: 'bar' }, [bar])]);
    }));
  }

  // --------------------------------------------------------------- EXPENSES
  function learnFrom(note, category) {
    const stop = new Set(['the', 'and', 'with', 'from', 'for', 'dan', 'yang']);
    const word = note.toLowerCase().split(/[^\p{L}\p{N}-]+/u).find(w => w.length >= 3 && !stop.has(w) && !/^\d+$/.test(w));
    if (word) { store.learn(word, category); return word; }
    return null;
  }

  function renderExpenses() {
    const s = store.get();
    const catSel = $('f-category');
    if (!catSel.options.length) {
      T.store.CATEGORIES.forEach(c => {
        catSel.append(el('option', { value: c.id, text: c.label }));
        $('filter-cat').append(el('option', { value: c.id, text: c.label }));
      });
      catSel.value = 'food';
      $('f-date').value = U.isoDate(new Date());
      $('filter-month').value = U.monthKey(new Date());
    }
    const fm = $('filter-month').value, fc = $('filter-cat').value;
    const list = s.expenses.filter(e => (!fm || e.date.slice(0, 7) === fm) && (!fc || e.category === fc))
      .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : (a.date < b.date ? 1 : -1)));
    const sum = list.reduce((x, e) => x + e.amountCNY, 0);
    $('exp-summary').textContent = list.length + ' expenses · ' + U.fmtCNY(U.round2(sum)) + ' ≈ ' + U.fmtIDR(sum * rate());

    const groups = new Map();
    list.forEach(e => { if (!groups.has(e.date)) groups.set(e.date, []); groups.get(e.date).push(e); });
    const frag = [];
    groups.forEach((items, date) => {
      const [y, mo, d] = date.split('-').map(Number);
      const dt = new Date(y, mo - 1, d);
      frag.push(el('h3', { class: 'day-head', text: U.WEEKDAYS[dt.getDay()] + ', ' + d + ' ' + U.MONTHS[mo - 1] }));
      frag.push(el('ul', { class: 'exp-list' }, items.map(e => {
        const sel = el('select', { 'aria-label': 'Category for ' + e.note }, T.store.CATEGORIES.map(c => el('option', { value: c.id, text: c.label, selected: c.id === e.category || null })));
        sel.addEventListener('change', () => {
          store.updateExpenseCategory(e.id, sel.value);
          const w = learnFrom(e.note, sel.value);
          log.append('user', 'recategorize', 1, 'direct', e.id.slice(0, 8) + ' → ' + sel.value + (w ? ' · learned "' + w + '"' : ''));
        });
        const del = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Delete ' + e.note, text: '✕' });
        del.addEventListener('click', async () => {
          const ok = await confirmDialog('Delete this expense?', U.fmtCNY(e.amountCNY) + ' · ' + e.note + ' · ' + e.date, ['Deleting cannot be undone.']);
          if (!ok) { log.append('user', 'delete_expense', 2, 'declined', e.id.slice(0, 8)); return; }
          store.deleteExpense(e.id);
          log.append('user', 'delete_expense', 2, 'confirmed', U.fmtCNY(e.amountCNY) + ' ' + e.category + ' · id ' + e.id.slice(0, 8));
        });
        const sub = e.originalCurrency === 'IDR' ? U.fmtIDR(e.originalAmount) + ' at Rp ' + Math.round(e.rateUsed || rate()) : '≈ ' + U.fmtIDR(e.amountCNY * rate());
        return el('li', { class: 'exp' }, [
          el('div', { class: 'exp-main' }, [el('strong', { text: e.note }), el('span', { class: 'muted small', text: (e.source === 'agent' ? 'via agent · ' : '') + sub })]),
          sel, el('span', { class: 'exp-amt', text: U.fmtCNY(e.amountCNY) }), del]);
      })));
    });
    if (!frag.length) frag.push(el('p', { class: 'muted', text: 'No expenses here yet.' }));
    $('exp-list').replaceChildren(...frag);
  }

  function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // block spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  }

  // --------------------------------------------------------------- TRANSFER
  let quotes = null;
  function initQuotes() {
    const mid = rate();
    quotes = [
      { name: 'Bank transfer (SWIFT)', feeIDR: 150000, rate: Math.round(mid * 1.025) },
      { name: 'Remittance app', feeIDR: 35000, rate: Math.round(mid * 1.01) },
      { name: '"Zero fee" service', feeIDR: 0, rate: Math.round(mid * 1.04) }
    ];
  }

  function renderTransfer() {
    if (!quotes) initQuotes();
    const mid = rate();
    $('tr-mid').textContent = 'Market rate now: ¥1 = ' + U.fmtIDR(mid) + ' (' + (store.get().settings.manualRate ? 'fixed by you' : fxInfo.status) + ').';
    if (!$('tr-quotes').childElementCount) {
      $('tr-quotes').replaceChildren(...quotes.map((q, i) => {
        const name = el('input', { value: q.name, maxlength: '40', 'aria-label': 'Provider ' + (i + 1) + ' name' });
        const fee = el('input', { value: U.fmtIDR(q.feeIDR).replace('Rp ', ''), inputmode: 'numeric', maxlength: '12', 'aria-label': 'Provider ' + (i + 1) + ' fee in rupiah' });
        const r = el('input', { value: String(q.rate), inputmode: 'decimal', maxlength: '8', 'aria-label': 'Provider ' + (i + 1) + ' rate, rupiah per yuan' });
        const upd = () => {
          q.name = U.cleanText(name.value, 40) || 'Provider ' + (i + 1);
          q.feeIDR = A.parseNumber(fee.value) || 0;
          q.rate = A.parseNumber(r.value);
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
    const send = A.parseNumber($('tr-send').value);
    const ranked = A.rankTransfers(quotes.map(q => Object.assign({ sendIDR: send }, q)), rate());
    const t = $('tr-table');
    if (!ranked.length) { t.replaceChildren(); $('tr-verdict').textContent = 'Enter an amount and at least one valid quote.'; return; }
    const head = el('tr', null, ['Provider', 'Arrives', 'Rate margin', 'True cost'].map(h => el('th', { scope: 'col', text: h })));
    const rows = ranked.map((r, i) => el('tr', { class: i === 0 ? 'best' : null }, [
      el('th', { scope: 'row', text: r.name + (i === 0 ? ' ★' : '') }),
      el('td', { text: U.fmtCNY(r.receivedCNY) }),
      el('td', { text: (r.rateMarginPct >= 0 ? '+' : '') + r.rateMarginPct + '%' }),
      el('td', { text: U.fmtIDR(r.totalCostIDR) + ' (' + r.totalCostPct + '%)' })]));
    t.replaceChildren(el('thead', null, [head]), el('tbody', null, rows));
    const best = ranked[0], worst = ranked[ranked.length - 1];
    $('tr-verdict').textContent = ranked.length > 1
      ? best.name + ' delivers ' + U.fmtCNY(U.round2(best.receivedCNY - worst.receivedCNY)) + ' more than ' + worst.name + '. At the market rate you would get ' + U.fmtCNY(best.idealCNY) + '.'
      : best.name + ' delivers ' + U.fmtCNY(best.receivedCNY) + '.';
  }

  // ------------------------------------------------------------- PRICE FEEL
  let feelItem = A.FEEL_ITEMS[0], feelCustom = null;
  function renderFeel() {
    const chips = $('feel-chips');
    if (!chips.childElementCount) {
      chips.replaceChildren(...A.FEEL_ITEMS.map(it => {
        const b = el('button', { type: 'button', class: 'chip', role: 'radio', 'data-id': it.id, text: it.label });
        b.addEventListener('click', () => { feelItem = it; feelCustom = null; $('feel-custom').value = ''; renderFeel(); });
        return b;
      }));
      $('feel-custom').addEventListener('input', e => {
        const v = A.parseNumber(e.target.value);
        feelCustom = v > 0 && v <= 100000 ? v : null;
        renderFeel();
      });
    }
    chips.querySelectorAll('.chip').forEach(b => {
      const on = !feelCustom && b.dataset.id === feelItem.id;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('on', on);
    });
    const cny = feelCustom || feelItem.cny;
    const f = A.feel(cny, feelItem, rate());
    $('feel-cny').textContent = U.fmtCNY(cny);
    $('feel-idr').textContent = '= ' + U.fmtIDR(f.idr);
    $('feel-units').textContent = '≈ ' + f.units + ' ' + feelItem.ref;
    $('feel-note').textContent = feelCustom ? 'Compared with ' + feelItem.ref + ' at ' + U.fmtIDR(feelItem.refIDR) + ' each.' : feelItem.note;
    $('feel-rate').textContent = 'Rate · ¥1 ≈ ' + U.fmtIDR(rate()) + (store.get().settings.manualRate ? ' (fixed by you)' : ' (' + fxInfo.status + ')');
  }

  // --------------------------------------------------------------- ACTIVITY
  function renderActivity() {
    const v = log.verify();
    const badge = $('chain-status');
    badge.textContent = v.ok ? 'Chain intact · ' + v.checked + ' entries verified' : 'Chain broken at entry #' + v.brokenAt;
    badge.className = 'badge ' + (v.ok ? 'ok' : 'bad');

    const tiers = A.TIERS;
    $('tier-table').replaceChildren(
      el('thead', null, [el('tr', null, ['Tier', 'Name', 'What it covers'].map(h => el('th', { scope: 'col', text: h })))]),
      el('tbody', null, Object.keys(tiers).map(k => el('tr', null, [el('th', { scope: 'row' }, [el('span', { class: 'tier t' + k, text: 'T' + k })]), el('td', { text: tiers[k].name }), el('td', { text: tiers[k].desc })]))));

    const who = $('act-filter').value;
    const rows = log.list().filter(e => !who || e.actor === who).reverse().slice(0, 300);
    $('act-table').replaceChildren(
      el('thead', null, [el('tr', null, ['#', 'Time', 'Who', 'Action', 'Tier', 'Decision', 'Detail', 'Hash'].map(h => el('th', { scope: 'col', text: h })))]),
      el('tbody', null, rows.map(e => el('tr', null, [
        el('td', { text: String(e.seq) }), el('td', { text: new Date(e.ts).toLocaleString() }), el('td', { text: e.actor }),
        el('td', { text: e.action }), el('td', null, [el('span', { class: 'tier t' + e.tier, text: 'T' + e.tier })]),
        el('td', { class: 'dec ' + e.decision, text: e.decision }), el('td', { class: 'detail', text: e.detail }),
        el('td', { class: 'hash', title: e.hash, text: e.hash.slice(0, 10) + '…' })]))));
  }

  // --------------------------------------------------------------- SETTINGS
  function renderSettings() {
    const s = store.get().settings;
    $('s-limit').value = String(s.autoLimitCNY);
    $('s-confirm').checked = s.confirmEverything;
    $('s-rate').value = s.manualRate ? String(s.manualRate) : '';
  }

  async function loadDemo() {
    const has = store.get().expenses.length;
    const ok = await confirmDialog('Load the sample month?', 'This fills the current month with realistic sample expenses so you can try every feature.',
      has ? ['It replaces your ' + has + ' current expenses.'] : ['You can delete it any time in Settings.']);
    if (!ok) return;
    const next = JSON.parse(JSON.stringify(store.get()));
    next.expenses = T.demo.sampleMonth(new Date(), rate());
    next.onboarded = true;
    store.replace(next);
    log.append('system', 'load_demo', 2, 'confirmed', next.expenses.length + ' sample expenses (sandbox account)');
    $('s-msg').textContent = 'Sample month loaded.';
  }

  // ------------------------------------------------------------------ wiring
  function wire() {
    window.addEventListener('hashchange', route);
    store.subscribe(() => renderCurrent());

    $('fx-refresh').addEventListener('click', () => loadRate(true));
    $('agent-form').addEventListener('submit', e => {
      e.preventDefault();
      const inp = $('agent-input');
      if (!inp.value.trim()) return;
      send(inp.value); inp.value = '';
    });
    $('examples').addEventListener('click', e => { if (e.target.classList.contains('chip')) send(e.target.textContent); });
    $('tip-next').addEventListener('click', () => { tipIndex++; renderTip(); });
    $('demo-btn').addEventListener('click', loadDemo);
    $('s-demo').addEventListener('click', loadDemo);

    $('fun-slider').addEventListener('input', e => { $('fun-value').textContent = U.fmtCNY(Number(e.target.value)); });
    $('fun-slider').addEventListener('change', e => {
      store.setBudget('fun', Number(e.target.value));
      log.append('user', 'set_budget', 2, 'direct', 'fun = ' + e.target.value);
    });

    $('add-form').addEventListener('submit', e => {
      e.preventDefault();
      const raw = A.parseNumber($('f-amount').value);
      const cur = $('f-currency').value === 'IDR' ? 'IDR' : 'CNY';
      const amountCNY = cur === 'IDR' ? U.round2(raw / rate()) : raw;
      const msg = $('f-msg');
      if (!U.isValidAmount(amountCNY)) { msg.textContent = 'Enter an amount between ¥0.01 and ¥100,000.'; return; }
      if (!U.isValidIsoDate($('f-date').value)) { msg.textContent = 'Pick a valid date.'; return; }
      const note = U.cleanText($('f-note').value, 80) || catLabel($('f-category').value);
      const saved = store.addExpense({ date: $('f-date').value, amountCNY, originalAmount: raw, originalCurrency: cur,
        rateUsed: cur === 'IDR' ? rate() : null, category: $('f-category').value, note, source: 'manual' });
      log.append('user', 'add_expense', 1, 'direct', U.fmtCNY(saved.amountCNY) + ' ' + saved.category + ' · id ' + saved.id.slice(0, 8));
      msg.textContent = 'Added ' + U.fmtCNY(saved.amountCNY) + '.';
      $('f-amount').value = ''; $('f-note').value = '';
    });
    $('filter-cat').addEventListener('change', renderExpenses);
    $('filter-month').addEventListener('change', renderExpenses);
    $('export-csv').addEventListener('click', () => {
      const rows = [['date', 'amount_cny', 'original_amount', 'original_currency', 'category', 'note', 'source']]
        .concat(store.get().expenses.map(e => [e.date, e.amountCNY, e.originalAmount, e.originalCurrency, e.category, e.note, e.source]));
      download('tenang-expenses.csv', rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv');
      log.append('user', 'export_csv', 0, 'info', rows.length - 1 + ' rows');
    });

    $('tr-send').addEventListener('input', computeTransfer);
    $('tr-send').addEventListener('change', () => log.append('user', 'transfer_check', 0, 'info', 'send ' + $('tr-send').value + ' IDR (simulation)'));

    $('act-filter').addEventListener('change', renderActivity);
    $('act-export').addEventListener('click', () => { download('tenang-activity-log.json', log.exportJSON()); log.append('user', 'export_log', 0, 'info', ''); });

    $('set-form').addEventListener('submit', e => {
      e.preventDefault();
      const lim = A.parseNumber($('s-limit').value);
      const rr = $('s-rate').value.trim() ? A.parseNumber($('s-rate').value) : null;
      if (rr !== null && !T.fx.isSaneRate(rr)) { $('s-rate-msg').textContent = 'Rate must be between Rp ' + T.fx.SANE_MIN + ' and Rp ' + T.fx.SANE_MAX + ' per ¥1.'; return; }
      if (!(lim >= 0 && lim <= 5000)) { $('s-rate-msg').textContent = 'Auto-add limit must be between ¥0 and ¥5,000.'; return; }
      store.setSetting('autoLimitCNY', lim);
      store.setSetting('confirmEverything', $('s-confirm').checked);
      store.setSetting('manualRate', rr);
      log.append('user', 'settings', 2, 'direct', 'limit ' + lim + ' · confirmAll ' + $('s-confirm').checked + ' · rate ' + (rr || 'live'));
      $('s-rate-msg').textContent = 'Saved.';
      renderFx();
    });
    $('s-export').addEventListener('click', () => { download('tenang-data.json', store.exportJSON()); log.append('user', 'export_data', 0, 'info', ''); });
    $('s-import').addEventListener('change', async e => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      if (f.size > 2 * 1024 * 1024) { $('s-msg').textContent = 'File is too large (max 2 MB).'; return; }
      let parsed;
      try { parsed = JSON.parse(await f.text()); } catch (err) { $('s-msg').textContent = 'That file is not valid JSON.'; return; }
      const clean = T.store.sanitizeState(parsed && parsed.state ? parsed.state : parsed);
      const ok = await confirmDialog('Import this file?', clean.expenses.length + ' valid expenses found.', ['It replaces your current data.', 'Invalid entries were removed during validation.']);
      if (!ok) { log.append('user', 'import_data', 2, 'declined', ''); return; }
      store.replace(clean);
      log.append('user', 'import_data', 2, 'confirmed', clean.expenses.length + ' expenses');
      $('s-msg').textContent = 'Imported.';
    });
    $('s-reset').addEventListener('click', async () => {
      const ok = await confirmDialog('Delete all data?', 'Your budget and all expenses will be removed from this browser.', ['This cannot be undone. Export first if you want a copy.', 'The activity log is kept as evidence.']);
      if (!ok) { log.append('user', 'reset', 2, 'declined', ''); return; }
      store.reset();
      log.append('user', 'reset', 2, 'confirmed', 'all data deleted');
      $('s-msg').textContent = 'All data deleted.';
    });
  }

  function init() {
    wire();
    chatPush('agent', 'Hi! I am Tenang. Tell me what you spent, like "lunch 14" or "es kopi Rp 22.000", or ask "how am I doing?". I can read and record, but I never move money.', { tier: 0, mode: 'auto' });
    log.append('system', 'session_start', 0, 'info', navigator.language || '');
    renderFx();
    route();
    loadRate(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.Tenang = window.Tenang || {});
