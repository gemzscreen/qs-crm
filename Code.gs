/**
 * QS CRM — API on the Google Sheet "QS CRM DB" (Apps Script, bound to the sheet).
 * v1 module 1: tender register + bid results + activity log.
 *
 * Setup (once):
 *  1. Open the "QS CRM DB" Google Sheet > Extensions > Apps Script. Paste this file as Code.gs. Save.
 *  2. Run setPassword() once (select it in the toolbar, Run). Before running, change the text 'CHANGE-ME' below
 *     to your own password, run, then change it back to 'CHANGE-ME' and save (the password stays in Script Properties).
 *  3. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone > Deploy.
 *     Copy the Web app URL (ends with /exec) into the QS CRM login screen.
 *  Every request must carry the password, so the URL alone gives no access.
 *  After editing this file: Deploy > Manage deployments > Edit > Version: New version (keeps the same URL).
 */

var TABS = { tenders: 'Tenders', bq: 'BQ_Items', asbuilt: 'AsBuilt_Items', log: 'Log', lists: 'Lists' };
var LOCKED_FIELDS = ['our_sum', 'id_scheme'];            // cannot change once the tendered BQ is locked
var EDITABLE = ['tender_ref', 'project_no', 'title', 'title_en', 'client', 'client_group', 'location', 'tender_type', 'id_scheme',
  'site_visit_date', 'closing_date', 'status', 'our_sum', 'completion_period', 'submitted_date', 'workbook_file', 'folder_link', 'notes'];
var STATUSES = ['Prospect', 'Pricing', 'Submitted', 'Won', 'Lost', 'Cancelled', 'No bid'];

function setPassword() {
  var pw = 'CHANGE-ME';
  if (pw === 'CHANGE-ME' || pw.length < 8) throw new Error('Type your own password (8+ characters) in setPassword() first.');
  PropertiesService.getScriptProperties().setProperty('API_PASSWORD_HASH', hash_(pw));
  Logger.log('Password saved. Now change the text back to CHANGE-ME and save.');
}

