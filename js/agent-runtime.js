/* Tenang — agent runtime: turns a message into a safe, explained action.
   Uses agentCore (parse/classify/policy) + store (data) + audit (evidence). */
(function (T) {
  'use strict';
  const U = T.utils, A = T.agentCore;

  /**
   * deps: { store, audit, getRate: () => number (IDR per CNY), now: () => Date }
   * handle(text) -> { reply, tier, mode, reasons?, pending?, card? }
   * resolve(pendingId, approve) -> { reply }
   */
  function createAgent(deps) {
    const policy = A.createPolicy();
    const pendings = new Map();
    const now = deps.now || (() => new Date());

    function log(actor, action, tier, decision, detail) { deps.audit.append(actor, action, tier, decision, detail); }

    function catLabel(id) { const c = T.store.CATEGORIES.find(x => x.id === id); return c ? c.label : id; }

    function toCNY(m, rate) { return m.currency === 'CNY' ? m.value : m.value / rate; }

    function block(rule, text) {
      log('agent', 'blocked:' + rule.id, 3, 'blocked', text);
      return { reply: rule.why, tier: 3, mode: 'block', reasons: [rule.why] };
    }

    function propose(action, payload, reasons, summary, tier) {
      const id = U.uid();
      pendings.set(id, { action, payload, created: Date.now() });
      log('agent', action, tier, 'proposed', summary);
      return { reply: summary, tier, mode: 'confirm', reasons, pending: { id, summary } };
    }

    // ---- tool: add expense
    function addExpense(text) {
      const today = now();
      const rate = deps.getRate();
      const clean = text.replace(/\b\d{1,2}\s+days?\s+ago\b/gi, ' ');
      const money = A.parseMoney(clean)[0];
      if (!money) return { reply: 'I could not find an amount. Try "lunch 14" or "es kopi Rp 22.000".', tier: 0, mode: 'auto' };
      const amountCNY = U.round2(toCNY(money, rate));
      if (!U.isValidAmount(amountCNY)) {
        log('agent', 'add_expense', 1, 'rejected', 'invalid amount ' + money.raw);
        return { reply: 'That amount looks wrong. Amounts must be between ¥0.01 and ¥100,000.', tier: 1, mode: 'block' };
      }
      const note = A.extractNote(clean, money.raw);
      const cls = A.classify(note || text, deps.store.get().learned);
      const date = A.parseDate(text, today);
      const state = deps.store.get();
      const m = A.computeMonth(state, today);
      const cat = m.categories.find(c => c.id === cls.category);
      const overBudget = cat && cat.budget > 0 && amountCNY > Math.max(0, cat.remaining) && date.slice(0, 7) === U.monthKey(today)
        ? U.fmtCNY(amountCNY - Math.max(0, cat.remaining)) + ' of ' + cat.label.toLowerCase() : null;
      const an = A.anomaly(state, cls.category, amountCNY);
      const decision = policy.decide('add_expense', {
        amountCNY, anomaly: an, overBudget, settings: state.settings,
        currencyAssumed: money.assumed ? (money.currency === 'CNY' ? 'yuan' : 'rupiah') : null
      });
      if (decision.mode === 'block') { log('agent', 'add_expense', 3, 'blocked', decision.reasons[0]); return { reply: decision.reasons[0], tier: 3, mode: 'block' }; }

      const expense = {
        date, amountCNY, originalAmount: money.value, originalCurrency: money.currency,
        rateUsed: money.currency === 'IDR' ? rate : null,
        category: cls.category, note: note || catLabel(cls.category), source: 'agent'
      };
      const summary = 'Add ' + U.fmtCNY(amountCNY) + (money.currency === 'IDR' ? ' (' + U.fmtIDR(money.value) + ')' : ' (≈ ' + U.fmtIDR(amountCNY * rate) + ')') +
        ' · ' + catLabel(cls.category) + ' · "' + expense.note + '"' + (date !== U.isoDate(today) ? ' · ' + date : '');

      if (decision.mode === 'confirm') return propose('add_expense', expense, decision.reasons, summary, 2);

      policy.noteWrite(Date.now());
      const saved = deps.store.addExpense(expense);
      log('agent', 'add_expense', 1, 'auto', summary + ' · id ' + saved.id.slice(0, 8));
      const after = A.computeMonth(deps.store.get(), today);
      const why = cls.matched.length ? 'Category from: ' + cls.matched.slice(0, 3).join(', ') + '.' : 'No keyword matched, so I used Other. Tap the category to change it.';
      return {
        reply: 'Added ' + U.fmtCNY(amountCNY) + ' to ' + catLabel(cls.category) + '. ' + why + ' Safe to spend today: ' + U.fmtCNY(after.safeToday) + '.',
        tier: 1, mode: 'auto', added: saved
      };
    }

    // ---- tool: status / insights
    function status() {
      const m = A.computeMonth(deps.store.get(), now());
      const label = { 'on-track': 'You are on track.', watch: 'Watch your pace a little.', over: 'You are heading over budget.' }[m.status];
      const t = A.tips(m)[0];
      log('agent', 'status', 0, 'auto', m.status + ' · projected ' + m.projectedTotal);
      return {
        reply: label + ' Spent ' + U.fmtCNY(m.spentTotal) + ' of ' + U.fmtCNY(m.budgetTotal) + ' this month. Projected end of month: ' +
          U.fmtCNY(m.projectedTotal) + '. Safe to spend today: ' + U.fmtCNY(m.safeToday) + '. Tip: ' + t.title + ' — ' + t.body,
        tier: 0, mode: 'auto'
      };
    }

    // ---- tool: convert
    function convert(text) {
      const rate = deps.getRate();
      const money = A.parseMoney(text)[0];
      if (!money) return { reply: 'Tell me an amount, like "how much is ¥30" or "Rp 100.000 in yuan".', tier: 0, mode: 'auto' };
      log('agent', 'convert', 0, 'auto', money.raw);
      if (money.currency === 'CNY') {
        const idr = money.value * rate;
        const kopi = Math.round(idr / 22000 * 10) / 10;
        return { reply: U.fmtCNY(money.value) + ' ≈ ' + U.fmtIDR(idr) + '. That feels like ' + kopi + ' glasses of es kopi susu. Rate: ¥1 ≈ ' + U.fmtIDR(rate) + '.', tier: 0, mode: 'auto' };
      }
      return { reply: U.fmtIDR(money.value) + ' ≈ ' + U.fmtCNY(U.round2(money.value / rate)) + '. Rate: ¥1 ≈ ' + U.fmtIDR(rate) + '.', tier: 0, mode: 'auto' };
    }

    // ---- tool: spend query
    function spendQuery(text) {
      const today = now();
      const t = text.toLowerCase();
      const cat = T.store.CATEGORIES.find(c => t.includes(c.id) || t.includes(c.label.toLowerCase())) ||
        (A.classify(text, deps.store.get().learned).confidence > 0 ? T.store.CATEGORIES.find(c => c.id === A.classify(text, deps.store.get().learned).category) : null);
      let from = U.isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), period = 'this month';
      if (/\btoday\b/.test(t)) { from = U.isoDate(today); period = 'today'; }
      else if (/\b(this week|week)\b/.test(t)) { from = U.isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)); period = 'in the last 7 days'; }
      const list = deps.store.get().expenses.filter(e => e.date >= from && e.date <= U.isoDate(today) && (!cat || e.category === cat.id));
      const sum = list.reduce((s, e) => s + e.amountCNY, 0);
      log('agent', 'spend_query', 0, 'auto', (cat ? cat.id : 'all') + ' ' + period);
      return { reply: 'You spent ' + U.fmtCNY(U.round2(sum)) + (cat ? ' on ' + cat.label.toLowerCase() : ' in total') + ' ' + period + ', across ' + list.length + ' expenses.', tier: 0, mode: 'auto' };
    }

    // ---- tool: afford
    function afford(text) {
      const rate = deps.getRate();
      const money = A.parseMoney(text)[0];
      if (!money) return { reply: 'Tell me the price, like "can I afford ¥300 shoes?"', tier: 0, mode: 'auto' };
      const amt = toCNY(money, rate);
      const m = A.computeMonth(deps.store.get(), now());
      const left = m.variableBudget - m.variableSpent;
      log('agent', 'afford', 0, 'auto', money.raw);
      let verdict;
      if (amt <= m.safeToday) verdict = 'Yes. It fits inside today\'s safe-to-spend of ' + U.fmtCNY(m.safeToday) + '.';
      else if (amt <= left) verdict = 'It fits this month, but it is more than today\'s ' + U.fmtCNY(m.safeToday) + '. After it, you have ' + U.fmtCNY(U.round2(left - amt)) + ' left for ' + (m.daysInMonth - m.day + 1) + ' days.';
      else verdict = 'Not this month. You have ' + U.fmtCNY(U.round2(Math.max(0, left))) + ' of flexible budget left. Could it wait until next month?';
      return { reply: verdict, tier: 0, mode: 'auto' };
    }

    // ---- tool: set budget (confirm)
    function setBudget(text) {
      const t = text.toLowerCase();
      const cat = T.store.CATEGORIES.find(c => t.includes(c.id) || t.includes(c.label.toLowerCase()));
      const money = A.parseMoney(text)[0];
      if (!cat || !money) return { reply: 'Say which budget and the new amount, like "set food budget to ¥1,200".', tier: 0, mode: 'auto' };
      const amt = U.round2(toCNY(money, deps.getRate()));
      if (!(amt >= 0 && amt <= U.LIMITS.MAX_AMOUNT_CNY)) return { reply: 'That amount looks wrong.', tier: 2, mode: 'block' };
      return propose('set_budget', { category: cat.id, amount: amt }, ['This changes your saved plan.'],
        'Change ' + cat.label + ' budget from ' + U.fmtCNY(deps.store.get().budget[cat.id]) + ' to ' + U.fmtCNY(amt) + ' per month', 2);
    }

    // ---- tool: delete last (confirm)
    function deleteLast() {
      const list = deps.store.get().expenses.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      const last = list[0];
      if (!last) return { reply: 'There is nothing to delete yet.', tier: 0, mode: 'auto' };
      return propose('delete_expense', { id: last.id }, ['Deleting cannot be undone.'],
        'Delete ' + U.fmtCNY(last.amountCNY) + ' · ' + catLabel(last.category) + ' · "' + last.note + '" (' + last.date + ')', 2);
    }

    function help() {
      return {
        reply: 'Try: "lunch 14", "es kopi Rp 22.000", "taxi 35 yesterday", "how am I doing?", "how much did I spend on food this week?", ' +
          '"can I afford ¥300 shoes?", "how much is ¥30?", "set food budget to 1200", "undo", or "compare transfer fees". I never move money.',
        tier: 0, mode: 'auto'
      };
    }

    function handle(rawText) {
      const text = U.cleanText(rawText, 200);
      if (!text) return { reply: 'Type an expense or a question.', tier: 0, mode: 'auto' };
      log('user', 'message', 0, 'info', text);
      const intent = A.detectIntent(text);
      switch (intent.intent) {
        case 'blocked': return block(intent.rule, text);
        case 'help': return help();
        case 'remit_check':
          log('agent', 'remit_check', 0, 'auto', 'opened transfer checker');
          return { reply: 'I opened the transfer checker. Enter the quotes you got and I will show which one delivers the most yuan. I compare only; I never send money.', tier: 0, mode: 'auto', navigate: 'transfer' };
        case 'delete_last': return deleteLast();
        case 'set_budget': return setBudget(text);
        case 'afford': return afford(text);
        case 'convert': return convert(text);
        case 'spend_query': return spendQuery(text);
        case 'status': return status();
        case 'add_expense': return addExpense(text);
        default:
          log('agent', 'unknown', 0, 'auto', text);
          return { reply: 'I did not catch that. ' + help().reply, tier: 0, mode: 'auto' };
      }
    }

    /** Approve or decline a pending sensitive action. Pending actions expire after 5 minutes. */
    function resolve(id, approve) {
      const p = pendings.get(id);
      if (!p) return { reply: 'That request expired. Please ask again.' };
      pendings.delete(id);
      if (Date.now() - p.created > 5 * 60 * 1000) { log('user', p.action, 2, 'expired', ''); return { reply: 'That request expired. Please ask again.' }; }
      if (!approve) { log('user', p.action, 2, 'declined', ''); return { reply: 'Okay, nothing changed.' }; }
      policy.noteWrite(Date.now());
      if (p.action === 'add_expense') {
        const saved = deps.store.addExpense(p.payload);
        log('user', 'add_expense', 2, 'confirmed', U.fmtCNY(saved.amountCNY) + ' ' + saved.category + ' · id ' + saved.id.slice(0, 8));
        return { reply: 'Saved ' + U.fmtCNY(saved.amountCNY) + ' to ' + catLabel(saved.category) + '.' };
      }
      if (p.action === 'set_budget') {
        deps.store.setBudget(p.payload.category, p.payload.amount);
        log('user', 'set_budget', 2, 'confirmed', p.payload.category + ' = ' + p.payload.amount);
        return { reply: catLabel(p.payload.category) + ' budget is now ' + U.fmtCNY(p.payload.amount) + '.' };
      }
      if (p.action === 'delete_expense') {
        const r = deps.store.deleteExpense(p.payload.id);
        log('user', 'delete_expense', 2, 'confirmed', r ? U.fmtCNY(r.amountCNY) + ' ' + r.category : 'not found');
        return { reply: r ? 'Deleted.' : 'That expense was already gone.' };
      }
      return { reply: 'Nothing changed.' };
    }

    return { handle, resolve, policy, _pendings: pendings };
  }

  T.agent = { createAgent };
})(window.Tenang = window.Tenang || {});
