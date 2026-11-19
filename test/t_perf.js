// v3.3.0 QS Performance calculations (src/perf.js) — synthetic data only. node test/t_perf.js
const fs = require('fs'), path = require('path');
const Perf = require('../src/perf.js'), P = require('../src/procure-std.js');
let pass = 0, fail = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL', m, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } };
const near = (a, b, m) => eq(a == null ? a : Math.round(a * 10000) / 10000, b, m);

const D = {
  start_date: '2026-10-01', today: '2026-11-19',
  tenders: [
    { arza_no: 'T1', title: 'Road', status: 'Won', closing_date: '2026-10-05', submitted_date: '2026-10-05', result_date: '2026-11-03', our_sum: 100000, winning_sum: 100000, contract_sum: 95000, contract_rev: 'R1' },
    { arza_no: 'T2', title: 'School', status: 'Lost', closing_date: '2026-10-20', submitted_date: '2026-10-21', result_date: '2026-11-10', our_sum: 220000, winning_sum: 200000, winner: 'X Sdn Bhd' },
    { arza_no: 'T3', title: 'Drain', status: 'Submitted', closing_date: '2026-11-04', submitted_date: '2026-11-03', our_sum: 50000 },
    { arza_no: 'T4', title: 'Clinic', status: 'Submitted', closing_date: '2026-11-12', our_sum: 80000 },
    { arza_no: 'T5', title: 'Hall', status: 'Pricing', closing_date: '2026-11-25', our_sum: 40000 },
    { arza_no: 'T6', title: 'Old', status: 'Won', closing_date: '2026-08-01', submitted_date: '2026-08-01', result_date: '2026-09-01', our_sum: 999999 },
    { arza_no: 'T7', title: 'Fence', status: 'Lost', closing_date: '2026-11-02', submitted_date: '2026-11-02', result_date: '2026-11-15', our_sum: 10300, winning_sum: 10000 },
    { arza_no: 'T8', title: 'Pump', status: 'Won', closing_date: '2026-11-01', submitted_date: '2026-11-01', result_date: '2026-11-18', our_sum: 30000 },
    { arza_no: 'T9', title: '', status: '', created: '2026-11-02' }
  ],
  proposals: [{ status: 'Accepted', decided: '2026-11-05', res_code: 'M09' }, { status: 'Accepted', decided: '2026-10-05', res_code: 'M04' }, { status: 'Rejected', decided: '2026-11-06' }, { status: 'Proposed' }],
  quote_lines: [{ date: '2026-11-02', n: 6 }, { date: '2026-10-30', n: 4 }],
  suppliers_added: [{ date: '2026-11-01', n: 40 }],
  values: [
    { entry_date: '2026-11-10', kind: 'Value engineering accepted', amount_bnd: 11000, verified: true, evidence: 'https://x' },
    { entry_date: '2026-11-12', kind: 'Time saved', hours: 6.5, verified: false, evidence: '' },
    { entry_date: '2026-10-15', kind: 'Claim/collection received', amount_bnd: 250000, verified: true, evidence: 'https://y' },
    { entry_date: '2026-11-14', kind: 'Cost saving', amount_bnd: 1200.5, hours: 2, verified: false, evidence: 'https://z' }
  ]
};
const R = [
  { rfq_no: 'RFQ-2611-001', status: 'Awarded', rfq_date: '2026-11-02', award_date: '2026-11-09', award_total_bnd: 1402, median_bnd: 1550.25, valid_n: 3, ml_budget_bnd: 1500, ml_quoted_bnd: 1380.5, ml_lines: 2,
    recipients: [{ supplier_id: 'A', status: 'Quoted', valid_quote: true, emailed_at: '2026-11-02 09:00', replied_at: '2026-11-02 13:00' }, { supplier_id: 'B', status: 'No reply', emailed_at: '2026-11-02 09:00' }] },
  { rfq_no: 'RFQ-2611-002', status: 'Awarded', rfq_date: '2026-11-03', award_date: '2026-11-13', award_total_bnd: 800, recipients: [] },
  { rfq_no: 'RFQ-2610-001', status: 'Awarded', rfq_date: '2026-10-10', award_date: '2026-10-20', award_total_bnd: 500, median_bnd: 450, valid_n: 2, recipients: [] }
];

eq(Perf.windows('2026-11', '2026-10-01'), { month: { from: '2026-11-01', to: '2026-11-30', label: 'November 2026' }, cum: { from: '2026-10-01', to: '2026-11-30', label: 'since 2026-10-01 to 2026-11-30' } }, 'month + cumulative windows');
eq(Perf.windows('2026-02', '').month.to, '2026-02-28', 'month end');
eq(Perf.months('2026-10-01', '2026-11-19'), ['2026-11', '2026-10'], 'months from the start date');
eq([Perf.addMonths('2026-01', -1), Perf.addMonths('2026-11', 2)], ['2025-12', '2027-01'], 'add months across years');
eq([Perf.median([3, 1, 2]), Perf.median([4, 1, 3, 2]), Perf.median([])], [2, 2.5, null], 'median');

