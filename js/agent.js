/* Tenang — the budgeting agent.
   Pipeline for every message:
     1. parse    — find intent, amount, currency, date and note in plain language
     2. classify — pick a spending category (keywords + what the user taught it)
     3. policy   — decide the permission tier: auto, confirm, or block
     4. act      — run the tool, explain the result, and write to the activity log
   The agent runs fully in the browser. It never moves money. */
(function (T) {
  'use strict';
  const U = T.utils;

  // ------------------------------------------------------------------ parsing

  /** Parse "22.000", "1.500.000", "12.50", "22,000", "1,5" into a number. */
  function parseNumber(raw) {
    let s = String(raw).replace(/\s/g, '');
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) {
      const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
      const thou = dec === '.' ? ',' : '.';
      s = s.split(thou).join('').replace(dec, '.');
    } else if (hasDot) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.split('.').join('');
    } else if (hasComma) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(',').join('') : s.replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  const CNY_MARK = /^(¥|￥|rmb|cny|yuan|元|块|kuai)$/i;
  const IDR_MARK = /^(rp\.?|idr|rupiah)$/i;
  const MONEY_RE = /(¥|￥|rmb|cny|yuan|rp\.?|idr)?\s*(\d[\d.,]*)\s*(k|rb|ribu|jt|juta|yuan|rmb|cny|元|块|kuai|rp|idr|rupiah)?(?![a-z0-9:])(?!\s*(gb|mb|kg|ml|pcs|%|x\b))/gi;

  /**
   * Find money amounts in text. Returns [{ value, currency, assumed, raw }].
   * currency: 'CNY' | 'IDR'. assumed = true when no currency marker was given.
   */
  function parseMoney(text) {
    const out = [];
    const re = new RegExp(MONEY_RE.source, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const pre = (m[1] || '').trim(), suf = (m[3] || '').trim().toLowerCase();
      let value = parseNumber(m[2].replace(/[.,]$/, ''));
      if (!Number.isFinite(value) || value <= 0) continue;
      let currency = null;
      if (CNY_MARK.test(pre) || CNY_MARK.test(suf)) currency = 'CNY';
      if (IDR_MARK.test(pre) || IDR_MARK.test(suf)) currency = 'IDR';
      if (['k', 'rb', 'ribu'].includes(suf)) { value *= 1000; currency = currency || 'IDR'; }
      if (['jt', 'juta'].includes(suf)) { value *= 1000000; currency = 'IDR'; }
      let assumed = false;
      if (!currency) { currency = value >= 10000 ? 'IDR' : 'CNY'; assumed = true; }
      out.push({ value: U.round2(value), currency, assumed, raw: m[0].trim() });
    }
    // Prefer amounts that carry an explicit currency.
    return out.sort((a, b) => Number(a.assumed) - Number(b.assumed));
  }

  /** Relative dates: today (default), yesterday / kemarin, "2 days ago". */
  function parseDate(text, today) {
    const t = text.toLowerCase();
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (/\b(yesterday|kemarin)\b/.test(t)) d.setDate(d.getDate() - 1);
    const ago = t.match(/\b(\d{1,2})\s+days?\s+ago\b/);
    if (ago) d.setDate(d.getDate() - Math.min(31, Number(ago[1])));
    return U.isoDate(d);
  }

  const FILLER = /\b(i|just|today|yesterday|kemarin|spent|spend|paid|pay|bought|buy|beli|bayar|add|for|on|at|a|an|the|my|of|days?|ago|untuk|di|buat)\b/gi;

  function extractNote(text, moneyRaw) {
    let s = text;
    if (moneyRaw) s = s.replace(moneyRaw, ' ');
    s = s.replace(/\b\d{1,2}\s+days?\s+ago\b/gi, ' ').replace(FILLER, ' ').replace(/[^\p{L}\p{N}&'\- ]/gu, ' ');
    return U.cleanText(s, U.LIMITS.MAX_NOTE);
  }

  // --------------------------------------------------------------- classifier

  /** Keyword weights per category. Multi-word keys match as phrases. */
  const KEYWORDS = {
    food: { lunch: 3, dinner: 3, breakfast: 3, canteen: 3, kantin: 3, meal: 2, food: 2, makan: 3, noodles: 2, noodle: 2, rice: 2, nasi: 2, dumplings: 2, jiaozi: 2, groceries: 3, grocery: 3, supermarket: 2, snack: 2, fruit: 2, coffee: 2, kopi: 2, latte: 2, 'bubble tea': 3, 'milk tea': 3, boba: 3, restaurant: 2, hotpot: 2, meituan: 2, eleme: 2, bakery: 2, water: 1 },
    transport: { metro: 3, subway: 3, bus: 3, taxi: 3, didi: 3, train: 3, 'high-speed': 2, gaotie: 3, bike: 2, 'shared bike': 3, ticket: 1, mrt: 3, transjakarta: 3, flight: 2, airport: 2 },
    phone: { phone: 3, data: 2, 'data pack': 3, sim: 3, pulsa: 3, 'china mobile': 3, 'china unicom': 3, internet: 2, wifi: 2, vpn: 2, topup: 1 },
    fun: { movie: 3, cinema: 3, karaoke: 3, ktv: 3, trip: 2, travel: 2, museum: 2, concert: 3, game: 2, games: 2, party: 2, bar: 2, gift: 2, 'bubble tea': 1, netflix: 2, spotify: 2 },
    study: { book: 3, books: 3, textbook: 3, print: 3, printing: 3, stationery: 3, course: 2, tuition: 3, notebook: 2, pen: 2, lab: 2, exam: 2 },
    housing: { rent: 3, dorm: 3, deposit: 2, electricity: 3, utilities: 3, 'water bill': 3, laundry: 2, kos: 3, apartment: 2 },
    other: { clothes: 2, shoes: 2, medicine: 2, pharmacy: 2, haircut: 2, toiletries: 2, shampoo: 2, taobao: 1, jd: 1 }
  };

  function tokens(text) {
    return text.toLowerCase().split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  }

  /**
   * Score each category; learned words (from user corrections) count 5x.
   * Returns { category, confidence 0..1, matched: [words] }.
   */
  function classify(text, learned) {
    const lower = ' ' + text.toLowerCase() + ' ';
    const toks = tokens(text);
    const scores = {};
    const matched = [];
    const L = learned || {};
    toks.forEach(w => {
      if (L[w]) { scores[L[w]] = (scores[L[w]] || 0) + 5; matched.push(w); }
    });
    Object.keys(KEYWORDS).forEach(cat => {
      Object.keys(KEYWORDS[cat]).forEach(k => {
        const hit = k.includes(' ') ? lower.includes(' ' + k + ' ') : toks.includes(k);
        if (hit) { scores[cat] = (scores[cat] || 0) + KEYWORDS[cat][k]; matched.push(k); }
      });
    });
    const ranked = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);
    if (!ranked.length) return { category: 'other', confidence: 0, matched: [] };
    const total = ranked.reduce((s, c) => s + scores[c], 0);
    return { category: ranked[0], confidence: U.round2(scores[ranked[0]] / total), matched: Array.from(new Set(matched)) };
  }

  // ------------------------------------------------------------------ intents

  const COMPARE_WORDS = /\b(compare|check|cheap|cheaper|cheapest|best|fee|fees|rate|cost|arrive|arrives|bandingkan|biaya)\b/i;
  const BLOCK_RULES = [
    { id: 'money-movement', re: /\b(transfer|send|kirim|wire|withdraw|tarik|remit)\b/i, unless: COMPARE_WORDS,
      why: 'Tenang never moves money. I can compare transfer options for you instead.' },
    { id: 'payment-execution', re: /\b(make|do|execute|initiate|process)\s+(a\s+)?(payment|transfer)\b/i,
      why: 'Tenang never makes payments. You stay in control of every payment.' },
    { id: 'trading', re: /\b(invest|buy|sell|trade)\s+(in\s+)?(crypto|bitcoin|btc|eth|stocks?|shares?|funds?)\b/i,
      why: 'Investment and trading are out of scope. Tenang only helps with budgeting.' },
    { id: 'credentials', re: /\b(password|pin|cvv|otp|login|log in)\b|\b(connect|link)\b.*\b(bank|alipay|wechat|card)\b/i,
      why: 'Tenang never asks for passwords or bank links. Your data stays on this device.' }
  ];

  function detectIntent(text) {
    const t = text.toLowerCase();
    for (const r of BLOCK_RULES) {
      if (r.re.test(t) && !(r.unless && r.unless.test(t))) return { intent: 'blocked', rule: r };
    }
    if (/\b(help|what can you do|bantuan)\b/.test(t)) return { intent: 'help' };
    if (/\b(transfer|remit|remittance|send money|kirim)\b/.test(t)) return { intent: 'remit_check' };
    if (/\b(undo|delete|remove|hapus|batal)\b/.test(t)) return { intent: 'delete_last' };
    if (/\bbudget\b/.test(t) && /\b(set|change|update|make|raise|lower|increase|decrease|jadi)\b/.test(t)) return { intent: 'set_budget' };
    if (/\b(afford|can i (buy|spend|get))\b/.test(t)) return { intent: 'afford' };
    if (/\b(convert|how much is|berapa|in rupiah|in rp|in idr|in yuan|in cny|to rupiah|to rp|to idr|to yuan|to cny|feel like)\b/.test(t)) return { intent: 'convert' };
    if (/\bhow much (did|have) i spen[dt]\b|\bspent on\b|\bspending on\b/.test(t)) return { intent: 'spend_query' };
    if (/\b(how am i|status|left|remaining|sisa|on track|summary|insights?|tips?|forecast|safe to spend|overview)\b/.test(t)) return { intent: 'status' };
    if (parseMoney(text).length) return { intent: 'add_expense' };
    return { intent: 'unknown' };
  }

  // ----------------------------------------------------------------- insights

  function monthExpenses(state, today) {
    const mk = U.monthKey(today);
    return state.expenses.filter(e => e.date.slice(0, 7) === mk && e.date <= U.isoDate(today));
  }

  /**
   * Budget health for the current month.
   * Projection blends the month-to-date pace with the last 7 days, so a recent
   * change in habits shows up quickly.
   */
  function computeMonth(state, today) {
    const D = U.daysInMonth(today), d = today.getDate();
    const exps = monthExpenses(state, today);
    const byCat = {};
    T.store.CAT_IDS.forEach(c => { byCat[c] = 0; });
    exps.forEach(e => { byCat[e.category] += e.amountCNY; });

    const budgetTotal = T.store.CAT_IDS.reduce((s, c) => s + state.budget[c], 0);
    const fixedBudget = state.budget.housing;
    const variableBudget = Math.max(0, budgetTotal - fixedBudget);
    const spentTotal = exps.reduce((s, e) => s + e.amountCNY, 0);
    const variableSpent = spentTotal - byCat.housing;

    const weekStart = new Date(today.getFullYear(), today.getMonth(), Math.max(1, d - 6));
    const last7 = exps.filter(e => e.date >= U.isoDate(weekStart) && e.category !== 'housing')
      .reduce((s, e) => s + e.amountCNY, 0);
    const days7 = Math.min(7, d);
    const dailyMonth = variableSpent / d;
    const dailyRecent = last7 / days7;
    const dailyPace = 0.5 * dailyMonth + 0.5 * dailyRecent;
    const projectedVariable = variableSpent + dailyPace * (D - d);
    const projectedTotal = projectedVariable + Math.max(fixedBudget, byCat.housing);

    const expectedSoFar = variableBudget * d / D;
    const paceRatio = expectedSoFar > 0 ? variableSpent / expectedSoFar : 0;
    const safeToday = Math.max(0, (variableBudget - variableSpent) / (D - d + 1));

    let status = 'on-track';
    if (projectedTotal > budgetTotal * 1.1 || spentTotal > budgetTotal) status = 'over';
    else if (projectedTotal > budgetTotal || paceRatio > 1.1) status = 'watch';

    const timePct = d / D * 100;
    const categories = T.store.CATEGORIES.map(c => {
      const b = state.budget[c.id], s = byCat[c.id];
      const usedPct = b > 0 ? s / b * 100 : (s > 0 ? 999 : 0);
      return { id: c.id, label: c.label, budget: b, spent: U.round2(s), remaining: U.round2(b - s), usedPct: Math.round(usedPct),
        ahead: !c.fixed && b > 0 && usedPct > timePct + 20 };
    });

    const todayIso = U.isoDate(today);
    const spentToday = exps.filter(e => e.date === todayIso).reduce((s, e) => s + e.amountCNY, 0);

    return {
      day: d, daysInMonth: D, timePct: Math.round(timePct),
      budgetTotal: U.round2(budgetTotal), spentTotal: U.round2(spentTotal), spentToday: U.round2(spentToday),
      variableBudget: U.round2(variableBudget), variableSpent: U.round2(variableSpent),
      projectedTotal: U.round2(projectedTotal), paceRatio: U.round2(paceRatio), safeToday: U.round2(safeToday),
      status, categories, count: exps.length
    };
  }

  /** Friendly, explainable tips derived from the numbers (each tip says why). */
  function tips(m) {
    const out = [];
    m.categories.filter(c => c.ahead).forEach(c => {
      out.push({ title: c.label + ' is running ahead', body: 'You used ' + c.usedPct + '% of your ' + c.label.toLowerCase() + ' budget, but only ' + m.timePct + '% of the month has passed.' });
    });
    const food = m.categories.find(c => c.id === 'food');
    if (food && food.ahead) out.push({ title: 'The canteen rule', body: 'A canteen meal costs ¥10 to ¥15. Two canteen days a week can bring food back on track.' });
    const fun = m.categories.find(c => c.id === 'fun');
    if (fun && fun.budget > 0 && fun.remaining > 0 && fun.usedPct >= 75) out.push({ title: 'Plan the treat', body: 'Fun money: ' + U.fmtCNY(fun.remaining) + ' left. Pick the one treat that matters most this week.' });
    if (m.status === 'on-track' && m.count > 0) out.push({ title: 'You are on track', body: 'At this pace you finish the month around ' + U.fmtCNY(m.projectedTotal) + ', inside your ' + U.fmtCNY(m.budgetTotal) + ' plan.' });
    if (m.status === 'over') out.push({ title: 'Time for a calm reset', body: 'Your projection is ' + U.fmtCNY(m.projectedTotal) + '. Keep daily spending under ' + U.fmtCNY(m.safeToday) + ' to land closer to plan.' });
    if (!out.length) out.push({ title: 'Pay like a local', body: 'Set up Alipay or WeChat Pay in your first week. Foreign card fees grow fast.' });
    return out;
  }

  // ------------------------------------------------------------ anomaly check

  const TYPICAL_MAX = { food: 80, transport: 60, phone: 120, fun: 200, study: 200, other: 200, housing: 6000 };

  /** Flag an amount that is unusual for its category (z-score on history, or a typical cap). */
  function anomaly(state, category, amountCNY) {
    const hist = state.expenses.filter(e => e.category === category).map(e => e.amountCNY);
    if (hist.length >= 5) {
      const mean = hist.reduce((s, x) => s + x, 0) / hist.length;
      const sd = Math.sqrt(hist.reduce((s, x) => s + (x - mean) ** 2, 0) / hist.length);
      const sorted = hist.slice().sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const z = sd > 0 ? (amountCNY - mean) / sd : (amountCNY > mean ? Infinity : 0);
      if (z > 2.5 && amountCNY > 2 * median) {
        return { flag: true, why: 'This is much higher than your usual ' + category + ' spending (about ' + U.fmtCNY(median) + ').' };
      }
      return { flag: false };
    }
    if (amountCNY > (TYPICAL_MAX[category] || 200)) {
      return { flag: true, why: 'This is higher than a typical student ' + category + ' expense.' };
    }
    return { flag: false };
  }

  // ------------------------------------------------------------------- policy

  /** Permission tiers. */
  const TIERS = {
    0: { name: 'Read', desc: 'Answer, convert, analyse. Runs automatically.' },
    1: { name: 'Write (small)', desc: 'Add a small, normal expense. Runs automatically, can be undone.' },
    2: { name: 'Write (sensitive)', desc: 'Large or unusual expense, delete, budget change, import, reset. Needs your confirmation.' },
    3: { name: 'Forbidden', desc: 'Move money, pay, trade, ask for credentials, link a bank. Always blocked.' }
  };

  const RATE_LIMIT = { windowMs: 60000, maxWrites: 10 };

  function createPolicy() {
    let writes = [];
    function rateLimited(now) {
      writes = writes.filter(t => now - t < RATE_LIMIT.windowMs);
      return writes.length >= RATE_LIMIT.maxWrites;
    }
    function noteWrite(now) { writes.push(now); }

    /**
     * Decide how an action may run.
     * Returns { tier, mode: 'auto' | 'confirm' | 'block', reasons: [] }.
     */
    function decide(action, ctx) {
      const now = (ctx && ctx.now) || Date.now();
      const settings = (ctx && ctx.settings) || {};
      if (action === 'blocked') return { tier: 3, mode: 'block', reasons: [ctx.why] };
      if (['help', 'status', 'convert', 'spend_query', 'afford', 'remit_check', 'unknown'].includes(action)) {
        return { tier: 0, mode: 'auto', reasons: [] };
      }
      if (rateLimited(now)) return { tier: 3, mode: 'block', reasons: ['Too many changes in one minute. Please wait a moment.'] };
      if (action === 'add_expense') {
        const reasons = [];
        if (ctx.amountCNY > settings.autoLimitCNY) reasons.push('It is above your auto-add limit of ' + U.fmtCNY(settings.autoLimitCNY) + '.');
        if (ctx.anomaly && ctx.anomaly.flag) reasons.push(ctx.anomaly.why);
        if (ctx.overBudget) reasons.push('It takes ' + ctx.overBudget + ' over budget.');
        if (ctx.currencyAssumed && ctx.amountCNY > 50) reasons.push('You did not write a currency, so I assumed ' + ctx.currencyAssumed + '.');
        if (settings.confirmEverything) reasons.push('You asked me to confirm every change.');
        return reasons.length ? { tier: 2, mode: 'confirm', reasons } : { tier: 1, mode: 'auto', reasons: [] };
      }
      // delete_last, set_budget, import, reset
      return { tier: 2, mode: 'confirm', reasons: ['This changes your saved data.'] };
    }
    return { decide, noteWrite, rateLimited };
  }

  // -------------------------------------------------------------- remittance

  /**
   * Compare what actually arrives.
   * sendIDR: rupiah you pay; feeIDR: upfront fee; rate: IDR per 1 CNY offered by the provider;
   * midRate: market IDR per 1 CNY. Returns received CNY and the true total cost.
   */
  function analyzeTransfer(q, midRate) {
    const send = Number(q.sendIDR), fee = Number(q.feeIDR) || 0, rate = Number(q.rate);
    if (!(send > 0) || fee < 0 || fee >= send || !(rate > 0) || !(midRate > 0)) return null;
    const receivedCNY = (send - fee) / rate;
    const idealCNY = send / midRate;
    const totalCostIDR = send - receivedCNY * midRate;
    return {
      name: q.name,
      receivedCNY: U.round2(receivedCNY),
      idealCNY: U.round2(idealCNY),
      rateMarginPct: U.round2((rate - midRate) / midRate * 100),
      totalCostIDR: Math.round(totalCostIDR),
      totalCostPct: U.round2(totalCostIDR / send * 100)
    };
  }

  function rankTransfers(quotes, midRate) {
    return quotes.map(q => analyzeTransfer(q, midRate)).filter(Boolean).sort((a, b) => b.receivedCNY - a.receivedCNY);
  }

  // -------------------------------------------------------------- price feel

  const FEEL_ITEMS = [
    { id: 'latte', label: 'Café latte', cny: 30, ref: 'glasses of es kopi susu', refIDR: 22000, note: 'In Beijing, café coffee is a treat, not a daily habit. Canteen coffee costs about ¥10.' },
    { id: 'metro', label: 'Metro ride', cny: 4, ref: 'TransJakarta rides', refIDR: 3500, note: 'Beijing metro fares depend on distance, from ¥3. Still one of the cheapest ways to move around.' },
    { id: 'canteen', label: 'Canteen meal', cny: 12, ref: 'plates of warung nasi goreng', refIDR: 20000, note: 'Canteen food is the best value in the city. It is the base of a calm food budget.' },
    { id: 'data', label: '20 GB data pack', cny: 50, ref: 'Telkomsel packs', refIDR: 55000, note: 'Student SIM plans often include data. Compare before you top up.' }
  ];

  function feel(cny, item, rate) {
    const idr = cny * rate;
    return { idr: Math.round(idr), units: Math.round(idr / item.refIDR * 10) / 10 };
  }

  T.agentCore = { parseNumber, parseMoney, parseDate, extractNote, classify, detectIntent, computeMonth, tips, anomaly,
    createPolicy, TIERS, RATE_LIMIT, analyzeTransfer, rankTransfers, FEEL_ITEMS, feel, KEYWORDS, BLOCK_RULES, monthExpenses };
})(window.Tenang = window.Tenang || {});
