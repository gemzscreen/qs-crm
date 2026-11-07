/*
 * QS CRM — Rationalized BQ revisions (v2).
 * A revision (R1, R2 …) is a full copy of the BQ lines after rationalization, stored in BQ_Items with bq_set = 'R1' …
 * Lines keep the tendered item_id, so as-built quantities match across Tendered, every revision and As-built.
 *
 *   Rev.diff(base, rev)          -> line-by-line changes (Unchanged / Qty / Rate / Qty & rate / Added / Omitted) + totals per bill
 *   Rev.contract(tendered, rev)  -> the contract BQ: revision lines + tendered items omitted from it (qty 0),
 *                                   each line carrying tend_qty / tend_rate / tend_amount (blank for added items)
 *   Rev.current(revisions)       -> latest Approved revision record (or null)
 *   Rev.nextNo(revisions)        -> 'R1', 'R2' …
 *   Rev.amount(qty, rate, amt)   -> qty × rate rounded to cents (falls back to the typed amount when qty or rate is blank)
 */
(function (root) {
  'use strict';

  function num(v) {
    if (v === '' || v == null) return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  function r2(x) { return Math.round((x + (x >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }
  function amount(qty, rate, amt) {
    var q = num(qty), r = num(rate);
    if (q != null && r != null) return r2(q * r);
    var a = num(amt);
    return a == null ? 0 : r2(a);
  }
  function lineAmt(l) { var a = num(l.amount); return a != null ? a : amount(l.qty, l.rate); }
  function sum(lines) { return r2((lines || []).reduce(function (s, l) { return s + lineAmt(l); }, 0)); }
  function same(a, b, eps) { a = num(a); b = num(b); if (a == null && b == null) return true; if (a == null || b == null) return false; return Math.abs(a - b) <= eps; }
  function omitted(l) { return l && num(l.qty) === 0 && lineAmt(l) === 0; }

  function diff(base, rev) {
    base = base || []; rev = rev || [];
    var bIdx = {}, rIds = {};
    base.forEach(function (b, i) { bIdx[b.item_id] = i; });
    rev.forEach(function (r) { rIds[r.item_id] = true; });
    var rows = [], done = {}, next = 0;
    function emitOmitted(upTo) {
      for (; next < upTo; next++) {
        var b = base[next];
        if (!rIds[b.item_id] && !done[b.item_id]) { rows.push(row(b, null)); done[b.item_id] = 1; }
      }
    }
    function row(b, r) {
      var st;
      if (!b) st = 'Added';
      else if (!r || (omitted(r) && !omitted(b))) st = 'Omitted';
      else {
        var q = same(b.qty, r.qty, 1e-6), p = same(b.rate, r.rate, 0.005);
        st = q && p ? (same(lineAmt(b), lineAmt(r), 0.005) ? 'Unchanged' : 'Amount') : (!q && !p ? 'Qty & rate' : (!q ? 'Qty' : 'Rate'));
      }
      var ba = b ? lineAmt(b) : 0, ra = r ? lineAmt(r) : 0;
      var src = r || b;
      return {
        item_id: src.item_id, bill: src.bill, page: src.page, item: src.item, heading: src.heading, description: src.description, unit: src.unit,
        status: st,
        base_qty: b ? num(b.qty) : null, base_rate: b ? num(b.rate) : null, base_amount: b ? ba : null,
        rev_qty: r ? num(r.qty) : (b ? 0 : null), rev_rate: r ? num(r.rate) : (b ? num(b.rate) : null), rev_amount: r ? ra : 0,
        diff_amount: r2(ra - ba),
        text_changed: !!(b && r && (String(b.description || '') !== String(r.description || '') || String(b.unit || '') !== String(r.unit || '')))
      };
    }
    rev.forEach(function (r) {
      var i = bIdx[r.item_id];
      if (i != null) { emitOmitted(i); rows.push(row(base[i], r)); done[r.item_id] = 1; if (i >= next) next = i + 1; }
      else rows.push(row(null, r));
    });
    emitOmitted(base.length);
    var T = { base: 0, rev: 0, diff: 0, counts: { Unchanged: 0, Qty: 0, Rate: 0, 'Qty & rate': 0, Amount: 0, Added: 0, Omitted: 0 } }, bills = {}, order = [];
    rows.forEach(function (x) {
      T.base += x.base_amount || 0; T.rev += x.rev_amount || 0; T.counts[x.status]++;
      var k = x.bill || '-'; if (!bills[k]) { bills[k] = { bill: k, base: 0, rev: 0, changed: 0, lines: 0 }; order.push(k); }
      bills[k].base += x.base_amount || 0; bills[k].rev += x.rev_amount || 0; bills[k].lines++; if (x.status !== 'Unchanged') bills[k].changed++;
    });
    T.base = r2(T.base); T.rev = r2(T.rev); T.diff = r2(T.rev - T.base);
    T.changed = rows.length - T.counts.Unchanged;
    order.forEach(function (k) { bills[k].base = r2(bills[k].base); bills[k].rev = r2(bills[k].rev); });
    return { rows: rows, totals: T, bills: order.map(function (k) { return bills[k]; }) };
  }

  /* contract BQ used by the as-built reports */
  function contract(tendered, revLines) {
    tendered = tendered || [];
    if (!revLines || !revLines.length) {
      return tendered.map(function (b) {
        return Object.assign({}, b, { tend_qty: num(b.qty), tend_rate: num(b.rate), tend_amount: lineAmt(b), rev_change: '' });
      });
    }
    var tIdx = {}; tendered.forEach(function (b) { tIdx[b.item_id] = b; });
    return diff(tendered, revLines).rows.map(function (x) {
      var t = tIdx[x.item_id] || null;
      var src = x.status === 'Omitted' ? t : (revLines.filter(function (r) { return r.item_id === x.item_id; })[0] || t);
      var o = Object.assign({}, src);
      if (x.status === 'Omitted') { o.qty = 0; o.amount = 0; o.rate = t ? t.rate : ''; }
      o.tend_qty = t ? num(t.qty) : null; o.tend_rate = t ? num(t.rate) : null; o.tend_amount = t ? lineAmt(t) : null;
      o.rev_change = x.status === 'Unchanged' ? '' : x.status;
      return o;
    });
  }

  function revNo(r) { var m = String(r || '').match(/^R(\d+)$/i); return m ? +m[1] : 0; }
  function nextNo(revs) { var mx = 0; (revs || []).forEach(function (r) { mx = Math.max(mx, revNo(r.rev)); }); return 'R' + (mx + 1); }
  function current(revs) {
    var a = (revs || []).filter(function (r) { return r.status === 'Approved'; }).sort(function (x, y) { return revNo(y.rev) - revNo(x.rev); });
    return a[0] || null;
  }
  /* the set a new revision starts from: latest approved revision, else the tendered BQ */
  function baseOf(revs, rev) {
    var n = revNo(rev);
    var a = (revs || []).filter(function (r) { return r.status === 'Approved' && revNo(r.rev) < n; }).sort(function (x, y) { return revNo(y.rev) - revNo(x.rev); });
    return a[0] ? a[0].rev : 'Tendered';
  }

  var api = { diff: diff, contract: contract, current: current, nextNo: nextNo, baseOf: baseOf, revNo: revNo, amount: amount, sum: sum, num: num };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rev = api;
})(this);
