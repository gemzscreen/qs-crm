/**
 * QS CRM — Google Drive file service (Apps Script), v3.2.0
 * From v2.1.0 the data lives in Supabase. This script only:
 *   - stores tender files in Google Drive (one sub-folder per tender) and returns the links;
 *   - optionally creates sign-in accounts for the Users page (needs the Supabase service key);
 *   - v2.2.0: reads the pricing masterlist (Google Sheet, Rates + Res tabs) for the Masterlist page — read only, signed-in users only.
 *   - v3.1.0: stores Procurement files in <tender files folder>/Procurement/<folder> (company logo now; RFQ PDFs and quotes later).
 *   - v3.1.3: ARZA's own values are filled in below (Gemz, 9 Nov 2026), so pasting a new version needs no re-typing.
 *     The secret key is the only value never written here: re-running setSupabase() keeps the one already saved.
 *   - v3.2.0: mlUpdate writes an accepted rate proposal into the masterlist Res tab (price, confidence A, source) and logs the
 *     old price in a "QS CRM updates" tab; setJobKey() (optional) lets the mailbox job store reply attachments in Drive.
 * Every call carries the user's Supabase session token; the script asks Supabase who it is (crm_me) and
 * only QS / admin users may upload, only the admin may create users.
 *
 * Setup (once) — in a new Apps Script project (script.google.com › New project) or the old one (replace all code):
 *  1. setSupabase(): Project URL and publishable key are filled in. To add users from the app, paste the secret key
 *     (Supabase › Project Settings › API Keys › sb_secret_…) in place of PASTE-SERVICE-KEY, run it once, then put
 *     PASTE-SERVICE-KEY back and save. The key stays in Script Properties; running it again later keeps it.
 *  2. setDriveFolder(): the ARZA tender-files folder link is filled in. Run it.
 *     "An unknown error has occurred" = several Google accounts signed in -> use an Incognito window with one account.
 *  2b. setMasterlist(): the "ARZA Tender Pricing Masterlist" link is filled in. Run it (allow Sheets access).
 *  3. Deploy › New deployment › Web app › Execute as: Me › Who has access: Anyone › Deploy.
 *     Copy the /exec URL into QS CRM › Admin Settings › Connections (saved in the database for every user).
 *  After editing this file: Deploy › Manage deployments › Edit › Version: New version.
 */

// url = Project URL, anon = publishable key (meant to be public - it is in config.js too). service = secret key: paste it only
// in the Apps Script editor, never commit it (the repo is public).
function setSupabase() {
  var url = 'https://pasqkzohnecptbhzznxm.supabase.co';
  var anon = 'sb_publishable_i7DPeYESDvYNJMqzXoXqVg_PSUka53m';
  var service = 'PASTE-SERVICE-KEY';      // secret key (sb_secret_…): paste, run once, put PASTE-SERVICE-KEY back. Left as is = the saved key is kept
  var p = PropertiesService.getScriptProperties();
  url = String(url).trim().replace(/\/(rest|auth|storage)\/v1.*$/i, '').replace(/\/+$/, '');
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) throw new Error('Paste the Supabase Project URL first (https://….supabase.co).');
  if (anon.indexOf('PASTE') === 0 || anon.length < 30) throw new Error('Paste the publishable key first.');
  p.setProperty('SUPABASE_URL', url.replace(/\/$/, ''));
  p.setProperty('SUPABASE_ANON', anon);
  if (service === 'REMOVE') p.deleteProperty('SUPABASE_SERVICE');                       // only on purpose
  else if (service.indexOf('PASTE') !== 0 && service.length > 30) p.setProperty('SUPABASE_SERVICE', service);
  Logger.log('Saved. Users from the app: ' + (p.getProperty('SUPABASE_SERVICE') ? 'ON (secret key saved)' : 'OFF - paste the secret key (sb_secret_…) in setSupabase() and run it once') + '.' +
    (service.indexOf('PASTE') !== 0 && service !== 'REMOVE' ? ' Now put PASTE-SERVICE-KEY back and save.' : ''));
}

