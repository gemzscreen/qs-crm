/*
 * QS CRM — read tender register fields from a tender workbook (SheetJS).
 * Standard: "Tender Info" sheet, labels in column A (value = first filled cell to the right).
 * Legacy quotations (T03–T07): title block on "Final Summary" / "BQ" (PROJECT:, QUOTATION NO.:, CLIENT:, CLOSING DATE:).
 * Values that start with "Not stated" / "Not printed" are left blank.
 */
(function (root) {
  'use strict';

  var FIELDS = [
    ['tender_ref', /^(tender no\.?|quotation ref\.?|quotation no\.?:?)$/i],
    ['project_no', /^project no\.?$/i],
    ['title', /^(title \(as issued\)|project:?)$/i],
    ['title_en', /^title \(english\)$/i],
    ['client', /^(issuing authority|client:?)$/i],
    ['closing_raw', /^(closing date & time.*|closing date:?|closing)$/i],
    ['completion_period', /^(completion period offered|delivery & installation period offered)$/i],
    ['completion_assumed', /^(contract \/ completion period|delivery \/ completion period)$/i],
    ['location', /^(building|buildings|building owner \/ user)$/i]
  ];

  function blankIfNotStated(v) {
    var s = String(v == null ? '' : v).trim();
    return /^not (stated|printed)/i.test(s) ? '' : s;
  }

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* "26/10/2026, 9.00 am" | "14 November 2026, 2.00 pm" -> "2026-10-26 09:00" */
  function parseDate(s) {
    s = String(s || '');
    var d, m, y, t = '';
    var a = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    var b = s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/);
    if (a) { d = +a[1]; m = +a[2]; y = +a[3]; }
    else if (b && MONTHS[b[2].toLowerCase()]) { d = +b[1]; m = MONTHS[b[2].toLowerCase()]; y = +b[3]; }
    else return '';
    var tm = s.match(/(\d{1,2})[.:](\d{2})\s*(am|pm)/i);
    if (tm) { var h = +tm[1] % 12 + (/pm/i.test(tm[3]) ? 12 : 0); t = ' ' + pad(h) + ':' + tm[2]; }
    return y + '-' + pad(m) + '-' + pad(d) + t;
  }

  function scan(XLSX, ws, out) {
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    rows.slice(0, 90).forEach(function (r) {
      var label = String(r[0] || '').trim();
      if (!label) return;
      FIELDS.forEach(function (f) {
        if (out[f[0]] || !f[1].test(label)) return;
        for (var c = 1; c < Math.min(r.length, 5); c++) {
          var v = String(r[c] || '').trim();
          if (v) { out[f[0]] = blankIfNotStated(v); return; }
        }
      });
    });
  }

  function clientGroup(client, ref) {
    var s = (client || '') + ' ' + (ref || '');
    if (/kesihatan|ministry of health|\bMOH\b/i.test(s)) return 'MOH';
    if (/pendidikan|ministry of education|JPPE|\bMOE\b/i.test(s)) return 'MOE';
    if (/kerja raya|\bJKR\b|public works/i.test(s)) return 'JKR';
    return client ? 'Other' : '';
  }

  /* -> { tender_ref, project_no, title, title_en, client, client_group, closing_date, completion_period, location } */
  function readInfo(wb, opts) {
    var XLSX = (opts && opts.XLSX) || root.XLSX, out = {};
    var info = wb.SheetNames.filter(function (n) { return /^tender info/i.test(n.trim()); });
    var legacy = wb.SheetNames.filter(function (n) { return /^(final summary|bq|boq|sow|soq(-\d+)?)$/i.test(n.trim()); });
    info.concat(legacy).forEach(function (n) { scan(XLSX, wb.Sheets[n], out); });
    out.tender_ref = String(out.tender_ref || '').split(/\s{2,}/)[0].replace(/\s*\/\s*/g, '/').trim();
    out.client_group = clientGroup(out.client, out.tender_ref);
    out.closing_date = parseDate(out.closing_raw);
    if (!out.completion_period && out.completion_assumed) out.completion_period = '';
    delete out.closing_raw; delete out.completion_assumed;
    Object.keys(out).forEach(function (k) { if (out[k] == null) out[k] = ''; });
    return out;
  }

  var api = { readInfo: readInfo, parseDate: parseDate, clientGroup: clientGroup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TenderInfo = api;
})(this);
