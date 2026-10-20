/* Tenang — test cases. Open tests/index.html in a browser (no install needed). */
(function (T) {
  'use strict';
  const A = T.agentCore, U = T.utils;
  const results = [];
  const tests = [];
  const test = (name, fn) => tests.push({ name, fn });
  const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
  const memStorage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m }; };
  const TODAY = new Date(2026, 9, 20); // 20 Oct 2026

  // ---------------- parsing
  test('TC01 parseNumber handles Indonesian and English separators', () => {
    eq(A.parseNumber('22.000'), 22000); eq(A.parseNumber('1.500.000'), 1500000);
    eq(A.parseNumber('12.50'), 12.5); eq(A.parseNumber('22,000'), 22000); eq(A.parseNumber('1,5'), 1.5);
    eq(A.parseNumber('1.234,56'), 1234.56);
  });
  test('TC02 parseMoney detects currency markers', () => {
    eq(A.parseMoney('lunch ¥14')[0].currency, 'CNY');
    eq(A.parseMoney('es kopi Rp 22.000')[0], { value: 22000, currency: 'IDR', assumed: false, raw: 'Rp 22.000' });
    eq(A.parseMoney('gojek 25rb')[0].value, 25000);
    eq(A.parseMoney('laptop 8jt')[0].value, 8000000);
    eq(A.parseMoney('dinner 30 yuan')[0].currency, 'CNY');
  });
  test('TC03 parseMoney assumes a currency when none is given, and says so', () => {
    const a = A.parseMoney('lunch 14')[0]; eq([a.currency, a.assumed], ['CNY', true]);
    const b = A.parseMoney('shoes 150000')[0]; eq([b.currency, b.assumed], ['IDR', true]);
  });
  test('TC04 parseMoney ignores units like GB', () => {
    eq(A.parseMoney('data pack 20GB').length, 0);
    eq(A.parseMoney('data pack 20 GB ¥50')[0].value, 50);
  });
  test('TC05 parseDate understands yesterday and days ago', () => {
    eq(A.parseDate('taxi 35 yesterday', TODAY), '2026-10-19');
    eq(A.parseDate('book 40 3 days ago', TODAY), '2026-10-17');
    eq(A.parseDate('lunch 14', TODAY), '2026-10-20');
  });

  // ---------------- classifier
  test('TC06 classify picks the right category', () => {
    eq(A.classify('lunch canteen').category, 'food');
    eq(A.classify('didi taxi to campus').category, 'transport');
    eq(A.classify('karaoke ktv').category, 'fun');
    eq(A.classify('printing notes').category, 'study');
    eq(A.classify('zzz').category, 'other');
  });
  test('TC07 classify uses words learned from user corrections', () => {
    eq(A.classify('mixue').category, 'other');
    eq(A.classify('mixue', { mixue: 'food' }).category, 'food');
  });

  // ---------------- intents and blocking (tier 3)
  test('TC08 money movement, trading and credentials are blocked', () => {
    ['send ¥500 to my friend', 'transfer 1jt to mom', 'kirim uang 200rb', 'withdraw 300', 'buy bitcoin 100',
      'invest in stocks 500', 'my password is abc', 'connect my bank account', 'make a payment of 50']
      .forEach(t => eq(A.detectIntent(t).intent, 'blocked', t));
  });
  test('TC09 comparing transfers is allowed (read only)', () => {
    eq(A.detectIntent('compare transfer fees').intent, 'remit_check');
    eq(A.detectIntent('which transfer is cheaper').intent, 'remit_check');
  });
  test('TC10 other intents', () => {
    eq(A.detectIntent('lunch 14').intent, 'add_expense');
    eq(A.detectIntent('how am I doing?').intent, 'status');
    eq(A.detectIntent('can I afford ¥300 shoes?').intent, 'afford');
    eq(A.detectIntent('how much is ¥30?').intent, 'convert');
    eq(A.detectIntent('how much did I spend on food this week?').intent, 'spend_query');
    eq(A.detectIntent('set food budget to 1200').intent, 'set_budget');
    eq(A.detectIntent('undo').intent, 'delete_last');
  });

  // ---------------- policy
  test('TC11 policy: small normal expense is tier 1 auto', () => {
    const p = A.createPolicy();
    eq(p.decide('add_expense', { amountCNY: 14, anomaly: { flag: false }, settings: { autoLimitCNY: 200 } }).mode, 'auto');
  });
  test('TC12 policy: large, unusual or over-budget expense needs confirmation', () => {
    const p = A.createPolicy(), s = { autoLimitCNY: 200 };
    const d1 = p.decide('add_expense', { amountCNY: 900, anomaly: { flag: false }, settings: s });
    eq([d1.tier, d1.mode], [2, 'confirm']);
    eq(p.decide('add_expense', { amountCNY: 50, anomaly: { flag: true, why: 'x' }, settings: s }).mode, 'confirm');
    eq(p.decide('add_expense', { amountCNY: 50, anomaly: { flag: false }, overBudget: '¥10 of food', settings: s }).mode, 'confirm');
    eq(p.decide('add_expense', { amountCNY: 5, anomaly: { flag: false }, settings: { autoLimitCNY: 200, confirmEverything: true } }).mode, 'confirm');
  });
  test('TC13 policy: rate limit blocks more than 10 writes per minute', () => {
    const p = A.createPolicy(), now = Date.now();
    for (let i = 0; i < 10; i++) p.noteWrite(now);
    eq(p.decide('add_expense', { amountCNY: 5, anomaly: { flag: false }, settings: { autoLimitCNY: 200 }, now }).mode, 'block');
    eq(p.decide('add_expense', { amountCNY: 5, anomaly: { flag: false }, settings: { autoLimitCNY: 200 }, now: now + 61000 }).mode, 'auto');
  });

  // ---------------- insights
  function stateWith(expenses) {
    const s = T.store.defaultState();
    s.expenses = expenses.map(e => T.store.sanitizeExpense(Object.assign({ originalCurrency: 'CNY', note: 'x' }, e)));
    return s;
  }
  test('TC14 computeMonth: totals, safe-to-spend and status', () => {
    const s = stateWith([{ date: '2026-10-01', amountCNY: 900, category: 'housing' }, { date: '2026-10-20', amountCNY: 20, category: 'food' }]);
    const m = A.computeMonth(s, TODAY);
    eq(m.budgetTotal, 3500); eq(m.spentTotal, 920); eq(m.spentToday, 20);
    // variable budget 2600, spent 20, 12 days left (incl. today) -> (2600-20)/12 = 215
    eq(m.safeToday, 215); eq(m.status, 'on-track');
  });
  test('TC15 computeMonth: overspending is detected', () => {
    const ex = [];
    for (let d = 1; d <= 20; d++) ex.push({ date: '2026-10-' + String(d).padStart(2, '0'), amountCNY: 200, category: 'food' });
    const m = A.computeMonth(stateWith(ex), TODAY);
    eq(m.status, 'over');
    ok(m.categories.find(c => c.id === 'food').ahead, 'food should be flagged ahead');
  });
  test('TC16 anomaly: z-score on history', () => {
    const ex = [12, 14, 13, 15, 11, 12, 14].map((a, i) => ({ date: '2026-10-0' + (i + 1), amountCNY: a, category: 'food' }));
    const s = stateWith(ex);
    eq(A.anomaly(s, 'food', 14).flag, false);
    eq(A.anomaly(s, 'food', 120).flag, true);
  });

  // ---------------- remittance
  test('TC17 analyzeTransfer computes what arrives and the true cost', () => {
    const r = A.analyzeTransfer({ name: 'A', sendIDR: 5000000, feeIDR: 50000, rate: 2300 }, 2250);
    eq(r.receivedCNY, 2152.17);           // (5,000,000 - 50,000) / 2300
    eq(r.idealCNY, 2222.22);              // 5,000,000 / 2250
    eq(r.rateMarginPct, 2.22);
    eq(r.totalCostIDR, 157609);
  });
  test('TC18 rankTransfers puts the provider that delivers most first; rejects bad input', () => {
    const list = A.rankTransfers([
      { name: 'Zero fee', sendIDR: 5e6, feeIDR: 0, rate: 2340 },
      { name: 'App', sendIDR: 5e6, feeIDR: 35000, rate: 2273 },
      { name: 'Bad', sendIDR: 5e6, feeIDR: 6e6, rate: 2300 }], 2250);
    eq(list.map(x => x.name), ['App', 'Zero fee']);
  });

  // ---------------- FX engine
  test('TC19 fx: median of valid sources, outliers rejected', async () => {
    const payloads = {
      'open.er-api.com': { result: 'success', rates: { IDR: 2300 } },
      'api.frankfurter.dev': { rates: { IDR: 2310 } },
      'cdn.jsdelivr.net': { cny: { idr: 99999 } }            // insane -> rejected
    };
    const fetchImpl = async url => ({ ok: true, json: async () => payloads[new URL(url).host] });
    const r = await T.fx.getRate({ fetchImpl, storage: memStorage(), force: true, now: 1 });
    eq([r.rate, r.status, r.sources.length], [2305, 'live', 2]);
  });
  test('TC20 fx: warns when sources disagree by more than 2%', async () => {
    const payloads = { 'open.er-api.com': { result: 'success', rates: { IDR: 2200 } }, 'api.frankfurter.dev': { rates: { IDR: 2400 } }, 'cdn.jsdelivr.net': { cny: { idr: 2300 } } };
    const fetchImpl = async url => ({ ok: true, json: async () => payloads[new URL(url).host] });
    const r = await T.fx.getRate({ fetchImpl, storage: memStorage(), force: true });
    eq([r.rate, r.disagree], [2300, true]);
  });
  test('TC21 fx: offline -> cached -> fallback', async () => {
    const st = memStorage();
    const down = async () => { throw new Error('offline'); };
    eq((await T.fx.getRate({ fetchImpl: down, storage: st, force: true })).status, 'fallback');
    st.setItem(T.fx.CACHE_KEY, JSON.stringify({ rate: 2280, fetchedAt: 0, sources: ['x'] }));
    const r = await T.fx.getRate({ fetchImpl: down, storage: st, now: T.fx.TTL_MS * 10 });
    eq([r.rate, r.status], [2280, 'stale']);
    const fresh = await T.fx.getRate({ fetchImpl: down, storage: st, now: 1000 });
    eq(fresh.status, 'cached');
  });

  // ---------------- audit
  test('TC22 sha256 matches the standard test vector', () => {
    eq(T.audit.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test('TC23 audit chain detects tampering', () => {
    const st = memStorage(), log = T.audit.createLog(st);
    log.append('user', 'add_expense', 1, 'auto', 'a'); log.append('agent', 'status', 0, 'auto', 'b'); log.append('user', 'reset', 2, 'confirmed', 'c');
    eq(log.verify().ok, true);
    const raw = JSON.parse(st.getItem(T.audit.KEY)); raw[1].detail = 'edited';
    st.setItem(T.audit.KEY, JSON.stringify(raw));
    const v = T.audit.createLog(st).verify();
    eq([v.ok, v.brokenAt], [false, 2]);
  });

  // ---------------- store validation
  test('TC24 store rejects invalid data and keeps text inert', () => {
    const s = T.store.sanitizeState({
      expenses: [
        { date: '2026-10-01', amountCNY: 12, category: 'food', note: '<img src=x onerror=alert(1)>' },
        { date: '2026-13-40', amountCNY: 12, category: 'food' },
        { date: '2026-10-01', amountCNY: -5, category: 'food' },
        { date: '2026-10-01', amountCNY: 1e9, category: 'food' },
        { date: '2026-10-01', amountCNY: 3, category: 'hack' }],
      settings: { manualRate: 99999, autoLimitCNY: 'abc' }, budget: { food: -1 }
    });
    eq(s.expenses.length, 2);
    eq(s.expenses[0].note, '<img src=x onerror=alert(1)>');   // stored as plain text, rendered with textContent
    eq(s.expenses[1].category, 'other');
    eq([s.settings.manualRate, s.settings.autoLimitCNY, s.budget.food], [null, 200, 1500]);
  });

  // ---------------- agent end to end
  function makeAgent() {
    const st = memStorage();
    const store = T.store.createStore(st), log = T.audit.createLog(st);
    const agent = T.agent.createAgent({ store, audit: log, getRate: () => 2250, now: () => TODAY });
    return { store, log, agent };
  }
  test('TC25 agent adds a small expense automatically (tier 1) and logs it', () => {
    const { store, log, agent } = makeAgent();
    const r = agent.handle('lunch canteen 14');
    eq([r.tier, r.mode], [1, 'auto']);
    eq(store.get().expenses.length, 1);
    eq(store.get().expenses[0].category, 'food');
    ok(log.list().some(e => e.action === 'add_expense' && e.decision === 'auto'));
  });
  test('TC26 agent converts rupiah input to yuan', () => {
    const { store, agent } = makeAgent();
    agent.handle('es kopi Rp 22.500');
    eq(store.get().expenses[0].amountCNY, 10);
  });
  test('TC27 agent asks before a large expense; nothing is saved until confirmed', () => {
    const { store, agent } = makeAgent();
    const r = agent.handle('rent 900');
    eq([r.tier, r.mode], [2, 'confirm']);
    eq(store.get().expenses.length, 0);
    agent.resolve(r.pending.id, true);
    eq(store.get().expenses.length, 1);
  });
  test('TC28 declined confirmation changes nothing; pending ids are single-use', () => {
    const { store, agent } = makeAgent();
    const r = agent.handle('set food budget to 1200');
    agent.resolve(r.pending.id, false);
    eq(store.get().budget.food, 1500);
    eq(agent.resolve(r.pending.id, true).reply, 'That request expired. Please ask again.');
    eq(store.get().budget.food, 1500);
  });
  test('TC29 agent blocks money movement (tier 3) and logs the block', () => {
    const { store, log, agent } = makeAgent();
    const r = agent.handle('send ¥500 to my friend');
    eq([r.tier, r.mode], [3, 'block']);
    eq(store.get().expenses.length, 0);
    ok(log.list().some(e => e.decision === 'blocked'));
  });
  test('TC30 agent rejects impossible amounts', () => {
    const { store, agent } = makeAgent();
    agent.handle('lunch 0');
    agent.handle('car 999999 yuan');
    eq(store.get().expenses.length, 0);
  });

  async function run() {
    for (const t of tests) {
      try { await t.fn(); results.push({ name: t.name, pass: true }); }
      catch (e) { results.push({ name: t.name, pass: false, err: e.message }); }
    }
    const passed = results.filter(r => r.pass).length;
    const out = document.getElementById('results');
    document.getElementById('summary').textContent = passed + ' / ' + results.length + ' tests passed';
    document.getElementById('summary').className = passed === results.length ? 'pass' : 'fail';
    results.forEach(r => {
      const li = document.createElement('li');
      li.className = r.pass ? 'pass' : 'fail';
      li.textContent = (r.pass ? '✔ ' : '✘ ') + r.name + (r.err ? ' — ' + r.err : '');
      out.append(li);
    });
    window.__TEST_RESULTS__ = results;
  }
  run();
})(window.Tenang);