const K = Perf.report(D, R, { month: '2026-11', procure: P });
const m = K.m.tenders, c = K.c.tenders;
eq([m.handled, m.byStatus], [6, { Submitted: 2, Pricing: 1, Lost: 1, Won: 1, 'Not set': 1 }], 'tenders handled in the month by status (closing date, else created)');
eq([m.submitted, m.submittedValue, c.submitted, c.submittedValue], [4, 170300, 6, 490300], 'submitted count + value (month: T3 T4 T7 T8; cumulative adds T1 T2; T6 before the start date left out)');
eq([m.decided, m.won, m.lost, m.winRate, c.decided, c.won, c.winRate], [4, 2, 2, 0.5, 4, 2, 0.5], 'decided by result date; win rate = won ÷ decided');
eq([m.wonContract, m.wonTendered], [125000, 130000], 'contract value won uses the approved contract sum (T1 R1 95,000) else our sum');
eq([m.due, m.onTime, m.onTimeRate, m.noDate.map(x => x.arza_no)], [4, 3, 1, ['T4']], 'on time: due in the month, submitted date ≤ closing; T4 has no date');
eq([c.due, c.onTime, c.lateList.map(x => x.arza_no)], [6, 4, ['T2']], 'cumulative: T2 submitted a day late');
near(c.onTimeRate, 0.8, 'on-time rate 4 of 5 dated');
eq(m.gaps.map(x => [x.arza_no, Math.round(x.gap * 1000) / 1000]), [['T1', 0], ['T2', 0.1], ['T7', 0.03]], 'bid gap vs winning sum (+ = dearer)');
near(m.gapLostAvg, 0.065, 'average gap on lost bids');
eq([m.within5, m.resultsRecorded], [2, 3], 'bids within 5% of the winner; results recorded');
eq(m.rationalized.map(x => [x.arza_no, Math.round(x.diff * 100) / 100]), [['T1', -0.05]], 'tendered vs rationalized contract');

const r = K.m.rfq;
eq([r.awarded, r.awardedBnd, r.missing], [2, 2202, ['RFQ-2611-002']], 'awarded RFQs in the month; one without savings data');
near(r.savingMedian, 148.25, 'saving vs median of valid quotes');
near(r.savingMl, 119.5, 'saving vs masterlist budget (ML lines)');
eq([r.rows[0].days, r.medianDaysToAward], [7, 8.5], 'cycle time RFQ date → award');
eq([r.rfqs, r.contacted, r.replyRate], [2, 2, 0.5], 'reply rate reuses Procure.rfqKpis');
eq(K.c.rfq.savingMedian, 98.25, 'cumulative saving includes a negative one (award above the median)');

eq([K.m.db.accepted, K.m.db.rejected, K.m.db.pending, K.m.db.quotePrices, K.m.db.suppliers, K.c.db.accepted], [1, 1, 1, 6, 40, 2], 'pricing database upkeep');
const v = K.m.value;
eq([v.n, v.ve, v.costSaving, v.collections, v.hours, v.verified, v.noEvidence], [3, 11000, 1200.5, 0, 8.5, 1, 1], 'value log in the month');
eq([K.c.value.collections, K.c.value.by['Claim/collection received'].verifiedAmount], [250000, 250000], 'collections cumulative, verified');
near(K.m.totals.savings, 12348.75, 'headline savings = RFQ vs median + VE + cost savings');
eq([K.m.totals.contractWon, K.m.totals.hours, K.m.totals.winRate], [125000, 8.5, 0.5], 'headline totals');
const cc = K.m.compliance;
eq(cc.checks.map(x => [x.ok, x.of]), [[3, 4], [3, 4], [1, 2], [1, 2], [2, 3], [1, 3]], 'record completeness checks');
near(cc.rate, 0.6111, 'completeness rate 11 of 18');
eq(K.trend.map(x => x.month), ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'], 'six-month trend');
eq([K.trend[5].won, K.trend[3].won, K.trend[4].rfqSaving], [2, 1, -50], 'trend values (September shows T6 even before the start date)');
eq(K.kpis.length, 8, 'eight contract KPIs');

// savings at award from a scored comparison
const IT = [{ line: 1, qty: 10, unit: 'bags', res_code: 'M09' }, { line: 2, qty: 5, unit: 'pcs' }];
const fx = { USD: { rate: 1.3 } };
const qs = [
  { supplier_id: 'S1', currency: 'BND', valid: true, lines: [{ line: 1, unit_price: 8 }, { line: 2, unit_price: 20 }] },
  { supplier_id: 'S2', currency: 'BND', valid: true, lines: [{ line: 1, unit_price: 9 }, { line: 2, unit_price: 22 }] },
  { supplier_id: 'S3', currency: 'BND', valid: true, lines: [{ line: 1, unit_price: 7 }, { line: 2, unit_price: 30 }] }];
const C = P.scoreQuotes(IT, qs, { fx, today: '2026-11-19' });
const row = C.rows.find(x => x.q.supplier_id === 'S1'), bc = P.budgetCheck(IT, { M09: { price: 8.5, unit: 'bag' } }, row.L);
eq(Perf.rfqSavings(C, row, bc), { total_bnd: '180.00', median_bnd: '200.00', valid_n: 3, ml_budget_bnd: '85.00', ml_quoted_bnd: '80.00', ml_lines: 1 }, 'savings at award: median of 3 passing quotes, masterlist on the ML line');
eq(Perf.rfqSavings(C, row, null).ml_lines, '', 'no masterlist: savings vs median only');
eq(Perf.rfqSavings(C, null, null), null, 'no awarded row: nothing to record');

// the copy embedded in index.html is the same as src/perf.js
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'), src = fs.readFileSync(path.join(__dirname, '..', 'src', 'perf.js'), 'utf8').trim();
eq(html.indexOf('<script>\n' + src + '\n</script>') >= 0, true, 'index.html embeds src/perf.js unchanged');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