function doGet() {
  return json_({ ok: true, app: 'QS CRM API', note: 'Use POST' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  var stored = PropertiesService.getScriptProperties().getProperty('API_PASSWORD_HASH');
  if (!stored) return json_({ ok: false, error: 'Password not set - run setPassword() in Apps Script' });
  if (!req.password || hash_(req.password) !== stored) { Utilities.sleep(800); return json_({ ok: false, error: 'Wrong password', auth: false }); }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var fn = ACTIONS[req.action];
    if (!fn) return json_({ ok: false, error: 'Unknown action ' + req.action });
    var data = fn(req);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

var ACTIONS = {
  ping: function () { return { sheet: SpreadsheetApp.getActive().getName(), time: now_() }; },

  /* everything the register screen needs in one call */
  list: function () {
    var t = read_(TABS.tenders);
    var bq = read_(TABS.bq), ab = read_(TABS.asbuilt);
    var lines = {}, asb = {};
    bq.rows.forEach(function (r) { if (r.bq_set === 'Tendered') lines[r.arza_no] = (lines[r.arza_no] || 0) + 1; });
    ab.rows.forEach(function (r) { asb[r.arza_no] = (asb[r.arza_no] || 0) + 1; });
    t.rows.forEach(function (r) { r._bq_lines = lines[r.arza_no] || 0; r._asbuilt_lines = asb[r.arza_no] || 0; });
    return { tenders: t.rows, lists: lists_(), log: read_(TABS.log).rows.slice(-200) };
  },

  /* one tender: record + BQ summary per bill + its log */
  get: function (req) {
    var t = find_(req.arza_no);
    var bills = {}, order = [];
    read_(TABS.bq).rows.forEach(function (r) {
      if (r.arza_no !== req.arza_no || r.bq_set !== 'Tendered') return;
      var k = r.bill || '-';
      if (!bills[k]) { bills[k] = { bill: k, lines: 0, amount: 0 }; order.push(k); }
      bills[k].lines++; bills[k].amount += Number(r.amount) || 0;
    });
    var log = read_(TABS.log).rows.filter(function (r) { return r.arza_no === req.arza_no; });
    return { tender: t.row, bills: order.map(function (k) { bills[k].amount = round2_(bills[k].amount); return bills[k]; }), log: log };
  },

  /* create (no arza_no or new) or update tender fields */
  save: function (req) {
    var f = req.fields || {};
    var t = read_(TABS.tenders);
    var ts = now_();
    if (!req.arza_no) {
      var no = nextNo_(t.rows);
      var row = { arza_no: no, locked: 'N', created_at: ts, updated_at: ts };
      EDITABLE.forEach(function (k) { if (f[k] != null) row[k] = f[k]; });
      check_(row);
      append_(TABS.tenders, row);
      log_('create', no, 'New tender ' + (row.tender_ref || row.title || ''));
      return find_(no).row;
    }
    var cur = find_(req.arza_no);
    var changes = [];
    EDITABLE.forEach(function (k) {
      if (!(k in f)) return;
      var nv = f[k] == null ? '' : f[k], ov = cur.row[k] == null ? '' : cur.row[k];
      if (String(nv) === String(ov)) return;
      if (cur.row.locked === 'Y' && LOCKED_FIELDS.indexOf(k) >= 0) throw new Error(k + ' is locked (tendered BQ locked ' + cur.row.locked_at + ')');
      cur.row[k] = nv; changes.push(k + ': ' + short_(ov) + ' -> ' + short_(nv));
    });
    if (!changes.length) return cur.row;
    if (f.status === 'Submitted' && !cur.row.submitted_date) cur.row.submitted_date = ts.slice(0, 10);
    check_(cur.row);
    cur.row.updated_at = ts;
    write_(TABS.tenders, cur.idx, cur.row);
    log_('update', req.arza_no, changes.join('; '));
    return cur.row;
  },

  /* lock the tendered BQ (normally at submission) */
  lock: function (req) {
    var cur = find_(req.arza_no);
    if (cur.row.locked === 'Y') return cur.row;
    var ts = now_();
    cur.row.locked = 'Y'; cur.row.locked_at = ts; cur.row.updated_at = ts;
    if (!cur.row.status || ['Prospect', 'Pricing'].indexOf(cur.row.status) >= 0) cur.row.status = 'Submitted';
    if (!cur.row.submitted_date) cur.row.submitted_date = ts.slice(0, 10);
    write_(TABS.tenders, cur.idx, cur.row);
    log_('lock', req.arza_no, 'Tendered BQ locked, sum B$' + fmt_(cur.row.our_sum) + (req.reason ? ' - ' + req.reason : ''));
    return cur.row;
  },

  /* unlock needs a reason (kept in the log) */
  unlock: function (req) {
    if (!req.reason || String(req.reason).trim().length < 5) throw new Error('Give a reason to unlock');
    var cur = find_(req.arza_no);
    cur.row.locked = 'N'; cur.row.locked_at = ''; cur.row.updated_at = now_();
    write_(TABS.tenders, cur.idx, cur.row);
    log_('unlock', req.arza_no, req.reason);
    return cur.row;
  },

  /* bid result: Won / Lost / Cancelled / No bid + winner & winning sum */
  result: function (req) {
    var r = req.result || {};
    if (['Won', 'Lost', 'Cancelled', 'No bid'].indexOf(r.status) < 0) throw new Error('Result must be Won, Lost, Cancelled or No bid');
    var cur = find_(req.arza_no), row = cur.row;
    row.status = r.status;
    row.result_date = r.result_date || now_().slice(0, 10);
    row.winner = r.status === 'Won' ? 'ARZA SDN BHD' : (r.winner || '');
    row.winning_sum = r.status === 'Won' ? row.our_sum : (r.winning_sum === '' || r.winning_sum == null ? '' : Number(r.winning_sum));
    row.diff_pct = (row.winning_sum !== '' && Number(row.winning_sum) > 0 && Number(row.our_sum) > 0)
      ? Math.round((Number(row.our_sum) - Number(row.winning_sum)) / Number(row.winning_sum) * 10000) / 10000 : '';
    row.result_source = r.result_source || '';
    if (r.notes) row.notes = (row.notes ? row.notes + ' | ' : '') + r.notes;
    row.updated_at = now_();
    write_(TABS.tenders, cur.idx, row);
    log_('result', req.arza_no, r.status + (row.winner ? ', winner ' + row.winner : '') + (row.winning_sum !== '' ? ', B$' + fmt_(row.winning_sum) : '') + (row.diff_pct !== '' ? ', ours ' + (row.diff_pct * 100).toFixed(1) + '%' : ''));
    return row;
  }
};

/* ---------- sheet helpers (columns read by header name) ---------- */
function sheet_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" not found');
  return sh;
}
function read_(name) {
  var v = sheet_(name).getDataRange().getValues();
  var head = v[0].map(String), rows = [];
  for (var i = 1; i < v.length; i++) {
    if (v[i].every(function (c) { return c === '' || c == null; })) continue;
    var o = { _row: i + 1 };
    head.forEach(function (h, c) { if (h) o[h] = cell_(v[i][c]); });
    rows.push(o);
  }
  return { head: head, rows: rows };
}
function cell_(x) {
  if (x instanceof Date) {
    var tz = Session.getScriptTimeZone();
    var hm = Utilities.formatDate(x, tz, 'HH:mm');
    return Utilities.formatDate(x, tz, 'yyyy-MM-dd') + (hm === '00:00' ? '' : ' ' + hm);
  }
  return x;
}
function find_(no) {
  var t = read_(TABS.tenders);
  for (var i = 0; i < t.rows.length; i++) if (t.rows[i].arza_no === no) return { idx: t.rows[i]._row, row: t.rows[i], head: t.head };
  throw new Error('Tender ' + no + ' not found');
}
function write_(name, rowNo, obj) {
  var sh = sheet_(name), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(rowNo, 1, 1, head.length).setValues([head.map(function (h) { return obj[h] == null ? '' : obj[h]; })]);
}
function append_(name, obj) {
  var sh = sheet_(name), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(head.map(function (h) { return obj[h] == null ? '' : obj[h]; }));
}
function lists_() {
  var v = sheet_(TABS.lists).getDataRange().getValues(), out = {};
  (v[0] || []).forEach(function (h, c) {
    if (!h) return;
    out[h] = [];
    for (var r = 1; r < v.length; r++) if (v[r][c] !== '' && v[r][c] != null) out[h].push(String(v[r][c]));
  });
  return out;
}
function log_(action, no, detail) {
  append_(TABS.log, { timestamp: now_(), action: action, arza_no: no, detail: detail, user: 'Gemz' });
}
function nextNo_(rows) {
  var max = 0;
  rows.forEach(function (r) { var m = String(r.arza_no).match(/^T(\d+)$/); if (m) max = Math.max(max, +m[1]); });
  var n = max + 1;
  return 'T' + (n < 10 ? '0' : '') + n;
}
function check_(row) {
  if (row.status && STATUSES.indexOf(row.status) < 0) throw new Error('Unknown status ' + row.status);
  if (row.our_sum !== '' && row.our_sum != null && isNaN(Number(row.our_sum))) throw new Error('Our sum must be a number');
  if (!row.title && !row.tender_ref) throw new Error('Give at least a title or the client tender ref');
}
function now_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'); }
function hash_(s) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'qs-crm|' + s, Utilities.Charset.UTF_8));
}
function round2_(x) { return Math.round(x * 100) / 100; }
function fmt_(x) { return (Number(x) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function short_(x) { x = String(x == null ? '' : x); return x.length > 40 ? x.slice(0, 37) + '...' : (x || '(blank)'); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
