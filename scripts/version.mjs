#!/usr/bin/env node
/*
 * QS CRM version tool — VERSION is the single source of truth.
 *   node scripts/version.mjs check            VERSION = APP.version in index.html = first CHANGELOG entry = "vX" button;
 *                                             schema.sql / Code.gs headers not newer than VERSION; CHANGELOG.md up to date; JS syntax OK
 *   node scripts/version.mjs notes [x.y.z]    release notes (markdown) for one version, from the CHANGELOG in index.html
 *   node scripts/version.mjs changelog        write CHANGELOG.md from index.html
 *   node scripts/version.mjs bump x.y.z       set VERSION + APP.version + version button (then add the CHANGELOG entry in index.html)
 */
import fs from 'fs'; import vm from 'vm'; import os from 'os'; import path from 'path'; import { execFileSync } from 'child_process';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rd = f => fs.readFileSync(path.join(root, f), 'utf8');
const SEMVER = /^\d+\.\d+\.\d+$/;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

function version() { return rd('VERSION').trim(); }
function appVersion(html) { const m = html.match(/var APP = \{[^}]*version:'([^']+)'/); return m && m[1]; }
function changelog(html) {
  const i = html.indexOf('var CHANGELOG = ['); if (i < 0) throw new Error('CHANGELOG not found in index.html');
  const j = html.indexOf('\n];', i); const src = html.slice(i + 'var CHANGELOG = '.length, j + 2);
  return vm.runInNewContext('(' + src + ')');
}
function notes(entries, v) {
  const e = entries.find(x => x.v === v); if (!e) throw new Error('No CHANGELOG entry for ' + v + ' in index.html');
  return e.items.map(t => '- ' + t).join('\n') + '\n';
}
function changelogMd(entries) {
  return '# QS CRM — changelog\n\nGenerated from the CHANGELOG in `index.html` by `node scripts/version.mjs changelog`. Do not edit by hand.\n\n' +
    entries.map(e => `## v${e.v} — ${e.date}\n\n${notes(entries, e.v)}`).join('\n');
}
function headerVersion(file, re) { if (!fs.existsSync(path.join(root, file))) return null; const m = rd(file).slice(0, 600).match(re); return m && m[1]; }

const [cmd, arg] = process.argv.slice(2);
const html = rd('index.html');
if (cmd === 'notes') { process.stdout.write(notes(changelog(html), arg || version())); }
else if (cmd === 'changelog') { fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelogMd(changelog(html))); console.log('CHANGELOG.md written'); }
else if (cmd === 'bump') {
  if (!SEMVER.test(arg || '')) throw new Error('Usage: bump x.y.z');
  const old = version(); if (cmp(arg, old) <= 0) throw new Error(`New version ${arg} must be higher than ${old}`);
  let h = html.replace(/(var APP = \{[^}]*version:')[^']+(')/, `$1${arg}$2`).replace(/(id="btnVer"[^>]*>)v[\d.]+(<)/, `$1v${arg}$2`);
  fs.writeFileSync(path.join(root, 'index.html'), h); fs.writeFileSync(path.join(root, 'VERSION'), arg + '\n');
  console.log(`Bumped ${old} -> ${arg}. Now add { v:'${arg}', date:'…', items:[…] } at the top of CHANGELOG in index.html, then run: node scripts/version.mjs changelog`);
}
else if (cmd === 'check') {
  const errs = [], v = version();
  if (!SEMVER.test(v)) errs.push(`VERSION "${v}" is not x.y.z`);
  const av = appVersion(html); if (av !== v) errs.push(`index.html APP.version is ${av}, VERSION is ${v}`);
  const btn = (html.match(/id="btnVer"[^>]*>v([\d.]+)</) || [])[1]; if (btn !== v) errs.push(`index.html version button shows v${btn}, VERSION is ${v}`);
  let entries = []; try { entries = changelog(html); } catch (e) { errs.push(e.message); }
  if (entries.length && entries[0].v !== v) errs.push(`first CHANGELOG entry in index.html is ${entries[0].v}, VERSION is ${v}`);
  for (let k = 1; k < entries.length; k++) if (cmp(entries[k - 1].v, entries[k].v) <= 0) errs.push(`CHANGELOG order: ${entries[k - 1].v} before ${entries[k].v}`);
  const sv = headerVersion('supabase/schema.sql', /Supabase database, v([\d.]+)/), gv = headerVersion('Code.gs', /\(Apps Script\), v([\d.]+)/);
  if (sv && cmp(sv, v) > 0) errs.push(`schema.sql header v${sv} is newer than VERSION ${v}`);
  if (gv && cmp(gv, v) > 0) errs.push(`Code.gs header v${gv} is newer than VERSION ${v}`);
  if (entries.length && (!fs.existsSync(path.join(root, 'CHANGELOG.md')) || rd('CHANGELOG.md') !== changelogMd(entries))) errs.push('CHANGELOG.md is out of date — run: node scripts/version.mjs changelog');
  // JavaScript syntax of every inline <script> in index.html, src/*.js, config.js
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qscrm-'));
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((b, i) => fs.writeFileSync(path.join(tmp, `inline${i}.js`), b));
  const files = blocks.map((_, i) => path.join(tmp, `inline${i}.js`)).concat(['config.js'].concat(fs.existsSync(path.join(root, 'src')) ? fs.readdirSync(path.join(root, 'src')).map(f => 'src/' + f) : []).map(f => path.join(root, f)));
  for (const f of files) { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { errs.push('Syntax error in ' + path.basename(f) + ': ' + String(e.stderr).split('\n').slice(0, 4).join(' ')); } }
  if (errs.length) { console.error('Version / build check FAILED:\n - ' + errs.join('\n - ')); process.exit(1); }
  console.log(`OK: v${v} — index.html, changelog, CHANGELOG.md${sv ? ', schema.sql v' + sv : ''}${gv ? ', Code.gs v' + gv : ''}; ${files.length} scripts pass the syntax check`);
}
else { console.log('Usage: node scripts/version.mjs check | notes [x.y.z] | changelog | bump x.y.z'); process.exit(cmd ? 1 : 0); }