function setDriveFolder() {
  var link = 'https://drive.google.com/drive/u/0/folders/1VuFsJr1LDZDEjBxokCXu1ohNqa4sKLu0';
  var p = PropertiesService.getScriptProperties();
  Logger.log('Step 1/2: checking Drive access ... My Drive = ' + DriveApp.getRootFolder().getName());
  if (link === 'PASTE-FOLDER-LINK' || !link) {
    var f = rootFolder_();
    Logger.log('Step 2/2: no link given - tender files go to "' + f.getName() + '": ' + f.getUrl());
  } else {
    var m = String(link).match(/folders\/([\w-]+)/) || String(link).match(/^([\w-]{20,})$/) || String(link).match(/[?&]id=([\w-]+)/);
    if (!m) throw new Error('That is not a Drive folder link. Open the folder in Drive and copy the address bar.');
    var mine = DriveApp.getFolderById(m[1]);
    p.setProperty('DRIVE_ROOT_ID', m[1]);
    Logger.log('Step 2/2: tender files will go to "' + mine.getName() + '": ' + mine.getUrl());
  }
}
function authorizeDrive() { setDriveFolder(); }

/* v2.2.0: which Google Sheet is the pricing masterlist (read only) */
function setMasterlist() {
  var link = 'https://docs.google.com/spreadsheets/d/1dC3rSSKKvRuyc_Gr4X2QwtWEiZE49fsngscQvGPCAsg/edit?gid=2071073420#gid=2071073420';
  var m = String(link).match(/\/d\/([\w-]{20,})/) || String(link).match(/^([\w-]{20,})$/);
  if (!m) throw new Error('Paste the masterlist Google Sheet link first (open the sheet, copy the address bar).');
  var ss = SpreadsheetApp.openById(m[1]);
  ['Rates', 'Res'].forEach(function (n) { if (!ss.getSheetByName(n)) throw new Error('Tab "' + n + '" not found in ' + ss.getName()); });
  PropertiesService.getScriptProperties().setProperty('MASTERLIST_ID', m[1]);
  Logger.log('Masterlist set: "' + ss.getName() + '".');
}

/* v3.2.0 (optional): key for the mailbox job (GitHub Actions) to store reply attachments in Drive. Run once, copy the key from the log
   into the GitHub secret DRIVE_JOB_KEY. Running it again makes a new key (the old one stops working). */
function setJobKey() {
  var k = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('JOB_KEY', k);
  Logger.log('Mailbox job key - put it in GitHub › Settings › Secrets › Actions › DRIVE_JOB_KEY:\n' + k);
}

