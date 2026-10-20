/* Tenang — local data store.
   All data lives in this browser (localStorage). Nothing is sent to a server.
   Every value read from storage or imported from a file is re-validated. */
(function (T) {
  'use strict';
  const U = T.utils;
  const KEY = 'tenang.state.v1';

  const CATEGORIES = [
    { id: 'housing', label: 'Housing', fixed: true },
    { id: 'food', label: 'Food' },
    { id: 'transport', label: 'Transport' },
    { id: 'phone', label: 'Phone & data' },
    { id: 'fun', label: 'Fun' },
    { id: 'study', label: 'Study' },
    { id: 'other', label: 'Other' }
  ];
  const CAT_IDS = CATEGORIES.map(c => c.id);

  /** Plan options, typical Beijing student prices (same numbers as the landing page). */
  const PLAN_OPTIONS = {
    housing: [
      { id: 'dorm', label: 'University dorm', desc: 'Shared room on campus', amount: 900 },
      { id: 'shared', label: 'Shared apartment', desc: 'Your own room in a split flat', amount: 2800 },
      { id: 'studio', label: 'Studio apartment', desc: 'Living alone, near campus', amount: 5200 }
    ],
    food: [
      { id: 'canteen', label: 'Canteen loyalist', desc: 'Campus food most days', amount: 900 },
      { id: 'mixed', label: 'Half and half', desc: 'Canteen plus eating out', amount: 1500 },
      { id: 'out', label: 'Restaurant regular', desc: 'Eating out most days', amount: 2600 }
    ]
  };

  function defaultState() {
    return {
      version: 1,
      plan: { housingOption: 'dorm', foodOption: 'mixed' },
      budget: { housing: 900, food: 1500, transport: 150, phone: 50, fun: 600, study: 100, other: 200 },
      expenses: [],
      learned: {},                      // keyword -> category, learned from user corrections
      settings: { manualRate: null, autoLimitCNY: 200, confirmEverything: false },
      onboarded: false
    };
  }

  function sanitizeExpense(x) {
    if (!x || typeof x !== 'object') return null;
    const amountCNY = Number(x.amountCNY);
    if (!U.isValidAmount(amountCNY)) return null;
    if (!U.isValidIsoDate(x.date)) return null;
    const category = CAT_IDS.includes(x.category) ? x.category : 'other';
    const originalCurrency = x.originalCurrency === 'IDR' ? 'IDR' : 'CNY';
    const originalAmount = Number(x.originalAmount);
    const rateUsed = Number(x.rateUsed);
    return {
      id: typeof x.id === 'string' && /^[\w-]{1,64}$/.test(x.id) ? x.id : U.uid(),
      date: x.date,
      amountCNY: U.round2(amountCNY),
      originalAmount: Number.isFinite(originalAmount) && originalAmount > 0 ? U.round2(originalAmount) : U.round2(amountCNY),
      originalCurrency,
      rateUsed: T.fx.isSaneRate(rateUsed) ? rateUsed : null,
      category,
      note: U.cleanText(String(x.note || ''), U.LIMITS.MAX_NOTE),
      source: x.source === 'agent' ? 'agent' : 'manual',
      createdAt: typeof x.createdAt === 'string' ? x.createdAt.slice(0, 30) : new Date().toISOString()
    };
  }

  /** Validate a whole state object (from storage or an imported file). */
  function sanitizeState(raw) {
    const s = defaultState();
    if (!raw || typeof raw !== 'object') return s;
    if (raw.plan && typeof raw.plan === 'object') {
      if (PLAN_OPTIONS.housing.some(o => o.id === raw.plan.housingOption)) s.plan.housingOption = raw.plan.housingOption;
      if (PLAN_OPTIONS.food.some(o => o.id === raw.plan.foodOption)) s.plan.foodOption = raw.plan.foodOption;
    }
    if (raw.budget && typeof raw.budget === 'object') {
      CAT_IDS.forEach(c => {
        const v = Number(raw.budget[c]);
        if (Number.isFinite(v) && v >= 0 && v <= U.LIMITS.MAX_AMOUNT_CNY) s.budget[c] = U.round2(v);
      });
    }
    if (Array.isArray(raw.expenses)) {
      s.expenses = raw.expenses.slice(0, 5000).map(sanitizeExpense).filter(Boolean);
    }
    if (raw.learned && typeof raw.learned === 'object') {
      Object.keys(raw.learned).slice(0, 300).forEach(k => {
        const key = U.cleanText(k, 30).toLowerCase();
        if (key && CAT_IDS.includes(raw.learned[k])) s.learned[key] = raw.learned[k];
      });
    }
    if (raw.settings && typeof raw.settings === 'object') {
      const mr = Number(raw.settings.manualRate);
      s.settings.manualRate = raw.settings.manualRate != null && T.fx.isSaneRate(mr) ? mr : null;
      const lim = Number(raw.settings.autoLimitCNY);
      if (Number.isFinite(lim) && lim >= 0 && lim <= 5000) s.settings.autoLimitCNY = lim;
      s.settings.confirmEverything = raw.settings.confirmEverything === true;
    }
    s.onboarded = raw.onboarded === true;
    return s;
  }

  function createStore(storage) {
    let state;
    try { state = sanitizeState(JSON.parse(storage.getItem(KEY) || 'null')); }
    catch (e) { state = defaultState(); }
    const listeners = [];

    function save() {
      try { storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      listeners.forEach(fn => fn(state));
    }

    return {
      get: () => state,
      subscribe: fn => listeners.push(fn),
      save,
      replace(next) { state = sanitizeState(next); save(); },
      reset() { state = defaultState(); save(); },
      addExpense(x) {
        const e = sanitizeExpense(x);
        if (!e) throw new Error('Invalid expense');
        state.expenses.push(e);
        save();
        return e;
      },
      deleteExpense(id) {
        const i = state.expenses.findIndex(e => e.id === id);
        if (i < 0) return null;
        const [removed] = state.expenses.splice(i, 1);
        save();
        return removed;
      },
      updateExpenseCategory(id, category) {
        const e = state.expenses.find(x => x.id === id);
        if (!e || !CAT_IDS.includes(category)) return null;
        e.category = category;
        save();
        return e;
      },
      setBudget(category, amount) {
        if (!CAT_IDS.includes(category)) throw new Error('Unknown category');
        const v = Number(amount);
        if (!Number.isFinite(v) || v < 0 || v > U.LIMITS.MAX_AMOUNT_CNY) throw new Error('Invalid amount');
        state.budget[category] = U.round2(v);
        save();
      },
      setPlan(kind, optionId) {
        const opt = (PLAN_OPTIONS[kind] || []).find(o => o.id === optionId);
        if (!opt) throw new Error('Unknown option');
        if (kind === 'housing') { state.plan.housingOption = opt.id; state.budget.housing = opt.amount; }
        if (kind === 'food') { state.plan.foodOption = opt.id; state.budget.food = opt.amount; }
        save();
      },
      learn(keyword, category) {
        const k = U.cleanText(keyword, 30).toLowerCase();
        if (!k || !CAT_IDS.includes(category)) return;
        state.learned[k] = category;
        save();
      },
      setSetting(name, value) {
        const next = Object.assign({}, state, { settings: Object.assign({}, state.settings, { [name]: value }) });
        state = sanitizeState(next);
        save();
      },
      exportJSON() {
        return JSON.stringify({ app: 'Tenang', kind: 'data-export', exportedAt: new Date().toISOString(), state }, null, 2);
      }
    };
  }

  T.store = { createStore, sanitizeState, sanitizeExpense, defaultState, CATEGORIES, CAT_IDS, PLAN_OPTIONS, KEY };
})(window.Tenang = window.Tenang || {});
