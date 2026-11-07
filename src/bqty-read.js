/*
 * QS CRM — read a Breakdown QTY workbook (site as-built measurement) and match it to the tendered BQ.
 * Two layouts:
 *  standard  ARZA template: level sheets with header "BQ Item Ref | Level | Location/Room | Description | Unit | Nos | L | W | H | Qty | Remark | Measured by | Date"
 *  legacy    MOE Block D style: header "SL NO | LOCATION | DESCRIPTION | UNITS | NOS | Size (L, W/B, H) | TOTAL QUANTITY | REMARK";
 *            the BQ ref sits on an item row, the measured lines follow below it with a blank ref;
 *            "Total …" rows in the ref column are subtotals and are skipped.
 * Qty rule: Qty = Nos × L × W × H (blank dimensions ignored). Deductions: negative Nos (standard) or a negative total (legacy).
 * Needs ItemId (itemid.js) and XLSX (SheetJS).
 */
(function (root) {
  'use strict';
  var ItemId = (typeof require !== 'undefined') ? require('./itemid.js') : root.ItemId;

  function txt(v) { return v == null ? '' : String(v).replace(/ /g, ' ').trim(); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = txt(v).replace(/[,\s]/g, '');
    if (s === '' || isNaN(Number(s))) return null;
    return Number(s);
  }
  function round(x, d) { var f = Math.pow(10, d == null ? 3 : d); return Math.round(x * f) / f; }
  function isSkipSheet(n) { return /^(project|summary|readme|lists?|instructions?|legend)$/i.test(txt(n)); }

  /* ---- header detection ---- */
  function findStandard(rows) {
    for (var r = 0; r < Math.min(rows.length, 30); r++) {
      var c = {}, row = rows[r] || [];
      row.forEach(function (v, i) {
        var t = txt(v).toLowerCase().replace(/\s+/g, ' ');
        if (/^bq item ref/.test(t)) c.ref = i;
        else if (t === 'level') c.level = i;
        else if (/^location/.test(t)) c.loc = i;
        else if (t === 'description') c.desc = i;
        else if (t === 'unit' || t === 'units') c.unit = i;
        else if (t === 'nos' || t === 'no' || t === 'no.') c.nos = i;
        else if (t === 'l') c.l = i;
        else if (t === 'w' || t === 'b') c.w = i;
        else if (t === 'h' || t === 'd') c.h = i;
        else if (t === 'qty' || t === 'quantity') c.qty = i;
        else if (/^remark/.test(t)) c.remark = i;
        else if (/^measured by/.test(t)) c.by = i;
        else if (t === 'date') c.date = i;
      });
      if (c.ref != null && (c.qty != null || c.nos != null)) { c.row = r; return c; }
    }
    return null;
  }
  function findLegacy(rows) {
    for (var r = 0; r < Math.min(rows.length, 30); r++) {
      var row = rows[r] || [];
      var a = row.map(function (v) { return txt(v).toLowerCase().replace(/\s+/g, ' '); });
      var iRef = a.findIndex(function (t) { return /^(sl ?no|s\/no|item ref|ref)\.?$/.test(t); });
      if (iRef < 0 || a.indexOf('description') < 0) continue;
      var c = { ref: iRef, desc: a.indexOf('description'), loc: a.findIndex(function (t) { return /^location/.test(t); }) };
      var ri = a.findIndex(function (t) { return /^remark/.test(t); }); if (ri >= 0) c.remark = ri;
      // units / nos / size / total on the next 1-2 rows
      for (var k = r; k <= Math.min(r + 3, rows.length - 1); k++) {
        (rows[k] || []).forEach(function (v, i) {
          var t = txt(v).toLowerCase().replace(/\s+/g, ' ');
          if (t === 'units' || t === 'unit') c.unit = i;
          else if (t === 'nos' || t === 'no') c.nos = i;
          else if (t === 'l' && k > r) c.l = i;
          else if ((t === 'w' || t === 'b') && k > r) c.w = i;
          else if (t === 'h' && k > r) c.h = i;
          else if (/^total quantity|^total qty|^quantity$/.test(t)) c.qty = i;
          else if (/^remark/.test(t) && c.remark == null) c.remark = i;
        });
        if (c.l != null && c.qty != null) { c.row = k; break; }
      }
      if (c.qty != null && c.unit != null) { if (c.row == null) c.row = r + 2; return c; }
    }
    return null;
  }

  /* is a ref-column value a real BQ ref (has digits), a section heading (B.2) or a label (Total …)? */
  function refKind(s) {
    if (!s) return 'blank';
    if (/^total\b|^sub-?total|^grand total/i.test(s) || !/\d/.test(s)) return 'label';
    // a ref has no ordinary words: "150mm thick light weight brickwall" is a subtotal label, "Bill 2 Page 1 Item B" is a ref
    if (/[a-z]{3,}/i.test(s.replace(/\b(bill|page|item|and|ref|no|section|sec)\b/gi, ''))) return 'label';
    if (/^b\s*\.?\s*\d+\.?$/i.test(s.replace(/\s+/g, ''))) return 'section';
    return 'ref';
  }

  function measure(o) {
    var dims = [o.nos, o.l, o.w, o.h].filter(function (x) { return x != null; });
    return dims.length ? dims.reduce(function (a, b) { return a * b; }, 1) : null;
  }

  /* opts: { XLSX, scheme } -> { format, sheets:[names], lines:[...], labels:n, issues:[...] } */
  function readBQTY(wb, opts) {
    opts = opts || {};
    var XLSX = opts.XLSX || root.XLSX;
    var out = { format: '', sheets: [], lines: [], labels: 0, issues: [] };
    wb.SheetNames.forEach(function (n) {
      if (isSkipSheet(n)) return;
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null });
      var std = findStandard(rows), leg = std ? null : findLegacy(rows);
      if (!std && !leg) return;
      out.sheets.push(n);
      out.format = out.format && out.format !== (std ? 'standard' : 'legacy') ? 'mixed' : (std ? 'standard' : 'legacy');
      var h = std || leg, cur = null, curDesc = '', curLoc = '';
      rows.slice(h.row + 1).forEach(function (r, i) {
        var rowNo = h.row + 2 + i;
        var ref = txt(r[h.ref]), kind = refKind(ref);
        if (kind === 'section' && opts.scheme && opts.scheme !== 'PL') kind = 'ref';   // "B.2" is section B item 2 in SEC tenders
        var unit = h.unit != null ? txt(r[h.unit]) : '';
        var o = { nos: h.nos != null ? num(r[h.nos]) : null, l: h.l != null ? num(r[h.l]) : null, w: h.w != null ? num(r[h.w]) : null, h: h.h != null ? num(r[h.h]) : null };
        var qtyIn = h.qty != null ? num(r[h.qty]) : null;
        var desc = h.desc != null ? txt(r[h.desc]) : '', loc = h.loc != null ? txt(r[h.loc]) : '';
        var remark = h.remark != null ? txt(r[h.remark]) : '';
        var hasMeasure = qtyIn != null || o.nos != null || o.l != null;
        if (std) {
          if (/^example/i.test(remark)) return;   // template example row
          if (!ref && !hasMeasure) return;
          if (kind === 'label') { out.labels++; return; }
          if (!hasMeasure) { out.issues.push(n + ' row ' + rowNo + ': ' + (ref || 'line') + ' has no quantity or dimensions'); return; }
          var calc = measure(o);
          var qty = calc != null ? calc : qtyIn;
          if (calc != null && qtyIn != null && Math.abs(calc - qtyIn) > 0.05) out.issues.push(n + ' row ' + rowNo + ': Qty ' + qtyIn + ' differs from Nos×L×W×H ' + round(calc, 2) + ' (calculated value used)');
          out.lines.push({ sheet: n, row: rowNo, ref_raw: kind === 'section' ? '' : ref, level: txt(r[h.level]) || n, location: loc, description: desc, unit: unit,
            nos: o.nos, l: o.l, w: o.w, h: o.h, qty: round(qty), remark: remark,
            measured_by: h.by != null ? txt(r[h.by]) : '', measured_date: h.date != null ? dateTxt(r[h.date]) : '' });
          return;
        }
        // legacy: item rows carry the ref, measured lines below
        if (kind === 'label') { if (ref) out.labels++; cur = null; return; }
        if (kind === 'section') { cur = null; return; }
        if (kind === 'ref') { cur = ref; curDesc = desc; curLoc = loc; if (!hasMeasure) return; }
        if (!hasMeasure) return;
        if (!cur) { out.issues.push(n + ' row ' + rowNo + ': quantity with no BQ ref above it'); }
        var c2 = measure(o), q = qtyIn != null ? qtyIn : c2;
        if (q == null) return;
        if (c2 != null && o.l != null && Math.abs(Math.abs(c2) - Math.abs(q)) > 0.05) out.issues.push(n + ' row ' + rowNo + ' (' + (cur || '?') + '): total ' + q + ' ≠ Nos×L×W×H ' + round(c2, 2) + ' — check on site (typed total kept)');
        if (!unit) out.issues.push(n + ' row ' + rowNo + ' (' + (cur || '?') + '): no unit');
        out.lines.push({ sheet: n, row: rowNo, ref_raw: cur || '', level: n, location: desc || curLoc, description: curDesc, unit: unit,
          nos: o.nos, l: o.l, w: o.w, h: o.h, qty: round(q), remark: remark, measured_by: '', measured_date: '' });
      });
    });
    if (!out.sheets.length) out.issues.push('No Breakdown QTY sheets found (header "BQ Item Ref" or "SL NO / DESCRIPTION / TOTAL QUANTITY").');
    return out;
  }
  function dateTxt(v) {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'number' && v > 20000 && v < 80000) { var d = new Date(Math.round((v - 25569) * 864e5)); return d.toISOString().slice(0, 10); }
    return txt(v);
  }

  var UNIT_EQ = { 'm2': 'm2', 'm²': 'm2', 'sq.m': 'm2', 'sqm': 'm2', 'm3': 'm3', 'm³': 'm3', 'm': 'm', 'lm': 'm', 'no': 'No', 'nos': 'No', 'nr': 'No', 'ls': 'LS', 'item': 'Item', 'kg': 'kg', 't': 't' };
  function unitKey(u) { var k = txt(u).toLowerCase(); return UNIT_EQ[k] || k; }

  /*
   * Match lines to the tendered BQ. bqItems: [{item_id, unit, ...}]. Returns rows ready for AsBuilt_Items:
   * one row per (line, item). A line naming several items gives one row per item with the full qty (Shared).
   */
  function match(lines, scheme, bqItems) {
    var known = new Set(bqItems.map(function (b) { return b.item_id; }));
    var unitOf = {}; bqItems.forEach(function (b) { unitOf[b.item_id] = b.unit; });
    var rows = [], stats = { lines: lines.length, Matched: 0, Shared: 0, Unmatched: 0, 'VO?': 0, unitWarn: 0 };
    lines.forEach(function (ln) {
      var base = Object.assign({}, ln);
      if (!ln.ref_raw) {
        var vo = /\bvo\b|vo\?|variation/i.test(ln.remark);
        rows.push(Object.assign(base, { item_ref_raw: '', item_id: '', match_status: vo ? 'VO?' : 'Unmatched', match_note: vo ? 'Not in BQ (VO?)' : 'No BQ ref' }));
        stats[vo ? 'VO?' : 'Unmatched']++; return;
      }
      var r = ItemId.resolve(ln.ref_raw, scheme, known);
      var many = r.ids.length + r.unmatched.length > 1;
      r.ids.forEach(function (id) {
        var note = '', uk = unitKey(unitOf[id]), ul = unitKey(ln.unit);
        if (ul && uk && ul !== uk) { note = 'Unit ' + ln.unit + ' vs BQ ' + unitOf[id]; stats.unitWarn++; }
        rows.push(Object.assign({}, base, { item_ref_raw: ln.ref_raw, item_id: id, match_status: many ? 'Shared' : 'Matched', match_note: note }));
        stats[many ? 'Shared' : 'Matched']++;
      });
      r.unmatched.forEach(function (u) {
        rows.push(Object.assign({}, base, { item_ref_raw: ln.ref_raw, item_id: '', match_status: 'Unmatched', match_note: 'Ref ' + u + ' not in the tendered BQ' }));
        stats.Unmatched++;
      });
    });
    return { rows: rows, stats: stats };
  }

  /*
   * Report data: per BQ item tendered vs as-built. asb: AsBuilt rows of one measure set.
   * -> { items:[{...bq, ab_qty, ab_amount, diff_qty, diff_pct, diff_amount, lines, flag}], bills:{}, totals, unmatched:[...] }
   */
  function compare(bqItems, asb) {
    var sum = {}, cnt = {};
    asb.forEach(function (a) { if (!a.item_id) return; sum[a.item_id] = (sum[a.item_id] || 0) + (Number(a.qty) || 0); cnt[a.item_id] = (cnt[a.item_id] || 0) + 1; });
    var bills = {}, T = { tendered: 0, asbuilt: 0, diff: 0, measured: 0, items: 0, tend: 0 };   // tendered = contract BQ amount; tend = original tendered (v2)
    var items = bqItems.map(function (b) {
      var tq = Number(b.qty) || 0, rate = Number(b.rate) || 0, measured = b.item_id in sum;
      var aq = measured ? round(sum[b.item_id]) : null;
      var lump = /^(LS|PS|PC|Item|Prov|Sum)$/i.test(String(b.unit || ''));
      var tAmt = b.amount != null && b.amount !== '' ? Number(b.amount) : tq * rate;
      var aAmt = measured ? round(aq * rate, 2) : (lump ? tAmt : null);   // unmeasured lump sums are carried at the tendered amount
      var o = Object.assign({}, b, { ab_qty: aq, ab_amount: aAmt, lines: cnt[b.item_id] || 0,
        diff_qty: measured ? round(aq - tq) : null, diff_pct: measured && tq ? (aq - tq) / tq : null,
        diff_amount: aAmt != null ? round(aAmt - tAmt, 2) : null, t_amount: tAmt, lump: lump });
      o.flag = !measured ? (lump ? 'Lump sum (carried)' : 'Not measured') : (Math.abs(o.diff_pct || 0) > 0.1 ? (o.diff_qty > 0 ? 'Over +10%' : 'Under −10%') : '');
      if (b.rev_change === 'Omitted') { o.flag = measured ? 'Omitted but measured' : 'Omitted'; if (!measured) o.ab_amount = 0; }
      else if (b.rev_change === 'Added' && !measured) o.flag = 'Added, not measured';
      o.tend_amount = 'tend_amount' in b ? (Number(b.tend_amount) || 0) : tAmt;   // contract BQ lines (v2) carry the original tendered amount
      var k = b.bill || '-'; var bb = bills[k] || (bills[k] = { bill: k, tendered: 0, asbuilt: 0, items: 0, measured: 0, tend: 0 });
      bb.tendered += tAmt || 0; bb.asbuilt += o.ab_amount || 0; bb.items++; if (measured) bb.measured++; bb.tend += o.tend_amount;
      T.tendered += tAmt || 0; T.asbuilt += o.ab_amount || 0; T.items++; if (measured) T.measured++; T.tend += o.tend_amount;
      return o;
    });
    T.diff = round(T.asbuilt - T.tendered, 2);
    var unmatched = asb.filter(function (a) { return !a.item_id; });
    return { items: items, bills: bills, totals: T, unmatched: unmatched };
  }

  var api = { readBQTY: readBQTY, match: match, compare: compare, refKind: refKind };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BQTY = api;
})(this);
