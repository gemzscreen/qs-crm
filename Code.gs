/**
 * QS CRM — API on the Google Sheet "QS CRM DB" (Apps Script, bound to the sheet).
 * v1.3.1 - tender register, bid results, activity log, workbook import and Google Drive file storage.
 * Each save is one call (log entries returned with the row).
 *
 * Setup (once):
 *  1. Open the "QS CRM DB" Google Sheet > Extensions > Apps Script. Paste this file as Code.gs. Save.
 *  2. Run setPassword() once (select it in the toolbar, Run). Before running, change the text 'CHANGE-ME' below
 *     to your own password, run, then change it back to 'CHANGE-ME' and save (the password stays in Script Properties).
 *  2b. Google Drive (for tender files): in setDriveFolder() paste the link of YOUR Drive folder, then Run it and
 *      allow Google Drive access. Each tender gets a sub-folder inside it (e.g. "T11 - JKR-DBSBM021-2026").
 *      Leave the link as PASTE-FOLDER-LINK to let the script make a folder "QS CRM - Tenders" in My Drive instead.
 *      If Run shows "An unknown error has occurred": open the sheet in an Incognito / private window signed in
 *      ONLY to the Google account that owns the sheet, then run it again (several signed-in accounts break the
 *      permission screen).
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

var LOGS_ = [];   // log entries written during this request, returned to the app (saves a second call)

function doPost(e) {
  var req;
  LOGS_ = [];
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
    if (data && typeof data === 'object' && !Array.isArray(data)) data._log = LOGS_;
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

var ACTIONS = {
  ping: function () { return { sheet: SpreadsheetApp.getActive().getName(), time: now_() }; },

  /* where tender files go (for the app's messages) */
  driveInfo: function () {
    var id = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_ID');
    if (!id) return { set: false };
    try { var f = DriveApp.getFolderById(id); return { set: true, name: f.getName(), url: f.getUrl() }; }
    catch (e) { return { set: false, error: 'Drive not authorised or folder not found - run setDriveFolder() in Apps Script' }; }
  },

  /* everything the register screen needs in one call */
  list: function () {
    var t = read_(TABS.tenders);
    var bq = read_(TABS.bq), ab = read_(TABS.asbuilt);
    var lines = {}, asb = {};
    bq.rows.forEach(function (r) { if (r.bq_set === 'Tendered') lines[r.arza_no] = (lines[r.arza_no] || 0) + 1; });
    ab.rows.forEach(function (r) { asb[r.arza_no] = (asb[r.arza_no] || 0) + 1; });
    t.rows.forEach(function (r) { r._bq_lines = lines[r.arza_no] || 0; r._asbuilt_lines = asb[r.arza_no] || 0; });
    var dId = PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_ID');
    return { tenders: t.rows, lists: lists_(), log: read_(TABS.log).rows.slice(-200), drive: dId ? 'https://drive.google.com/drive/folders/' + dId : '' };
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

  /* create (no arza_no) or update tender fields; req.lock = true also locks the BQ in the same call */
  save: function (req) {
    var row = saveFields_(req);
    if (req.lock && row.locked !== 'Y') return ACTIONS.lock({ arza_no: row.arza_no });
    return row;
  },

  /* new tender from a priced workbook read in the browser: tender row + tendered BQ lines + file to Drive, one call */
  importTender: function (req) {
    var t = read_(TABS.tenders), f = req.fields || {}, ts = now_();
    var want = String(req.arza_no || '');
    var taken = t.rows.some(function (r) { return r.arza_no === want; });
    var no = (/^T\d+$/.test(want) && !taken) ? want : nextNo_(t.rows);
    var row = { arza_no: no, locked: 'N', created_at: ts, updated_at: ts };
    EDITABLE.forEach(function (k) { if (f[k] != null) row[k] = f[k]; });
    check_(row);
    if (req.file) saveFile_(row, req.file);
    append_(TABS.tenders, row);
    var n = writeBQ_(no, req.items || [], ts, false);
    log_('import', no, 'Imported ' + (req.file ? req.file.name : 'workbook') + ': ' + n + ' BQ lines, B$' + fmt_(row.our_sum) +
      (row.folder_link ? '; file saved to Drive' : '') + (want && taken ? '; ' + want + ' was taken, used ' + no : ''));
    row._bq_lines = n;
    return row;
  },

  /* store a file in the tender's Drive folder; optionally replace the tendered BQ (only when not locked) */
  uploadFile: function (req) {
    var cur = find_(req.arza_no), row = cur.row, ts = now_(), msg = [];
    if (req.replaceBQ) {
      if (row.locked === 'Y') throw new Error('Tendered BQ is locked - unlock first to replace it');
      var n = writeBQ_(row.arza_no, req.items || [], ts, true);
      if (req.our_sum != null && req.our_sum !== '') row.our_sum = Number(req.our_sum);
      if (req.id_scheme) row.id_scheme = req.id_scheme;
      row._bq_lines = n;
      msg.push('tendered BQ replaced: ' + n + ' lines, B$' + fmt_(row.our_sum));
    }
    if (req.file) { saveFile_(row, req.file); msg.unshift(req.file.name + ' saved to Drive'); }
    row.updated_at = ts;
    write_(TABS.tenders, cur.idx, row);
    log_('file', row.arza_no, msg.join('; '));
    return row;
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

function saveFields_(req) {
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
  }

/* ---------- Google Drive ---------- */
/* Run once: choose the Drive folder for tender files (this also asks for Drive permission). */
function setDriveFolder() {
  var link = 'PASTE-FOLDER-LINK';   // e.g. https://drive.google.com/drive/folders/1AbC...xyz
  var p = PropertiesService.getScriptProperties();
  Logger.log('Step 1/3: checking Drive access ...');
  var root = DriveApp.getRootFolder();
  Logger.log('Step 1/3 OK: My Drive = ' + root.getName());
  if (link === 'PASTE-FOLDER-LINK' || !link) {
    var f = rootFolder_();
    Logger.log('Step 2/3: no link given - tender files go to "' + f.getName() + '": ' + f.getUrl());
  } else {
    var m = String(link).match(/folders\/([\w-]+)/) || String(link).match(/^([\w-]{20,})$/) || String(link).match(/[?&]id=([\w-]+)/);
    if (!m) throw new Error('That is not a Drive folder link. Open the folder in Drive and copy the address bar.');
    Logger.log('Step 2/3: opening your folder ' + m[1] + ' ...');
    var mine = DriveApp.getFolderById(m[1]);
    p.setProperty('DRIVE_ROOT_ID', m[1]);
    Logger.log('Step 2/3 OK: tender files will go to "' + mine.getName() + '": ' + mine.getUrl());
  }
  Logger.log('Step 3/3: done. Now Deploy > Manage deployments > Edit > Version: New version > Deploy.');
}
function authorizeDrive() { setDriveFolder(); }
function rootFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('DRIVE_ROOT_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('QS CRM - Tenders');
  p.setProperty('DRIVE_ROOT_ID', f.getId());
  return f;
}
function tenderFolder_(row) {
  var m = String(row.folder_link || '').match(/folders\/([\w-]+)/);
  if (m) { try { return DriveApp.getFolderById(m[1]); } catch (e) {} }
  var name = row.arza_no + (row.tender_ref ? ' - ' + String(row.tender_ref).replace(/[\/\\:*?"<>|]+/g, '-') : '');
  return rootFolder_().createFolder(name);
}
function saveFile_(row, file) {
  if (!file || !file.data) return null;
  var folder;
  try { folder = tenderFolder_(row); }
  catch (e) { throw new Error('Google Drive is not set up yet (' + e.message + '). In Apps Script run setDriveFolder(), then deploy a New version.'); }
  var blob = Utilities.newBlob(Utilities.base64Decode(file.data), file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file.name);
  var f = folder.createFile(blob);
  row.folder_link = folder.getUrl();
  row.workbook_file = file.name;
  return f;
}

/* ---------- BQ lines ---------- */
var TEXT_COLS = ['item_id', 'bill', 'page', 'item'];   // keep "1.10" as text, not the number 1.1
function writeBQ_(no, items, ts, replace) {
  var sh = sheet_(TABS.bq), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (replace) {
    var all = sh.getDataRange().getValues(), ia = head.indexOf('arza_no'), is = head.indexOf('bq_set');
    var keep = all.slice(1).filter(function (r) { return !(r[ia] === no && r[is] === 'Tendered'); });
    if (all.length > 1) sh.getRange(2, 1, all.length - 1, head.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, head.length).setValues(keep);
  }
  if (!items.length) return 0;
  var start = Math.max(sh.getLastRow(), 1) + 1;
  TEXT_COLS.forEach(function (c) { var i = head.indexOf(c); if (i >= 0) sh.getRange(start, i + 1, items.length, 1).setNumberFormat('@'); });
  var rows = items.map(function (it) {
    var o = { arza_no: no, bq_set: 'Tendered', imported_at: ts,
      provisional: /provisional|prov\.? sum/i.test((it.heading || '') + ' ' + (it.description || '') + ' ' + (it.remarks || '')) ? 'Y' : 'N' };
    ['item_id', 'bill', 'page', 'item', 'heading', 'description', 'unit', 'qty', 'rate', 'amount', 'remarks', 'source'].forEach(function (k) { o[k] = it[k]; });
    return head.map(function (h) { return o[h] == null ? '' : o[h]; });
  });
  sh.getRange(start, 1, rows.length, head.length).setValues(rows);
  return rows.length;
}

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
  var e = { timestamp: now_(), action: action, arza_no: no, detail: detail, user: 'Gemz' };
  append_(TABS.log, e);
  LOGS_.push(e);
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
