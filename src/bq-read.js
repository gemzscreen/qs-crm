/*
 * QS CRM — read the tendered BQ from a tender workbook (SheetJS workbook object).
 * Standard workbook: bill sheets named B1…Bn, header row "Page | Item | Description | Qty | Unit | Rate (B$) | Amount (B$) | Remarks".
 * Also accepts legacy layouts: "Bill No.1" sheets, and single "BQ" / "SOQ-1" sheets (quotations).
 * Needs ItemId (itemid.js) and XLSX (SheetJS).
 */
(function (root) {
  'use strict';
  var ItemId = (typeof require !== 'undefined') ? require('./itemid.js') : root.ItemId;
  var S = ItemId.SCHEMES;

  var UNIT_MAP = {
    'M2': 'm2', 'M²': 'm2', 'SQ.M': 'm2', 'SQM': 'm2', 'M3': 'm3', 'M³': 'm3', 'CU.M': 'm3', 'M': 'm', 'LM': 'm', 'L.M': 'm',
    'NO': 'No', 'NOS': 'No', "NO'S": 'No', 'NO.': 'No', 'PCS': 'No', 'NR': 'No', 'EA': 'No',
    'L.S': 'LS', 'LS': 'LS', 'L/S': 'LS', 'LUMP SUM': 'LS', 'SUM': 'LS', 'ITEM': 'Item', 'KG': 'kg', 'T': 't', 'TONNE': 't',
    'SET': 'Set', 'SETS': 'Set', 'PAIR': 'Pair', 'LOT': 'Lot', 'PROV': 'Prov', 'P.SUM': 'PS', 'PS': 'PS', 'PC': 'PC'
  };
  function normUnit(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    var k = s.toUpperCase().replace(/\s+/g, ' ');
    return UNIT_MAP[k] || s;
  }

  function billSheets(wb) {
    var out = [];
    wb.SheetNames.forEach(function (n) {
      var m = n.trim().match(/^B(\d+)$/i) || n.trim().match(/^Bill\s*No\.?\s*(\d+)$/i);
      if (m) out.push({ sheet: n, bill: 'B' + parseInt(m[1], 10), legacy: !/^B\d+$/i.test(n.trim()) });
    });
    if (!out.length) {
      wb.SheetNames.forEach(function (n) {
        if (/^(BQ|BOQ|SOQ(-\d+)?|SOW)$/i.test(n.trim())) out.push({ sheet: n, bill: null, single: true, legacy: true });
      });
    }
    if (!out.length) {
      // one sheet per section, named A, B, C … (Tender 9 MOH quotation)
      wb.SheetNames.forEach(function (n) {
        if (/^[A-Z]$/i.test(n.trim())) out.push({ sheet: n, bill: n.trim().toUpperCase(), section: true, legacy: false });
      });
    }
    return out;
  }

  function findHeader(rows) {
    for (var r = 0; r < Math.min(rows.length, 40); r++) {
      var cols = {};
      (rows[r] || []).forEach(function (v, c) {
        var t = String(v == null ? '' : v).trim().toLowerCase();
        if (t === 'page') cols.page = c;
        else if (t === 'item' || t === 'item no.' || t === 'item no' || t === 'no' || t === 'no.') cols.item = c;
        else if (t === 'description' || t === 'descriptions') cols.desc = c;
        else if (t === 'qty' || t === 'quantity') cols.qty = c;
        else if (t === 'unit') cols.unit = c;
        else if (/^rate/.test(t)) cols.rate = c;
        else if (/^amount/.test(t)) cols.amount = c;
        else if (t === 'remarks' || t === 'remark') cols.remarks = c;
      });
      if (cols.item != null && cols.desc != null && cols.qty != null) { cols.row = r; return cols; }
    }
    return null;
  }

  function num(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).replace(/[,\s]/g, '').replace(/^B\$/i, '');
    if (s === '' || isNaN(Number(s))) return null;
    return Number(s);
  }

  /* items: [{bill, item}] of measured lines. PL only when item letters restart inside a bill (A, B … A, B on the next page);
     letters that run on without repeating (T10 Bill 2 OSH A-P) are just item codes -> NUM. */
  function guessScheme(items) {
    var letters = 0, dotted = 0, repeats = 0, seen = {};
    items.forEach(function (o) {
      var s = String(o.item).trim();
      if (/^[A-Za-z]{1,2}$/.test(s)) {
        letters++;
        var k = o.bill + '|' + s.toUpperCase();
        if (seen[k]) repeats++; seen[k] = 1;
      } else if (INLINE_SUB.test(s) || /^\d+(\.\d+)*$/.test(s)) dotted++;
    });
    return (letters > dotted && repeats > 0) || (letters && !dotted && repeats > 0) ? S.PL : S.NUM;
  }
  var INLINE_SUB = /^(\d+(?:\.\d+)*)\.?\s*\(?([A-Za-z])\)?\.?$/;   // "3.3.1 a)" printed in one cell

  /* opts: { XLSX, scheme? } -> { scheme, items:[...], bills:{B1:{total,count}}, total, issues:[...] } */
  function readBQ(wb, opts) {
    opts = opts || {};
    var XLSX = opts.XLSX || root.XLSX;
    var sheets = billSheets(wb);
    var res = { scheme: opts.scheme || null, items: [], bills: {}, total: 0, issues: [], layout: '' };
    if (!sheets.length) { res.issues.push('No bill sheets found (expected B1, B2 … or BQ)'); return res; }
    res.layout = sheets[0].section ? 'one sheet per section (A, B, C)' : sheets[0].single ? 'single BQ sheet (legacy quotation)' : (sheets[0].legacy ? 'Bill No.n sheets (legacy)' : 'standard B-sheets');

    var parsed = sheets.map(function (sh) {
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[sh.sheet], { header: 1, raw: true, defval: null });
      var h = findHeader(rows);
      if (!h) res.issues.push(sh.sheet + ': header row not found');
      return { sh: sh, rows: rows, h: h };
    }).filter(function (p) { return p.h; });

    if (!res.scheme) {
      var single = sheets[0].single, sample = [];
      parsed.forEach(function (p) {
        p.rows.slice(p.h.row + 1).forEach(function (r) {
          if (r[p.h.item] != null && r[p.h.unit] != null && String(r[p.h.unit]).trim()) sample.push({ bill: p.sh.sheet, item: r[p.h.item] });
        });
      });
      res.scheme = sheets[0].section ? S.SEC : (single && hasSectionLetters(parsed) ? S.SEC : guessScheme(sample));
    }

    var seen = {};
    parsed.forEach(function (p) {
      var h = p.h, page = '', heading = '', bill = p.sh.bill || (res.scheme === S.SEC ? '' : 'B1');
      var parent = '', lastNo = 0;   // parent numbered item for lettered sub-items (a., b.)
      function checkRestart(it) {
        if (res.scheme !== S.SEC) return;
        var n = parseInt(String(it).replace(/^[A-Za-z]+/, ''), 10);
        if (isNaN(n)) return;
        if (n < lastNo) res.issues.push(p.sh.sheet + ': item numbering restarts at ' + it + ' inside section ' + bill + ' - section letter missing in the source? Add it on the heading row (see standards).');
        lastNo = n;
      }
      p.rows.slice(h.row + 1).forEach(function (r, i) {
        var rowNo = h.row + 2 + i;
        var pg = h.page != null ? r[h.page] : null;
        if (pg != null && String(pg).trim()) page = String(pg).trim();
        var item = r[h.item], desc = r[h.desc], unit = r[h.unit], qtyRaw = r[h.qty];
        var itemS = item == null ? '' : String(item).trim();
        var hasUnit = unit != null && String(unit).trim() !== '';
        var hasQty = qtyRaw != null && String(qtyRaw).trim() !== '';
        if (!itemS) { if (desc && !/^(sub-?total|collection|total|from page|carried)/i.test(String(desc).trim())) heading = String(desc).trim(); return; }
        var isLetter = /^\(?[A-Za-z]{1,2}[.)]*$/.test(itemS);
        if (!hasUnit && !hasQty) {
          // heading line carrying an item code: section letter (SEC), parent of sub-items, or group heading
          if (res.scheme === S.SEC && isLetter) { bill = itemS.replace(/[^A-Za-z]/g, '').toUpperCase(); parent = ''; lastNo = 0; }
          else if (res.scheme !== S.PL && !isLetter) { parent = itemS; checkRestart(itemS); }
          if (desc) heading = String(desc).trim();
          return;
        }
        var sub = '', mIn = res.scheme !== S.PL && typeof item === 'string' && itemS.match(INLINE_SUB);
        if (mIn) { item = mIn[1]; sub = mIn[2]; parent = ''; }
        else if (res.scheme !== S.PL && isLetter && parent) { sub = itemS; item = parent; }
        else if (res.scheme !== S.PL) { parent = ''; checkRestart(itemS); }
        var w = [];
        var qty = num(qtyRaw), u = normUnit(unit);
        if (qty == null && (/lump/i.test(String(qtyRaw)) || u === 'LS')) { qty = 1; u = 'LS'; }   // lump sum with blank / "Lump" qty
        if (res.scheme === S.SEC && !bill) res.issues.push(p.sh.sheet + ' row ' + rowNo + ': item before any section letter');
        var id = ItemId.makeId({ scheme: res.scheme, bill: bill, page: page, item: item, sub: sub, warnings: w });
        if (seen[id]) { res.issues.push('Duplicate ID ' + id + ' (rows ' + seen[id] + ' and ' + rowNo + ')'); id = id + '#' + rowNo; }
        seen[id] = p.sh.sheet + '!' + rowNo;
        var amount = num(r[h.amount]);
        var rate = num(r[h.rate]);
        if (qty == null) w.push('Qty not numeric: "' + qtyRaw + '"');
        if (!u) w.push('No unit');
        if (amount != null && rate != null && qty != null && Math.abs(qty * rate - amount) > 0.05) w.push('Qty x Rate <> Amount');
        w.forEach(function (x) { res.issues.push(id + ': ' + x); });
        res.items.push({
          item_id: id, bill: bill, page: page, item: sub && !mIn ? String(item).trim() + ' ' + itemS : itemS, heading: heading,
          description: desc == null ? '' : String(desc).trim(), qty: qty, unit: u,
          rate: rate, amount: amount, remarks: h.remarks != null && r[h.remarks] != null ? String(r[h.remarks]) : '',
          source: p.sh.sheet + '!' + rowNo
        });
        var b = res.bills[bill] || (res.bills[bill] = { total: 0, count: 0 });
        b.total += amount || 0; b.count++;
        res.total += amount || 0;
      });
    });
    res.total = Math.round(res.total * 100) / 100;
    Object.keys(res.bills).forEach(function (k) { res.bills[k].total = Math.round(res.bills[k].total * 100) / 100; });
    return res;
  }

  function hasSectionLetters(parsed) {
    return parsed.some(function (p) {
      return p.rows.slice(p.h.row + 1).some(function (r) {
        return /^[A-Za-z]$/.test(String(r[p.h.item] == null ? '' : r[p.h.item]).trim()) && (r[p.h.unit] == null || !String(r[p.h.unit]).trim());
      });
    });
  }

  var api = { readBQ: readBQ, billSheets: billSheets, normUnit: normUnit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BQRead = api;
})(this);