function doGet() {
  var p = PropertiesService.getScriptProperties();
  return json_({ ok: true, app: 'QS CRM file service', version: '3.2.0', supabase: !!p.getProperty('SUPABASE_URL'), drive: !!p.getProperty('DRIVE_ROOT_ID'),
    users: !!p.getProperty('SUPABASE_SERVICE'), masterlist: !!p.getProperty('MASTERLIST_ID') });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    var me = req.jobKey ? jobWho_(req.jobKey, req.action) : whoIs_(req.token);
    var fn = ACTIONS[req.action];
    if (!fn) throw new Error('Unknown action ' + req.action);
    return json_({ ok: true, data: fn(req, me) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var ACTIONS = {
  ping: function (req, me) { var p = PropertiesService.getScriptProperties(); return { email: me.email, role: me.role, drive: !!p.getProperty('DRIVE_ROOT_ID'), masterlist: !!p.getProperty('MASTERLIST_ID'), users: !!p.getProperty('SUPABASE_SERVICE'), version: '3.2.0' }; },

  /* v2.2.0: pricing masterlist, read only (any active signed-in user). Tabs Rates + Res, header row = the row starting with "Code" */
  masterlist: function (req, me) {
    var id = PropertiesService.getScriptProperties().getProperty('MASTERLIST_ID');
    if (!id) throw new Error('Masterlist not set - run setMasterlist() in Apps Script');
    var ss = SpreadsheetApp.openById(id), tz = Session.getScriptTimeZone();
    function tab(name) {
      var sh = ss.getSheetByName(name); if (!sh) return { head: [], rows: [] };
      var v = sh.getDataRange().getValues(), h = -1;
      for (var i = 0; i < Math.min(v.length, 15); i++) if (String(v[i][0]).trim() === 'Code') { h = i; break; }
      if (h < 0) return { head: [], rows: [] };
      var head = v[h].map(function (x) { return String(x).trim(); }), n = head.length; while (n && !head[n - 1]) n--;
      var rows = [];
      for (var r = h + 1; r < v.length; r++) {
        var row = v[r].slice(0, n).map(function (x) { return x instanceof Date ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : x; });
        if (row.every(function (x) { return x === '' || x == null; })) continue;
        rows.push(row);
      }
      return { head: head.slice(0, n), rows: rows };
    }
    return { name: ss.getName(), url: ss.getUrl(), updated: Utilities.formatDate(DriveApp.getFileById(id).getLastUpdated(), tz, 'yyyy-MM-dd HH:mm'),
      rates: tab('Rates'), res: tab('Res') };
  },

  /* store one file in the tender's folder: req.arza_no, req.tender_ref, req.folder_link (existing), req.file {name, type, data(base64)} */
  upload: function (req, me) {
    if (['admin', 'qs'].indexOf(me.role) < 0) throw new Error('Read-only account - only QS and admin users can store files');
    if (!req.file || !req.file.data) throw new Error('No file');
    if (!/^T\d+$/.test(String(req.arza_no || ''))) throw new Error('Tender number missing');
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var folder = tenderFolder_(req.arza_no, req.tender_ref, req.folder_link);
      var blob = Utilities.newBlob(Utilities.base64Decode(req.file.data), req.file.type || 'application/octet-stream', req.file.name);
      var f = folder.createFile(blob);
      return { folder_link: folder.getUrl(), url: f.getUrl(), name: f.getName() };
    } finally { lock.releaseLock(); }
  },

  /* v3.1.0: one Procurement file: req.folder (e.g. "Company", later "RFQ-2611-003 - SS304 railing tubes"), req.file {name, type, data(base64)} */
  procUpload: function (req, me) {
    if (['admin', 'qs'].indexOf(me.role) < 0) throw new Error('Read-only account - only QS and admin users can store files');
    if (!req.file || !req.file.data) throw new Error('No file');
    var name = String(req.folder || '').replace(/[\/\\:*?"<>|]+/g, '-').trim().slice(0, 120);
    if (!name) throw new Error('Folder name missing');
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var root;
      try { root = rootFolder_(); } catch (e) { throw new Error('Google Drive is not set up yet (' + e.message + '). In Apps Script run setDriveFolder(), then deploy a New version.'); }
      var folder = subFolder_(subFolder_(root, 'Procurement'), name);
      var blob = Utilities.newBlob(Utilities.base64Decode(req.file.data), req.file.type || 'application/octet-stream', req.file.name);
      var f = folder.createFile(blob);
      return { folder_link: folder.getUrl(), url: f.getUrl(), name: f.getName() };
    } finally { lock.releaseLock(); }
  },

  /* v3.2.0: accepted rate proposal -> masterlist Res tab. req: code, price (B$ per unit), source, unit. Returns {code, old, price}. */
  mlUpdate: function (req, me) {
    if (['admin', 'qs'].indexOf(me.role) < 0) throw new Error('Read-only account - only QS and admin users can change the masterlist');
    var id = PropertiesService.getScriptProperties().getProperty('MASTERLIST_ID');
    if (!id) throw new Error('Masterlist not set - run setMasterlist() in Apps Script');
    var code = String(req.code || '').trim(), price = Number(req.price);
    if (!/^[A-Z]{1,3}\d{1,4}[a-z]?$/.test(code)) throw new Error('Bad masterlist code ' + code);
    if (!(price > 0) || price > 1e7) throw new Error('Bad price ' + req.price);
    var lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      var ss = SpreadsheetApp.openById(id), sh = ss.getSheetByName('Res'); if (!sh) throw new Error('Tab "Res" not found in the masterlist');
      var v = sh.getDataRange().getValues(), h = -1;
      for (var i = 0; i < Math.min(v.length, 15); i++) if (String(v[i][0]).trim() === 'Code') { h = i; break; }
      if (h < 0) throw new Error('Header row starting with "Code" not found in the Res tab');
      var head = v[h].map(function (x) { return String(x).trim().toLowerCase(); }), col = function (re) { for (var j = 0; j < head.length; j++) if (re.test(head[j])) return j; return -1; };
      var cP = col(/^price/), cN = col(/^resource/), cU = col(/^unit/), cF = col(/^conf/), cS = col(/^(source|remarks?|basis)/), cD = col(/(date|updated)/);
      if (cP < 0) throw new Error('No "Price" column in the Res tab');
      var r = -1; for (var k = h + 1; k < v.length; k++) if (String(v[k][0]).trim() === code) { r = k; break; }
      if (r < 0) throw new Error(code + ' not found in the Res tab');
      var old = v[r][cP], when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      sh.getRange(r + 1, cP + 1).setValue(Math.round(price * 100) / 100);
      if (cF >= 0) sh.getRange(r + 1, cF + 1).setValue('A');
      if (cS >= 0) sh.getRange(r + 1, cS + 1).setValue('Quote ' + String(req.source || '').slice(0, 120) + ' (' + when + ')');
      if (cD >= 0) sh.getRange(r + 1, cD + 1).setValue(when);
      var lg = ss.getSheetByName('QS CRM updates') || ss.insertSheet('QS CRM updates');
      if (lg.getLastRow() === 0) lg.appendRow(['Date', 'Code', 'Resource', 'Unit (masterlist)', 'Old price', 'New price', 'Unit (RFQ)', 'Source', 'By']);
      lg.appendRow([when, code, cN >= 0 ? v[r][cN] : '', cU >= 0 ? v[r][cU] : '', old, Math.round(price * 100) / 100, req.unit || '', req.source || '', me.email]);
      return { code: code, old: old, price: Math.round(price * 100) / 100 };
    } finally { lock.releaseLock(); }
  },

  /* admin: create a sign-in account (email confirmed), then give it a role */
  createUser: function (req, me) {
    if (me.role !== 'admin') throw new Error('Only the admin can add users');
    var p = PropertiesService.getScriptProperties(), service = p.getProperty('SUPABASE_SERVICE');
    if (!service) throw new Error('Adding users from the app is off. Add the user in Supabase › Authentication › Users › Add user, or run setSupabase() with the service key.');
    var u = req.user || {};
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(u.email || ''))) throw new Error('Give a valid email');
    if (String(u.password || '').length < 8) throw new Error('Password must have at least 8 characters');
    var res = UrlFetchApp.fetch(p.getProperty('SUPABASE_URL') + '/auth/v1/admin/users', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: adminHeaders_(service),
      payload: JSON.stringify({ email: u.email, password: u.password, email_confirm: true, user_metadata: { full_name: u.full_name || '' } })
    });
    var body = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300) throw new Error(body.msg || body.message || body.error_description || ('Supabase answered ' + res.getResponseCode()));
    var role = u.role || 'viewer';
    rpc_(req.token, 'crm_setuser', { id: body.id, role: role, full_name: u.full_name || '' });
    return { id: body.id, email: body.email, role: role };
  }
};

