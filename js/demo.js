/* Tenang — sample month for the sandbox demo (deterministic, seeded). */
(function (T) {
  'use strict';
  const U = T.utils;

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Expenses from day 1 to today of the current month. */
  function sampleMonth(today, rate) {
    const rnd = mulberry32(20261020);
    const pick = (a, b) => Math.round((a + rnd() * (b - a)) * 2) / 2;
    const out = [];
    const add = (day, amt, category, note, idr) => {
      const date = U.isoDate(new Date(today.getFullYear(), today.getMonth(), day));
      out.push({ id: U.uid(), date, amountCNY: U.round2(amt), originalAmount: idr || U.round2(amt), originalCurrency: idr ? 'IDR' : 'CNY',
        rateUsed: idr ? rate : null, category, note, source: 'manual', createdAt: new Date(today.getFullYear(), today.getMonth(), day, 12).toISOString() });
    };
    const last = today.getDate();
    for (let d = 1; d <= last; d++) {
      if (d === 1) add(d, 900, 'housing', 'Dorm rent');
      if (d === 2) add(d, 50, 'phone', '20 GB data pack');
      add(d, pick(10, 15), 'food', 'Lunch, canteen');
      if (rnd() < 0.6) add(d, pick(9, 14), 'food', 'Dinner, canteen');
      if (rnd() < 0.7) add(d, 4, 'transport', 'Metro');
      if (d % 6 === 3) add(d, pick(40, 65), 'food', 'Groceries');
      if (d % 4 === 1) add(d, 16, 'food', 'Bubble tea');
      if (d === 5) add(d, 35, 'study', 'Printing and notebook');
      if (d % 9 === 7) add(d, pick(60, 120), 'fun', 'Karaoke with classmates');
      if (d === 12) add(d, U.round2(150000 / rate), 'other', 'Shopee order from home', 150000);
      if (d === 15) add(d, 32, 'transport', 'Didi taxi');
    }
    return out;
  }

  T.demo = { sampleMonth, mulberry32 };
})(window.Tenang = window.Tenang || {});
