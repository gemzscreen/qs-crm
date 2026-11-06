/**
 * QS CRM — Google Drive file service (Apps Script), v2.1.0
 * From v2.1.0 the data lives in Supabase. This script only:
 *   - stores tender files in Google Drive (one sub-folder per tender) and returns the links;
 *   - optionally creates sign-in accounts for the Users page (needs the Supabase service key).
 * Every call carries the user's Supabase session token; the script asks Supabase who it is (crm_me) and
 * only QS / admin users may upload, only the admin may create users.
 *
 * Setup (once) — in a new Apps Script project (script.google.com › New project) or the old one (replace all code):
 *  1. setSupabase(): paste the Project URL and the anon public key (Supabase › Project Settings › API).
 *     Optional: the service_role key, only if you want to add users from the app. Run it, then put the
 *     PASTE-… texts back and save (the values stay in Script Properties, not in the code).
 *  2. setDriveFolder(): paste the link of the Drive folder for tender files (or leave it to make "QS CRM - Tenders"). Run it.
 *     "An unknown error has occurred" = several Google accounts signed in -> use an Incognito window with one account.
 *  3. Deploy › New deployment › Web app › Execute as: Me › Who has access: Anyone › Deploy. Put the /exec URL in config.js (driveUrl).
 *  After editing this file: Deploy › Manage deployments › Edit › Version: New version.
 */

function setSupabase() {
  var url = 'PASTE-PROJECT-URL';          // e.g. https://abcdefgh.supabase.co
  var anon = 'PASTE-ANON-KEY';            // publishable key (sb_publishable_…) or legacy anon key
  var service = 'PASTE-SERVICE-KEY';      // optional: secret key (sb_secret_…) or legacy service_role key - keep secret; leave as is to add users in the Supabase dashboard instead
  var p = PropertiesService.getScriptProperties();
  if (!/^https:\/\/.+\.supabase\.co\/?$/.test(url)) throw new Error('Paste the Supabase Project URL first (https://….supabase.co).');
  if (anon.indexOf('PASTE') === 0 || anon.length < 30) throw new Error('Paste the anon public key first.');
  p.setProperty('SUPABASE_URL', url.replace(/\/$/, ''));
  p.setProperty('SUPABASE_ANON', anon);
  if (service.indexOf('PASTE') !== 0 && service.length > 30) p.setProperty('SUPABASE_SERVICE', service); else p.deleteProperty('SUPABASE_SERVICE');
  Logger.log('Saved. Users from the app: ' + (p.getProperty('SUPABASE_SERVICE') ? 'ON' : 'OFF (add users in the Supabase dashboard)') + '. Now put the PASTE-… texts back and save.');
}

function setDriveFolder() {
  var link = 'PASTE-FOLDER-LINK';   // e.g. https://drive.google.com/drive/folders/1AbC...xyz
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

function doGet() {
  var p = PropertiesService.getScriptProperties();
  return json_({ ok: true, app: 'QS CRM file service', supabase: !!p.getProperty('SUPABASE_URL'), drive: !!p.getProperty('DRIVE_ROOT_ID'), users: !!p.getProperty('SUPABASE_SERVICE') });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    var me = whoIs_(req.token);
    var fn = ACTIONS[req.action];
    if (!fn) throw new Error('Unknown action ' + req.action);
    return json_({ ok: true, data: fn(req, me) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var ACTIONS = {
  ping: function (req, me) { return { email: me.email, role: me.role, drive: !!PropertiesService.getScriptProperties().getProperty('DRIVE_ROOT_ID') }; },

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
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
