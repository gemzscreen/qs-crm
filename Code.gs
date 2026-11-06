/**
 * QS CRM — API on the Google Sheet "QS CRM DB" (Apps Script, bound to the sheet).
 * v2.0.0 - tender register, rationalized BQ revisions (R1, R2 … with approval record), as-built (Breakdown QTY) sets,
 *          bid results, activity log, workbook import and Google Drive file storage.
 * v2: the Revisions tab and the contract_sum / contract_rev columns on Tenders are added automatically on the first call.
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

var TABS = { tenders: 'Tenders', bq: 'BQ_Items', asbuilt: 'AsBuilt_Items', log: 'Log', lists: 'Lists', rev: 'Revisions' };
var REV_COLS = ['arza_no', 'rev', 'status', 'based_on', 'description', 'lines', 'rev_sum', 'base_sum', 'tender_sum', 'approved_date',
  'arza_rep', 'client_rep', 'client_org', 'letter_ref', 'document', 'doc_link', 'approved_at', 'void_reason', 'notes', 'created_at', 'updated_at'];
var SCHEMA_VER = '2';
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
    ensureSchema_();
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
    var bq = read_(TABS.bq), ab = read_(TABS.asbuilt), rv = read_(TABS.rev);
    var lines = {}, asb = {}, revs = {}, draft = {};
    bq.rows.forEach(function (r) { if (r.bq_set === 'Tendered') lines[r.arza_no] = (lines[r.arza_no] || 0) + 1; });
    ab.rows.forEach(function (r) { asb[r.arza_no] = (asb[r.arza_no] || 0) + 1; });
    rv.rows.forEach(function (r) { if (r.status !== 'Void') revs[r.arza_no] = (revs[r.arza_no] || 0) + 1; if (r.status === 'Draft') draft[r.arza_no] = r.rev; });
    t.rows.forEach(function (r) { r._bq_lines = lines[r.arza_no] || 0; r._asbuilt_lines = asb[r.arza_no] || 0; r._revs = revs[r.arza_no] || 0; r._draft = draft[r.arza_no] || ''; });
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
    return { tender: t.row, bills: order.map(function (k) { bills[k].amount = round2_(bills[k].amount); return bills[k]; }), log: log,
      revisions: revs_(req.arza_no) };
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
      if (revs_(row.arza_no).some(function (r) { return r.status !== 'Void'; })) throw new Error('Rationalized revisions exist for ' + row.arza_no + ' - the tendered BQ cannot be replaced');
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

  /* everything the As-built screen needs for one tender: tendered BQ lines + all as-built lines */
  asBuiltData: function (req) {
    var no = req.arza_no, bq = read_(TABS.bq).rows, cur = currentRev_(no);
    return {
      items: bq.filter(function (r) { return r.arza_no === no && r.bq_set === 'Tendered'; }),
      revision: cur,
      revLines: cur ? bq.filter(function (r) { return r.arza_no === no && r.bq_set === cur.rev; }) : [],
      rows: read_(TABS.asbuilt).rows.filter(function (r) { return r.arza_no === no; })
    };
  },

  /* save one measure set (replaces a set with the same name) */
  importAsBuilt: function (req) {
    var cur = find_(req.arza_no), set = String(req.measure_set || '').trim(), ts = now_();
    if (!set) throw new Error('Give the measure set a name');
    var rows = (req.rows || []).map(function (r) {
      var o = {}; for (var k in r) o[k] = r[k];
      o.arza_no = req.arza_no; o.measure_set = set; o.imported_at = ts; o.source_file = req.file ? req.file.name : (r.source_file || '');
      return o;
    });
    var n = replaceRows_(TABS.asbuilt, function (r) { return r.arza_no === req.arza_no && r.measure_set === set; }, rows, ['item_ref_raw', 'item_id']);
    var msg = set + ': ' + rows.length + ' lines (' + n.removed + ' replaced)';
    if (req.stats) msg += ' - ' + ['Matched', 'Shared', 'Unmatched', 'VO?'].map(function (k) { return (req.stats[k] || 0) + ' ' + k; }).join(', ');
    if (req.file) { saveFile_(cur.row, req.file); cur.row.updated_at = ts; write_(TABS.tenders, cur.idx, cur.row); msg += '; file saved to Drive'; }
    log_('asbuilt', req.arza_no, msg);
    return { arza_no: req.arza_no, measure_set: set, lines: rows.length, folder_link: cur.row.folder_link || '' };
  },

  deleteMeasureSet: function (req) {
    var set = String(req.measure_set || '');
    var n = replaceRows_(TABS.asbuilt, function (r) { return r.arza_no === req.arza_no && r.measure_set === set; }, [], []);
    log_('asbuilt', req.arza_no, 'Deleted measure set ' + set + ' (' + n.removed + ' lines)');
    return { removed: n.removed };
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
    var live = revs_(req.arza_no).filter(function (r) { return r.status !== 'Void'; });
    if (live.length) throw new Error('Revision ' + live.map(function (r) { return r.rev; }).join(', ') + ' exists - the tendered BQ stays locked (delete the draft / void the revision first)');
    cur.row.locked = 'N'; cur.row.locked_at = ''; cur.row.updated_at = now_();
    write_(TABS.tenders, cur.idx, cur.row);
    log_('unlock', req.arza_no, req.reason);
    return cur.row;
  },

  /* ---------- v2: rationalized revisions ---------- */
  /* everything the Rationalized BQ page needs for one tender */
  revData: function (req) {
    var no = req.arza_no, bq = read_(TABS.bq).rows.filter(function (r) { return r.arza_no === no; });
    return {
      tender: find_(no).row,
      items: bq.filter(function (r) { return r.bq_set === 'Tendered'; }),
      lines: bq.filter(function (r) { return r.bq_set !== 'Tendered'; }),
      revisions: revs_(no)
    };
  },

  /* create (no rev) or update a Draft revision: record + all its lines, one call */
  saveRevision: function (req) {
    var t = find_(req.arza_no), no = t.row.arza_no, ts = now_(), m = req.meta || {};
    if (t.row.locked !== 'Y') throw new Error('Lock the tendered BQ of ' + no + ' first - revisions are made after submission');
    var all = revs_(no), rec;
    if (!req.rev) {
      var dr = all.filter(function (r) { return r.status === 'Draft'; })[0];
      if (dr) throw new Error(dr.rev + ' is still a draft - approve or delete it before starting another revision');
      var cur = currentRev_(no);
      rec = { arza_no: no, rev: nextRev_(all), status: 'Draft', based_on: cur ? cur.rev : 'Tendered', created_at: ts };
    } else {
      rec = all.filter(function (r) { return r.rev === req.rev; })[0];
      if (!rec) throw new Error('Revision ' + req.rev + ' not found');
      if (rec.status !== 'Draft') throw new Error(rec.rev + ' is ' + rec.status + ' and locked - start a new revision instead');
    }
    var items = cleanLines_(req.items || []);
    if (!items.length) throw new Error('A revision needs at least one BQ line');
    ['description', 'notes'].forEach(function (k) { if (m[k] != null) rec[k] = String(m[k]).trim(); });
    if (!rec.description) throw new Error('Describe the revision (e.g. "Rationalization to budget, JKR letter …")');
    var rows = items.map(function (it) { return bqRow_(no, rec.rev, it, ts); });
    var n = replaceRows_(TABS.bq, function (r) { return r.arza_no === no && r.bq_set === rec.rev; }, rows, TEXT_COLS);
    rec.lines = rows.length;
    rec.rev_sum = round2_(rows.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0));
    rec.base_sum = setSum_(no, rec.based_on);
    rec.tender_sum = Number(t.row.our_sum) || '';
    rec.updated_at = ts;
    if (req.file) { var f = saveFile_(t.row, req.file, true); write_(TABS.tenders, t.idx, t.row); if (f) rec.notes = (rec.notes ? rec.notes + ' | ' : '') + 'Workbook: ' + req.file.name; }
    upsertRev_(rec);
    log_('revision', no, (n.removed ? 'Updated draft ' : 'New draft ') + rec.rev + ' (from ' + rec.based_on + '): ' + rec.lines + ' lines, B$' + fmt_(rec.rev_sum) +
      ' (' + diffTxt_(rec.rev_sum, rec.base_sum) + ' vs ' + rec.based_on + ')' + (req.file ? '; ' + req.file.name : ''));
    return { revision: rec, tender: t.row };
  },

  /* approval record (both parties) - locks the revision and makes it the contract BQ */
  approveRevision: function (req) {
    var t = find_(req.arza_no), no = t.row.arza_no, a = req.approval || {}, ts = now_();
    var rec = revs_(no).filter(function (r) { return r.rev === req.rev; })[0];
    if (!rec) throw new Error('Revision ' + req.rev + ' not found');
    if (rec.status !== 'Draft') throw new Error(rec.rev + ' is already ' + rec.status);
    var need = { approved_date: 'approval date', arza_rep: 'ARZA representative', client_rep: 'client representative', letter_ref: 'letter / document ref' };
    Object.keys(need).forEach(function (k) { if (!String(a[k] || '').trim()) throw new Error('Give the ' + need[k]); });
    if (!(Number(rec.lines) > 0)) throw new Error(rec.rev + ' has no BQ lines');
    ['approved_date', 'arza_rep', 'client_rep', 'client_org', 'letter_ref'].forEach(function (k) { rec[k] = String(a[k] || '').trim(); });
    if (a.notes) rec.notes = (rec.notes ? rec.notes + ' | ' : '') + String(a.notes).trim();
    if (req.file) { var f = saveFile_(t.row, req.file, true); if (f) { rec.document = req.file.name; rec.doc_link = f.getUrl(); } }
    rec.status = 'Approved'; rec.approved_at = ts; rec.updated_at = ts;
    upsertRev_(rec);
    t.row.contract_sum = rec.rev_sum; t.row.contract_rev = rec.rev; t.row.updated_at = ts;
    write_(TABS.tenders, t.idx, t.row);
    log_('approve', no, rec.rev + ' approved ' + rec.approved_date + ', ref ' + rec.letter_ref + ' (ARZA: ' + rec.arza_rep + '; client: ' + rec.client_rep +
      (rec.client_org ? ', ' + rec.client_org : '') + '). Contract sum B$' + fmt_(rec.rev_sum) + ' (' + diffTxt_(rec.rev_sum, rec.tender_sum) + ' vs tendered)' +
      (rec.document ? '; document ' + rec.document : '; no document attached'));
    return { revision: rec, tender: t.row };
  },

  /* delete a Draft revision (lines and record) */
  deleteRevision: function (req) {
    var no = req.arza_no, rec = revs_(no).filter(function (r) { return r.rev === req.rev; })[0];
    if (!rec) throw new Error('Revision ' + req.rev + ' not found');
    if (rec.status !== 'Draft') throw new Error(rec.rev + ' is ' + rec.status + ' - only drafts can be deleted (void an approved revision instead)');
    var n = replaceRows_(TABS.bq, function (r) { return r.arza_no === no && r.bq_set === rec.rev; }, [], []);
    replaceRows_(TABS.rev, function (r) { return r.arza_no === no && r.rev === rec.rev; }, [], []);
    log_('revision', no, 'Deleted draft ' + rec.rev + ' (' + n.removed + ' lines)');
    return { removed: n.removed };
  },

  /* void the latest approved revision (mistake / superseded agreement) - needs a reason, lines are kept */
  voidRevision: function (req) {
    if (!req.reason || String(req.reason).trim().length < 5) throw new Error('Give a reason to void the revision');
    var t = find_(req.arza_no), no = t.row.arza_no, all = revs_(no), cur = currentRev_(no);
    if (!cur || cur.rev !== req.rev) throw new Error('Only the latest approved revision' + (cur ? ' (' + cur.rev + ')' : '') + ' can be voided');
    var dr = all.filter(function (r) { return r.status === 'Draft'; })[0];
    if (dr) throw new Error('Delete draft ' + dr.rev + ' first (it is based on ' + dr.based_on + ')');
    cur.status = 'Void'; cur.void_reason = String(req.reason).trim(); cur.updated_at = now_();
    upsertRev_(cur);
    var prev = currentRev_(no);
    t.row.contract_sum = prev ? prev.rev_sum : ''; t.row.contract_rev = prev ? prev.rev : ''; t.row.updated_at = cur.updated_at;
    write_(TABS.tenders, t.idx, t.row);
    log_('void', no, cur.rev + ' voided: ' + cur.void_reason + '. Contract BQ is now ' + (prev ? prev.rev + ' B$' + fmt_(prev.rev_sum) : 'the tendered BQ'));
    return { revision: cur, tender: t.row };
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
function saveFile_(row, file, otherDoc) {   // otherDoc: a revision workbook / approval letter - keeps workbook_file as it is
  if (!file || !file.data) return null;
  var folder;
  try { folder = tenderFolder_(row); }
  catch (e) { throw new Error('Google Drive is not set up yet (' + e.message + '). In Apps Script run setDriveFolder(), then deploy a New version.'); }
  var blob = Utilities.newBlob(Utilities.base64Decode(file.data), file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file.name);
  var f = folder.createFile(blob);
  row.folder_link = folder.getUrl();
  if (!otherDoc) row.workbook_file = file.name;
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

/* one BQ_Items row object (Tendered or a revision set) */
function bqRow_(no, set, it, ts) {
  var o = { arza_no: no, bq_set: set, imported_at: ts,
    provisional: /provisional|prov\.? sum/i.test((it.heading || '') + ' ' + (it.description || '') + ' ' + (it.remarks || '')) ? 'Y' : 'N' };
  ['item_id', 'bill', 'page', 'item', 'heading', 'description', 'unit', 'qty', 'rate', 'amount', 'remarks', 'source'].forEach(function (k) { o[k] = it[k] == null ? '' : it[k]; });
  return o;
}
/* revision lines from the app: unique item_id, numbers checked, amount = qty x rate */
function cleanLines_(items) {
  var seen = {}, out = [];
  items.forEach(function (it, i) {
    var id = String(it.item_id || '').trim();
    if (!id) throw new Error('Line ' + (i + 1) + ' has no item ID');
    if (seen[id]) throw new Error('Item ID ' + id + ' is used twice');
    seen[id] = 1;
    var q = numOrBlank_(it.qty, id, 'qty'), r = numOrBlank_(it.rate, id, 'rate'), a = numOrBlank_(it.amount, id, 'amount');
    if (q !== '' && r !== '') a = round2_(q * r);
    var o = {}; for (var k in it) o[k] = it[k];
    o.item_id = id; o.qty = q; o.rate = r; o.amount = a === '' ? 0 : a;
    out.push(o);
  });
  return out;
}
function numOrBlank_(v, id, what) {
  if (v === '' || v == null) return '';
  var n = Number(String(v).replace(/,/g, ''));
  if (isNaN(n)) throw new Error(id + ': ' + what + ' "' + v + '" is not a number');
  return n;
}
function revs_(no) {
  return read_(TABS.rev).rows.filter(function (r) { return r.arza_no === no; })
    .sort(function (a, b) { return revN_(a.rev) - revN_(b.rev); });
}
function revN_(r) { var m = String(r || '').match(/^R(\d+)$/i); return m ? +m[1] : 0; }
function nextRev_(all) { var mx = 0; all.forEach(function (r) { mx = Math.max(mx, revN_(r.rev)); }); return 'R' + (mx + 1); }
function currentRev_(no) {
  var a = revs_(no).filter(function (r) { return r.status === 'Approved'; });
  return a.length ? a[a.length - 1] : null;
}
function setSum_(no, set) {
  return round2_(read_(TABS.bq).rows.reduce(function (s, r) { return s + (r.arza_no === no && r.bq_set === set ? (Number(r.amount) || 0) : 0); }, 0));
}
function upsertRev_(rec) {
  var rv = read_(TABS.rev), hit = rv.rows.filter(function (r) { return r.arza_no === rec.arza_no && r.rev === rec.rev; })[0];
  if (hit) write_(TABS.rev, hit._row, rec); else append_(TABS.rev, rec);
}
function diffTxt_(a, b) {
  a = Number(a) || 0; b = Number(b) || 0; var d = round2_(a - b);
  return (d >= 0 ? '+' : '-') + 'B$' + fmt_(Math.abs(d)) + (b ? ', ' + (d >= 0 ? '+' : '') + (d / b * 100).toFixed(2) + '%' : '');
}

/* v2 schema: add the Revisions tab and new Tenders columns once (keeps existing data) */
function ensureSchema_() {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('SCHEMA_VER') === SCHEMA_VER) return;
  var ss = SpreadsheetApp.getActive(), rs = ss.getSheetByName(TABS.rev);
  if (!rs) { rs = ss.insertSheet(TABS.rev); rs.getRange(1, 1, 1, REV_COLS.length).setValues([REV_COLS]); rs.setFrozenRows(1); rs.getRange('B:B').setNumberFormat('@'); }
  else addCols_(rs, REV_COLS);
  addCols_(sheet_(TABS.tenders), ['contract_sum', 'contract_rev']);
  p.setProperty('SCHEMA_VER', SCHEMA_VER);
}
function addCols_(sh, cols) {
  var last = sh.getLastColumn(), head = last ? sh.getRange(1, 1, 1, last).getValues()[0].map(String) : [];
  var miss = cols.filter(function (c) { return head.indexOf(c) < 0; });
  if (!miss.length) return;
  var need = last + miss.length - sh.getMaxColumns();
  if (need > 0) sh.insertColumnsAfter(sh.getMaxColumns(), need);
  sh.getRange(1, last + 1, 1, miss.length).setValues([miss]);
}

/* remove rows matching dropFn (by header name), then append new row objects; textCols are stored as text */
function replaceRows_(tab, dropFn, newRows, textCols) {
  var sh = sheet_(tab), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  var all = sh.getDataRange().getValues(), removed = 0;
  if (all.length > 1) {
    var keep = all.slice(1).filter(function (r) {
      if (r.every(function (c) { return c === '' || c == null; })) return false;
      var o = {}; head.forEach(function (h, i) { o[h] = r[i]; });
      if (dropFn(o)) { removed++; return false; } return true;
    });
    if (removed) {
      sh.getRange(2, 1, all.length - 1, head.length).clearContent();
      if (keep.length) sh.getRange(2, 1, keep.length, head.length).setValues(keep);
    }
  }
  if (newRows.length) {
    var start = Math.max(sh.getLastRow(), 1) + 1;
    (textCols || []).forEach(function (c) { var i = head.indexOf(c); if (i >= 0) sh.getRange(start, i + 1, newRows.length, 1).setNumberFormat('@'); });
    sh.getRange(start, 1, newRows.length, head.length).setValues(newRows.map(function (o) { return head.map(function (h) { return o[h] == null ? '' : o[h]; }); }));
  }
  return { removed: removed, added: newRows.length };
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
