/*
 * QS CRM v3.3.0 — QS Performance (value ledger) calculations.
 * Measures the QS function against the 8 KPIs of the ARZA contract (clause 12), from the tender register,
 * the RFQs, the masterlist rate proposals and the manual value log. Month and cumulative (from the start date).
 * Pure functions: data in, figures out. Works in the browser (global Perf) and in Node (module.exports).
 * RFQ reply rate / response time reuse Procure.rfqKpis (pass it as opts.procure in Node).
 */
(function (root) {
  'use strict';

  var KPIS = [
    ['accuracy', 'Accuracy and completeness of project estimates'],
    ['timely', 'Timely submission of tenders and quotations'],
    ['competitive', 'Competitiveness and profitability of tender submissions'],
    ['savings', 'Cost savings through value engineering'],
    ['budgets', 'Accuracy of project budgets and cost forecasts'],
    ['database', 'Maintenance of updated pricing databases and cost records'],
    ['awards', 'Contribution towards successful tender awards'],
    ['compliance', 'Compliance with Company procedures and reporting requirements']
  ];
  var VALUE_KINDS = ['Value engineering accepted', 'Claim/collection received', 'Cost saving', 'Time saved', 'Other'];
  var SUBMITTED = ['Submitted', 'Won', 'Lost'];
  var DECIDED = ['Won', 'Lost'];

  function d10(x) { return x ? String(x).slice(0, 10) : ''; }
  function num(x) { if (x === null || x === undefined || x === '') return null; var n = +String(x).replace(/,/g, ''); return isFinite(n) ? n : null; }
  function sum(a, f) { return a.reduce(function (s, x) { var v = f(x); return s + (v == null ? 0 : v); }, 0); }
  function ratio(a, b) { return b ? a / b : null; }
  function median(a) {
    var v = a.filter(function (x) { return x != null && isFinite(x); }).slice().sort(function (x, y) { return x - y; });
    if (!v.length) return null; var m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function monthEnd(ym) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7); return ym + '-' + pad(new Date(Date.UTC(y, m, 0)).getUTCDate()); }
  function addMonths(ym, k) { var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + pad(m + 1); }
  function monthName(ym) { var M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']; return M[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }
  function inWin(d, w) { d = d10(d); return !!d && d >= w.from && d <= w.to; }
  // months shown in the month picker: from the start date (or the earliest record) to this month, newest first
  function months(start, today) {
    var a = [], cur = d10(today).slice(0, 7), s = (d10(start) || d10(today)).slice(0, 7);
    while (cur >= s && a.length < 120) { a.push(cur); cur = addMonths(cur, -1); }
    return a;
  }
  function windows(month, start) {
    var to = monthEnd(month), from = d10(start) || '2000-01-01';
    return { month: { from: month + '-01', to: to, label: monthName(month) }, cum: { from: from > to ? month + '-01' : from, to: to, label: (d10(start) ? 'since ' + d10(start) : 'all records') + ' to ' + to } };
  }

  // the date each tender figure is counted on
  function handledOn(t) { return d10(t.closing_date) || d10(t.submitted_date) || d10(t.created); }
  function submittedOn(t) { return d10(t.submitted_date) || d10(t.closing_date); }
  function decidedOn(t) { return d10(t.result_date) || d10(t.closing_date) || d10(t.submitted_date); }
  // own sum vs the winning sum: + = we were dearer
  function gap(t) { var o = num(t.our_sum), w = num(t.winning_sum); return o != null && w ? (o - w) / w : null; }

  function tenderPart(T, w) {
    var handled = T.filter(function (t) { return inWin(handledOn(t), w); });
    var byStatus = {}; handled.forEach(function (t) { var s = t.status || 'Not set'; byStatus[s] = (byStatus[s] || 0) + 1; });
    var sub = T.filter(function (t) { return SUBMITTED.indexOf(t.status) >= 0 && inWin(submittedOn(t), w); });
    var dec = T.filter(function (t) { return DECIDED.indexOf(t.status) >= 0 && inWin(decidedOn(t), w); });
    var won = dec.filter(function (t) { return t.status === 'Won'; }), lost = dec.filter(function (t) { return t.status === 'Lost'; });
    // on time: tenders due (closing) in the window that were submitted
    var due = T.filter(function (t) { return SUBMITTED.indexOf(t.status) >= 0 && inWin(t.closing_date, w); });
    var dated = due.filter(function (t) { return d10(t.submitted_date); });
    var late = dated.filter(function (t) { return d10(t.submitted_date) > d10(t.closing_date); });
    var gaps = dec.map(function (t) { return { t: t, g: gap(t) }; }).filter(function (x) { return x.g != null; });
    var lostGaps = gaps.filter(function (x) { return x.t.status === 'Lost'; }).map(function (x) { return x.g; });
    var rat = won.filter(function (t) { return t.contract_rev && num(t.contract_sum) != null && num(t.our_sum); })
      .map(function (t) { return { arza_no: t.arza_no, title: t.title, tendered: num(t.our_sum), contract: num(t.contract_sum), rev: t.contract_rev, diff: num(t.contract_sum) / num(t.our_sum) - 1 }; });
    return {
      handled: handled.length, byStatus: byStatus,
      submitted: sub.length, submittedValue: sum(sub, function (t) { return num(t.our_sum); }),
      decided: dec.length, won: won.length, lost: lost.length, winRate: ratio(won.length, dec.length),
      wonTendered: sum(won, function (t) { return num(t.our_sum); }),
      wonContract: sum(won, function (t) { var c = num(t.contract_sum); return c != null ? c : num(t.our_sum); }),
      wonList: won.map(function (t) { return { arza_no: t.arza_no, title: t.title, client_group: t.client_group, tendered: num(t.our_sum), contract: num(t.contract_sum), rev: t.contract_rev, date: decidedOn(t) }; }),
      due: due.length, onTime: dated.length - late.length, onTimeRate: ratio(dated.length - late.length, dated.length),
      lateList: late.map(function (t) { return { arza_no: t.arza_no, title: t.title, closing: d10(t.closing_date), submitted: d10(t.submitted_date) }; }),
      noDate: due.filter(function (t) { return !d10(t.submitted_date); }).map(function (t) { return { arza_no: t.arza_no, title: t.title, closing: d10(t.closing_date) }; }),
      gaps: gaps.map(function (x) { return { arza_no: x.t.arza_no, title: x.t.title, status: x.t.status, our: num(x.t.our_sum), winning: num(x.t.winning_sum), winner: x.t.winner, gap: x.g }; }),
      gapLostAvg: lostGaps.length ? sum(lostGaps, function (g) { return g; }) / lostGaps.length : null,
      gapAbsMedian: median(gaps.map(function (x) { return Math.abs(x.g); })),
      within5: gaps.filter(function (x) { return Math.abs(x.g) <= 0.05; }).length,
      resultsRecorded: dec.filter(function (t) { return num(t.winning_sum) != null; }).length,
      rationalized: rat, ratAvg: rat.length ? sum(rat, function (x) { return x.diff; }) / rat.length : null
    };
  }

  // procurement: awarded RFQs (by award date). Saving vs median of the quotes that pass, and vs the masterlist budget of the ML-coded lines
  function rfqPart(R, w, P) {
    var aw = R.filter(function (r) { return r.status === 'Awarded' && inWin(r.award_date, w); });
    var rows = aw.map(function (r) {
      var a = num(r.award_total_bnd), md = num(r.median_bnd), mb = num(r.ml_budget_bnd), mq = num(r.ml_quoted_bnd);
      return { rfq_no: r.rfq_no, title: r.title, award_date: d10(r.award_date), awarded: a, median: md, valid_n: r.valid_n,
        vsMedian: a != null && md != null ? md - a : null, vsMedianPct: a != null && md ? (md - a) / md : null,
        mlBudget: mb, mlQuoted: mq, mlLines: r.ml_lines, vsMl: mb != null && mq != null && r.ml_lines ? mb - mq : null, vsMlPct: mb && mq != null && r.ml_lines ? (mb - mq) / mb : null,
        missing: md == null, days: r.rfq_date && r.award_date ? Math.round((Date.parse(d10(r.award_date)) - Date.parse(d10(r.rfq_date))) / 864e5) : null };
    });
    var sent = R.filter(function (r) { return r.status !== 'Cancelled' && inWin(r.rfq_date, w); });
    var k = P && P.rfqKpis ? P.rfqKpis(sent) : null;
    var withMed = rows.filter(function (x) { return x.vsMedian != null; }), withMl = rows.filter(function (x) { return x.vsMl != null; });
    return { awarded: rows.length, rows: rows, awardedBnd: sum(rows, function (x) { return x.awarded; }),
      savingMedian: sum(withMed, function (x) { return x.vsMedian; }), savingMedianBase: sum(withMed, function (x) { return x.median; }),
      savingMl: sum(withMl, function (x) { return x.vsMl; }), mlBudget: sum(withMl, function (x) { return x.mlBudget; }), mlQuoted: sum(withMl, function (x) { return x.mlQuoted; }),
      missing: rows.filter(function (x) { return x.missing; }).map(function (x) { return x.rfq_no; }),
      rfqs: sent.length, replyRate: k ? k.replyRate : null, validRate: k ? k.validRate : null, contacted: k ? k.contacted : null,
      goalRate: k ? k.rfqSuccess : null, medianResponseHours: k ? k.medianResponseHours : null,
      medianDaysToAward: median(rows.map(function (x) { return x.days; })) };
  }

  function dbPart(D, w) {
    var pr = D.proposals || [];
    var acc = pr.filter(function (x) { return x.status === 'Accepted' && inWin(x.decided, w); });
    return { accepted: acc.length, rejected: pr.filter(function (x) { return x.status === 'Rejected' && inWin(x.decided, w); }).length,
      pending: pr.filter(function (x) { return x.status === 'Proposed'; }).length,
      quotePrices: sum((D.quote_lines || []).filter(function (x) { return inWin(x.date, w); }), function (x) { return num(x.n); }),
      suppliers: sum((D.suppliers_added || []).filter(function (x) { return inWin(x.date, w); }), function (x) { return num(x.n); }),
      codes: acc.map(function (x) { return x.res_code; }) };
  }

  function valuePart(V, w) {
    var E = (V || []).filter(function (x) { return inWin(x.entry_date, w); }), by = {};
    VALUE_KINDS.forEach(function (k) { by[k] = { n: 0, amount: 0, hours: 0, verifiedAmount: 0 }; });
    E.forEach(function (x) { var o = by[x.kind] || (by[x.kind] = { n: 0, amount: 0, hours: 0, verifiedAmount: 0 }); o.n++; o.amount += num(x.amount_bnd) || 0; o.hours += num(x.hours) || 0; if (x.verified) o.verifiedAmount += num(x.amount_bnd) || 0; });
    return { entries: E, n: E.length, by: by, verified: E.filter(function (x) { return x.verified; }).length,
      noEvidence: E.filter(function (x) { return !x.evidence; }).length,
      hours: sum(E, function (x) { return num(x.hours); }), amount: sum(E, function (x) { return num(x.amount_bnd); }),
      ve: by['Value engineering accepted'].amount, costSaving: by['Cost saving'].amount, collections: by['Claim/collection received'].amount };
  }

  // record completeness (KPI 8): share of the checks that are in order
  function compliance(t, r, v) {
    var checks = [
      ['Submitted tenders with a submission date', t.due - t.noDate.length, t.due],
      ['Decided tenders with the winning sum recorded', t.resultsRecorded, t.decided],
      ['Won tenders with a contract sum', t.wonList.filter(function (x) { return x.contract != null; }).length, t.won],
      ['Awarded RFQs with savings recorded', r.awarded - r.missing.length, r.awarded],
      ['Value-log entries with evidence', v.n - v.noEvidence, v.n],
      ['Value-log entries verified', v.verified, v.n]
    ].map(function (c) { return { label: c[0], ok: c[1], of: c[2], rate: ratio(c[1], c[2]) }; });
    var ok = sum(checks, function (c) { return c.ok; }), of = sum(checks, function (c) { return c.of; });
    return { checks: checks, rate: ratio(ok, of) };
  }

  function part(D, R, w, P) {
    var t = tenderPart(D.tenders || [], w), r = rfqPart(R || [], w, P), db = dbPart(D, w), v = valuePart(D.values, w), c = compliance(t, r, v);
    return { win: w, tenders: t, rfq: r, db: db, value: v, compliance: c,
      totals: { contractWon: t.wonContract, savings: r.savingMedian + v.ve + v.costSaving, collections: v.collections, hours: v.hours, onTimeRate: t.onTimeRate, winRate: t.winRate } };
  }

  // the report: data = crm_perf, rfqs = crm_rfqs().rfqs, opts {month 'YYYY-MM', start, procure}
  function report(data, rfqs, opts) {
    opts = opts || {}; data = data || {};
    var start = d10(opts.start != null ? opts.start : data.start_date), month = opts.month || d10(data.today).slice(0, 7);
    var P = opts.procure || (typeof root.Procure !== 'undefined' ? root.Procure : null), W = windows(month, start);
    var trend = [];
    for (var i = 5; i >= 0; i--) {
      var ym = addMonths(month, -i), x = tenderPart(data.tenders || [], { from: ym + '-01', to: monthEnd(ym) }), y = rfqPart(rfqs || [], { from: ym + '-01', to: monthEnd(ym) }, null);
      trend.push({ month: ym, submitted: x.submitted, won: x.won, decided: x.decided, winRate: x.winRate, onTimeRate: x.onTimeRate, gapLostAvg: x.gapLostAvg, wonContract: x.wonContract, rfqSaving: y.savingMedian });
    }
    return { month: month, label: W.month.label, start: start, kpis: KPIS, m: part(data, rfqs, W.month, P), c: part(data, rfqs, W.cum, P), trend: trend };
  }

  // savings of an awarded RFQ, from the scored comparison (Procure.scoreQuotes) and the masterlist budget check
  // row = the awarded row of the comparison; cmp = scoreQuotes result; bc = Procure.budgetCheck(items, res, row.L) or null
  function rfqSavings(cmp, row, bc) {
    var tot = (cmp && cmp.rows || []).filter(function (x) { return x.pass && x.L && x.L.total_bnd != null; }).map(function (x) { return x.L.total_bnd; });
    var awarded = row && row.L && row.L.total_bnd != null ? row.L.total_bnd : null;
    if (awarded == null || !tot.length) return null;
    var ml = bc && bc.priced ? bc.lines.filter(function (l) { return l.quoted != null; }) : [];
    return { total_bnd: awarded.toFixed(2), median_bnd: median(tot).toFixed(2), valid_n: tot.length,
      ml_budget_bnd: ml.length ? sum(ml, function (l) { return l.budget; }).toFixed(2) : '', ml_quoted_bnd: ml.length ? sum(ml, function (l) { return l.quoted; }).toFixed(2) : '', ml_lines: ml.length || '' };
  }

  var api = { KPIS: KPIS, VALUE_KINDS: VALUE_KINDS, report: report, part: part, tenderPart: tenderPart, rfqPart: rfqPart, dbPart: dbPart, valuePart: valuePart, compliance: compliance,
    rfqSavings: rfqSavings, months: months, windows: windows, monthEnd: monthEnd, addMonths: addMonths, monthName: monthName, median: median, gap: gap };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Perf = api;
})(this);