/* ---------- Supabase ---------- */
/* new secret keys (sb_secret_…) go only in the apikey header; legacy service_role JWTs also as Bearer */
function adminHeaders_(key) { var h = { apikey: key }; if (/^eyJ/.test(key)) h.Authorization = 'Bearer ' + key; return h; }
/* the mailbox job may only store files (procUpload) */
function jobWho_(key, action) {
  var k = PropertiesService.getScriptProperties().getProperty('JOB_KEY');
  if (!k || String(key) !== k) throw new Error('AUTH: bad job key');
  if (action !== 'procUpload' && action !== 'ping') throw new Error('The mailbox job may only store files');
  return { email: 'mailbox job', role: 'qs' };
}
function whoIs_(token) {
  if (!token) throw new Error('AUTH: Not signed in');
  return rpc_(token, 'crm_me', {});
}
function rpc_(token, fn, p) {
  var pr = PropertiesService.getScriptProperties(), url = pr.getProperty('SUPABASE_URL'), anon = pr.getProperty('SUPABASE_ANON');
  if (!url || !anon) throw new Error('File service not set up - run setSupabase() in Apps Script');
  var res = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: anon, Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ p: p || {} })
  });
  var txt = res.getContentText(), body = txt ? JSON.parse(txt) : null;
  if (res.getResponseCode() >= 300) throw new Error((body && (body.message || body.msg)) || ('Supabase answered ' + res.getResponseCode()));
  return body;
}

/* ---------- Google Drive ---------- */
function rootFolder_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('DRIVE_ROOT_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('QS CRM - Tenders');
  p.setProperty('DRIVE_ROOT_ID', f.getId());
  return f;
}
function tenderFolder_(no, ref, link) {
  var m = String(link || '').match(/folders\/([\w-]+)/);
  if (m) { try { return DriveApp.getFolderById(m[1]); } catch (e) {} }
  var name = no + (ref ? ' - ' + String(ref).replace(/[\/\\:*?"<>|]+/g, '-') : '');
  var root;
  try { root = rootFolder_(); } catch (e) { throw new Error('Google Drive is not set up yet (' + e.message + '). In Apps Script run setDriveFolder(), then deploy a New version.'); }
  var same = root.getFoldersByName(name);
  return same.hasNext() ? same.next() : root.createFolder(name);
}
function subFolder_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
