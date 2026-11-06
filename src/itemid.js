/*
 * QS CRM — BQ Item ID rule (v0)
 * One canonical ID per BQ line, unique within a tender.
 * Full DB key = arza_no (T01…) + bq_set + Item ID.
 *
 * Three numbering schemes are found in ARZA tenders; each tender records its scheme:
 *   PL  (page-letter, classic SMM2)   items A, B, C… restart on every page
 *        ID = B<bill>.<page>.<item>     e.g.  B1.1.A   (Tender 1, MOE Block D)
 *   NUM (numbered items, JKR style)    item numbers unique in the tender (4.1.1)
 *        ID = B<bill>.<item>            e.g.  B4.4.1.1 (Tender 8, Tender 6)
 *   SEC (section + number, quotations) items 1, 2… restart in every section A, B, C…
 *        ID = <section>.<item>          e.g.  C.3      (Tender 5, Tender 3)
 * Sub-items lettered under a numbered item (a., b. = Toilet block / Admin block)
 *        add .<letter>                  e.g.  C.1.A, B4.4.1.1.A  (not used in PL)
 * Items added in a rationalized revision (v2): next free X-number in the bill,
 *        e.g. B4.X1, B1.1.X1, C.X1.
 *
 * Works in the browser (global ItemId) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var SCHEMES = { PL: 'PL', NUM: 'NUM', SEC: 'SEC' };

  function clean(s) {
    return String(s == null ? '' : s)
      .replace(/[‐-―]/g, '-')      // unicode dashes
      .replace(/ /g, ' ')
      .trim();
  }

  /* Bill code: "B1", "Bill No.1", "BILL 1", "B.1", 1 -> "B1"; section letter "c" -> "C" */
  function normBill(x) {
    var s = clean(x).toUpperCase();
    if (!s) return '';
    var m = s.match(/^(?:BILL\s*(?:NO\.?)?|B)?\s*[.\-]?\s*(\d+)$/);
    if (m) return 'B' + parseInt(m[1], 10);
    if (/^[A-Z]{1,2}$/.test(s)) return s;   // section letter (SEC scheme)
    return s.replace(/\s+/g, '');
  }

  /* Page within the bill: "B1.1/3" -> "1", "B1.1" -> "1", "Page 1 of 8" -> "1", "1" -> "1" */
  function normPage(x) {
    var s = clean(x).toUpperCase();
    if (!s) return '';
    var m = s.match(/^PAGE\s*(\d+)/);
    if (m) return String(parseInt(m[1], 10));
    m = s.match(/^B\s*\d+\s*[.\-]\s*(\d+)/);           // B1.1/3, B1.1
    if (m) return String(parseInt(m[1], 10));
    m = s.match(/^(\d+)(?:\s*\/\s*\d+)?$/);             // 1 or 1/3
    if (m) return String(parseInt(m[1], 10));
    return s.replace(/\s+/g, '');                        // e.g. ST/12 kept as-is (not used in NUM IDs)
  }

  /* Item: "a" -> "A", "4.1.1." -> "4.1.1", 3 -> "3". Warns on numbers that Excel may have damaged (1.10 -> 1.1). */
  function normItem(x, warnings) {
    if (typeof x === 'number' && !Number.isInteger(x) && warnings) {
      warnings.push('Item stored as a number (' + x + ') - check e.g. 1.10 read as 1.1; store items as text');
    }
    var s = clean(x).toUpperCase().replace(/\s+/g, '').replace(/[()]/g, '').replace(/[.\-]+$/, '').replace(/^[.\-]+/, '');
    s = s.replace(/-/g, '.');
    return s;
  }

  /* Build the canonical ID from separate Bill / Page / Item cells (BQ import). */
  function makeId(o) {
    var w = o.warnings || [];
    var scheme = o.scheme;
    var bill = normBill(o.bill);
    var item = normItem(o.item, w);
    if (!item) return '';
    if (scheme === SCHEMES.SEC && bill && item.indexOf(bill) === 0 && /^\d/.test(item.slice(bill.length))) {
      item = item.slice(bill.length);                     // "B1" in section B -> "1"
    }
    if (o.sub) item += '.' + normItem(o.sub, w);
    if (scheme === SCHEMES.PL) {
      var page = normPage(o.page);
      return bill + '.' + page + '.' + item;
    }
    if (scheme === SCHEMES.NUM) return bill + '.' + item;
    if (scheme === SCHEMES.SEC) return bill + '.' + item;
    throw new Error('Unknown scheme: ' + scheme);
  }

  function letterRange(a, b) {
    var out = [];
    if (a.length !== 1 || b.length !== 1) return null;
    var x = a.charCodeAt(0), y = b.charCodeAt(0);
    if (y < x || y - x > 25) return null;
    for (var c = x; c <= y; c++) out.push(String.fromCharCode(c));
    return out;
  }

  /* Split a free-text cell into individual refs: "B.2.2-C & B.2.3-C", multi-line, commas, "and". */
  function splitRefs(text) {
    return clean(text)
      .split(/\r?\n|&|;|,|\band\b|\+|\s+(?=B\s*\.\s*\d+\s*[.\-]\s*\d)/i)   // last: "B.2.9.A B.2.9.B" (space between two full refs)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /*
   * Parse ONE free-text ref (Breakdown QTY, CostX/PlanSwift exports) into candidate IDs.
   * Returns { ids: [...], warnings: [...] } — more than one id when a letter range is given (B2.1.A-C).
   */
  function parseOne(ref, scheme, ctx) {
    ctx = ctx || {};
    var w = [];
    var s = clean(ref).toUpperCase()
      .replace(/^(?:BQ\s*)?(?:ITEM\s*)?(?:REF\.?\s*)?/, '')
      .replace(/\bBILL\s*(?:NO\.?)?\s*/g, 'B')
      .replace(/\bPAGE\s*/g, '')
      .replace(/\bITEM\s*/g, '')
      .replace(/\(.*?\)/g, '')
      .trim();
    if (!s) return { ids: [], warnings: ['Empty ref'] };

    if (scheme === SCHEMES.PL) {
      // tokens: bill, page, [of-pages], item letter(s) [ - item letter ]
      var hasB = /^B/.test(s);
      var body = s.replace(/^B\s*[.\-\s]?/, '');
      var range = body.match(/([A-Z]{1,2})\s*-\s*([A-Z]{1,2})$/);
      if (range) body = body.slice(0, range.index);
      var toks = body.split(/[.\-\/\s]+/).filter(Boolean);
      var nums = toks.filter(function (t) { return /^\d+$/.test(t); });
      var lets = toks.filter(function (t) { return /^[A-Z]{1,2}$/.test(t); });
      if (!hasB && ctx.bill && nums.length === 1) nums.unshift(String(ctx.bill).replace(/^B/i, ''));
      if (nums.length < 2) return { ids: [], warnings: ['Cannot find bill and page in "' + ref + '"'] };
      if (nums.length > 2) w.push('Extra number ignored in "' + ref + '" (page "of" count?)');
      var bill = 'B' + parseInt(nums[0], 10), page = String(parseInt(nums[1], 10));
      var items = [];
      if (range) {
        items = letterRange(range[1], range[2]);
        if (!items) return { ids: [], warnings: ['Bad item range in "' + ref + '"'] };
        w.push('Item range expanded: ' + range[1] + '-' + range[2]);
      } else if (lets.length === 1) {
        items = [lets[0]];
      } else {
        return { ids: [], warnings: ['Cannot find item letter in "' + ref + '"'] };
      }
      return { ids: items.map(function (i) { return bill + '.' + page + '.' + i; }), warnings: w };
    }

    if (scheme === SCHEMES.NUM) {
      var mB = s.match(/^B\s*[.\-\s]?\s*(\d+)\s*[.\-\s]\s*(.+)$/);
      var billN, itemS;
      if (mB) { billN = parseInt(mB[1], 10); itemS = mB[2]; }
      else { itemS = s; }
      itemS = normItem(itemS, w);
      var mI = itemS.match(/^(\d+(?:\.\d+)*)(?:\.?([A-Z]))?$/);
      if (!mI) return { ids: [], warnings: ['Cannot read item number in "' + ref + '"'] };
      itemS = mI[1] + (mI[2] ? '.' + mI[2] : '');
      var first = parseInt(itemS.split('.')[0], 10);
      var cands = [];
      if (billN == null) {
        billN = ctx.bill ? parseInt(String(ctx.bill).replace(/^B/i, ''), 10) : first;
        cands.push('B' + billN + '.' + itemS);
      } else if (first === billN) {
        cands.push('B' + billN + '.' + itemS);                 // B4.4.1.1
      } else {
        cands.push('B' + billN + '.' + billN + '.' + itemS);   // B4.1.1 meaning item 4.1.1
        cands.push('B' + billN + '.' + itemS);                 // or item 1.1 in bill 4
        w.push('Ambiguous ref "' + ref + '" - resolved against the tender BQ');
      }
      return { ids: cands, warnings: w, candidates: cands.length > 1 };
    }

    if (scheme === SCHEMES.SEC) {
      var m = s.replace(/^SEC(?:TION)?\s*/, '').match(/^([A-Z]{1,2})\s*[.\-\/\s]?\s*(\d+)(?:\s*[.\-\/\s]?\s*([A-Z]))?\.?$/);
      if (!m) return { ids: [], warnings: ['Cannot read section/item in "' + ref + '"'] };
      return { ids: [m[1] + '.' + m[2] + (m[3] ? '.' + m[3] : '')], warnings: w };
    }
    throw new Error('Unknown scheme: ' + scheme);
  }

  /*
   * Resolve a free-text cell to IDs that exist in the tender BQ.
   * knownIds: Set of canonical IDs from BQ_Items (optional).
   * Returns { ids, unmatched, shared, warnings }.
   *   shared = the cell named more than one item (one measurement covering several items) -> flag for review.
   */
  function resolve(text, scheme, knownIds, ctx) {
    var parts = splitRefs(text);
    var out = { ids: [], unmatched: [], shared: false, warnings: [] };
    parts.forEach(function (p) {
      var r = parseOne(p, scheme, ctx);
      out.warnings = out.warnings.concat(r.warnings);
      if (!r.ids.length) { out.unmatched.push(p); return; }
      if (r.candidates) {
        var hit = knownIds ? r.ids.filter(function (id) { return knownIds.has(id); }) : [];
        if (hit.length === 1) out.ids.push(hit[0]);
        else if (!knownIds) out.ids.push(r.ids[0]);
        else out.unmatched.push(p);
        return;
      }
      r.ids.forEach(function (id) {
        if (knownIds && !knownIds.has(id)) out.unmatched.push(id);
        else out.ids.push(id);
      });
    });
    out.ids = out.ids.filter(function (v, i, a) { return a.indexOf(v) === i; });
    out.shared = out.ids.length + out.unmatched.length > 1;
    return out;
  }

  var api = {
    SCHEMES: SCHEMES, normBill: normBill, normPage: normPage, normItem: normItem,
    makeId: makeId, splitRefs: splitRefs, parseOne: parseOne, resolve: resolve
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ItemId = api;
})(this);
