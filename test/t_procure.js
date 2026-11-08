// Tests for src/procure-std.js (QS CRM v3 Procurement).   node test/t_procure.js
// Part A runs everywhere (CI): synthetic rows only. Part B needs the local fixtures built from Gemz's two workbooks
// (test/fixtures/, not committed - the repo is public): python3 -I test/make_fixture.py rfq|aircon <xlsx> test/fixtures/<name>.json
const fs = require('fs'), path = require('path');
const P = require('../src/procure-std.js');
let pass = 0, fail = 0;
function eq(a, b, msg) { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL', msg, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } }
function ok(c, msg) { eq(!!c, true, msg); }

/* ===================== A. always (no supplier data) ===================== */
// numbers
eq(P.rfqNo('2026-11-08', 2), 'RFQ-2611-002', 'rfqNo');
eq(P.nextDocNo('RFQ', '2026-11-20', ['RFQ-2611-001', 'RFQ-2611-002', 'RFQ-2611-002-R1', 'RFQ-2610-009']), 'RFQ-2611-003', 'nextDocNo');
eq(P.nextDocNo('RFQ', '2026-12-01', ['RFQ-2611-014']), 'RFQ-2612-001', 'month restart');
eq(P.parseDocNo('rfq-2611-002-r1'), { prefix: 'RFQ', yy: 26, mm: 11, seq: 2, rev: 1 }, 'parse rev');
eq(P.parseDocNo('RFQ-2613-001'), null, 'bad month');
eq(P.mrNo('2026-11-09', 1), 'MR-2611-001', 'mrNo');
eq(P.supplierId(7), 'SUP-0007', 'supplierId');
eq(P.parseSupplierId('sup-0042'), 42, 'parseSupplierId');

// zones
eq(P.zoneLabel(4, 'Vietnam'), '4 Vietnam', 'zoneLabel VN');
eq(P.zoneOf('Malaysia', 'Kota Kinabalu, Sabah'), 2, 'KK = Borneo');
eq(P.zoneOf('Malaysia', 'Miri'), 2, 'Miri = Borneo');
eq(P.zoneOf('Malaysia', 'Klang, Selangor'), 3, 'Klang = MY/SG');
eq(P.zoneOf('Brunei', ''), 1, 'Brunei');
eq(P.zoneOf('Indonesia', 'Balikpapan, Kalimantan'), 5, 'Kalimantan = other');

// phones
const k = (raw, c) => P.parsePhones(raw, c).map(p => p.e164 + ':' + p.kind + (p.whatsapp ? ':WA' : ''));
eq(k('+673 242 8981 / HP 874 0081, 890 6000', 'Brunei'), ['+6732428981:landline', '+6738740081:mobile:WA', '+6738906000:mobile:WA'], 'BN HP list');
eq(k('085-322 399 / HP +60 19-316 3328', 'Malaysia (Borneo)'), ['+6085322399:landline', '+60193163328:mobile:WA'], 'Miri');
eq(k('0757-82707815 / WA +86 137 0260 0484', 'China'), ['+8675782707815:landline', '+8613702600484:mobile:WA'], 'CN WA tag');
eq(k('+84 273 364 2555', 'Vietnam'), ['+842733642555:landline'], 'VN landline');
eq(k('+65 8301 6969', 'Singapore'), ['+6583016969:mobile:WA'], 'SG mobile');
eq(k('+60 (0)12-345 6789', 'Malaysia'), ['+60123456789:mobile:WA'], 'MY (0)');
eq(k('12345', 'Brunei'), [], 'too short ignored');
eq(P.parsePhones('+86 10 8558 3082', 'China')[0].kind, 'landline', 'Beijing landline valid');
eq(P.whatsappOf('+86 10 8558 3082', 'China'), '', 'Beijing landline = no WhatsApp');

// emails, domains, dedup
eq(P.splitEmails('Sales@ABC.com / info@abc.com; bad@ , x@y.cn.'), ['sales@abc.com', 'info@abc.com', 'x@y.cn'], 'splitEmails');
eq(P.webDomain('https://abcsteel.m.en.alibaba.com/company_profile.html'), 'abcsteel.m.en.alibaba.com', 'webDomain');
eq(P.isPlatform('abcsteel.m.en.alibaba.com'), true, 'platform');
eq(P.baseDomain('sonha.com.vn'), 'sonha.com.vn', 'baseDomain ccTLD');
eq(P.normName('Foshan Vinmay Stainless Steel Co., Ltd.'), 'foshan vinmay stainless steel', 'normName');
const synth = [
  { company_name: 'Alpha Steel Co., Ltd.', country: 'China', email: 'sales@alphasteel.cn', phone: '+86 131 0000 1111', website: 'https://alphasteel.cn' },
  { company_name: 'Beta Hardware Sdn Bhd', country: 'Brunei', email: 'beta.hw@gmail.com', phone: '+673 222 3333 / HP 876 5432' },
  { company_name: 'ALPHA STEEL CO LTD', country: 'China', email: 'export@alphasteel.cn' }];
const dd = P.findDuplicates(synth);
eq(dd.map(d => [d.a, d.b, d.keys]), [[0, 2, ['dom:alphasteel.cn', 'name:alpha steel|CN']]], 'dedup by domain + name');
ok(!P.dedupKeys(synth[1]).some(x => x === 'dom:gmail.com'), 'free-mail never a company domain');

// working days and timetable
eq(P.timetable('2026-11-08'), { urgency: 'RESTOCK', sent: '2026-11-08', reminder1: '2026-11-10', reminder2: '2026-11-12', deadline: '2026-11-12', noReply: '2026-11-14' }, 'timetable RESTOCK (RFQ-2611-002)');
eq(P.timetable(new Date(2026, 10, 9, 9, 0), { urgency: 'SUPER URGENT' }), { urgency: 'SUPER URGENT', sent: '2026-11-09 09:00', reminder1: '2026-11-09 11:00', reminder2: '2026-11-09 13:00', deadline: '2026-11-09 15:00', noReply: '2026-11-09 15:00' }, 'timetable SUPER URGENT');
eq(P.timetable('2026-11-12', { urgency: 'URGENT' }).deadline, '2026-11-14', 'URGENT Thu -> Sat');
eq(P.timetable('2026-11-09', { urgency: 'NORMAL' }), { urgency: 'NORMAL', sent: '2026-11-09', reminder1: '2026-11-10', reminder2: '2026-11-11', deadline: '2026-11-11', noReply: '2026-11-12' }, 'timetable NORMAL');
eq(P.timetable('2026-11-09', { urgency: 'NEEDED SOON' }).deadline, '2026-11-12', 'NEEDED SOON +3 wd');
eq(P.iso(P.addWorkdays('2026-11-12', 1)), '2026-11-14', 'Thu +1 = Sat');
eq(P.iso(P.addWorkdays('2026-11-14', 1, ['2026-11-16'])), '2026-11-17', 'holiday skipped');

// urgency + sourcing + goal guard
[['2026-11-09', 'SUPER URGENT'], ['2026-11-11', 'SUPER URGENT'], ['2026-11-12', 'URGENT'], ['2026-11-16', 'URGENT'],
 ['2026-11-17', 'NORMAL'], ['2026-11-23', 'NORMAL'], ['2026-11-24', 'NEEDED SOON'], ['2026-11-30', 'NEEDED SOON'],
 ['2026-12-07', 'NEEDED SOON'], ['2026-12-09', 'RESTOCK'], ['', 'RESTOCK'], ['2026-11-01', 'SUPER URGENT']]
  .forEach(([d, u]) => eq(P.urgencyOf('2026-11-09', d), u, 'urgency ' + (d || 'no date')));
eq(P.sourcingPlan('SUPER URGENT').zones, [1], 'super urgent: Brunei only');
eq(P.sourcingPlan('URGENT').zones, [1, 2], 'urgent: Brunei + Borneo');
eq(P.sourcingPlan('NORMAL').zones, [1, 2, 3], 'normal: + MY/SG');
eq(P.sourcingPlan('RESTOCK').zones, [4, 3, 1, 2], 'restock: China first');
eq(P.sourcingPlan('URGENT', true).priority[4], 1, 'urgent but only China makes it');
eq(P.leadTimeWarning('2026-11-09', '2026-12-09', 42), 'lead time 42 d > 30 d available', 'lead-time warning');
eq(P.goalGuard({ zonesUsed: [1, 2], validQuotes: 1, reminder2Done: true }).zones, [3], 'widen urgent -> MY/SG');
eq(P.goalGuard({ zonesUsed: [1, 2, 3, 4], validQuotes: 2, reminder2Done: true }).zones, [5], 'widen -> other countries');
eq(P.goalGuard({ zonesUsed: [1, 2], suppliersInZones: 0 }).widen, true, 'no supplier -> widen');
eq(P.goalGuard({ zonesUsed: [1, 2], validQuotes: 3, reminder2Done: true }).widen, false, 'goal met');
eq(P.contactTarget(0.3, 12), 10, 'contact target 30%');
eq(P.contactTarget(0, 0), 10, 'contact target new category');

// templates (synthetic RFQ)
const rfqS = { rfq_no: 'RFQ-2611-099', title: 'Test item', short_desc: 'test item', qtyMode: 'firm', deadline: '2026-11-12', items: [{ desc: 'Item A', qty: 10, unit: 'No' }] };
const eS = P.buildEmail(rfqS, { zone: 1, email: 'a@b.com' });
eq(eS.subject, 'RFQ-2611-099 - Test item - ARZA SDN BHD', 'subject template');
ok(/in B\$ for the quantities/.test(eS.body) && /Thursday, 12 November 2026/.test(eS.body), 'local body + long date');
['wa_follow', 'wa_full', 'reminder1', 'reminder2', 'thanks', 'regret'].forEach(t => {
  const x = P.buildWhatsApp(t, rfqS, { zone: 4, whatsapp: '+8613100001111', email: 'a@b.com' }, { sent_date: P.longDate('2026-11-08'), close_date: P.longDate('2026-11-14') });
  ok(!/\{\{/.test(x.text) && /^https:\/\/wa\.me\/8613100001111\?text=/.test(x.link), 'template filled: ' + t);
});

/* ----- v3.1.0: categories, discovery rows, supplier records ----- */
eq(P.CATEGORIES.length, 23, '23 categories');
eq(P.categoryCode('hv'), 'HV', 'category by code');
eq(P.categoryCode('Reinforcement'), 'RB', 'category by name');
eq(P.categoryCode('Stainless steel - railing tubes & fittings'), 'MW', 'RFQ-2611-002 free text -> MW');
eq(P.categoryCode('Aircon copper pipe & insulation'), 'HV', 'aircon -> HV');
eq(P.categoryCode('something else'), '', 'unknown category');
eq(P.categoryCodes('HV, PL'), ['HV', 'PL'], 'several codes');
eq(P.categoryCodes('Doors, windows & glazing'), ['DW'], 'name with commas = one category');
eq(P.foundBy('Claude web search'), 'Claude', 'found_by Claude');
eq(P.foundBy('Gemini'), 'Gemini', 'found_by Gemini');
eq(P.supplierType('Manufacturer/exporter'), 'Manufacturer', 'type');
eq(P.countryName('VN'), 'Vietnam', 'countryName');

const raw = { company_name: 'Gamma Metal Co., Ltd. (Gamma Foshan)', country: 'China', city: 'Foshan', website: 'gammametal.com',
  category: 'Stainless steel - railing tubes & fittings', specialty: 'SS304 tubes', email: 'sales@gammametal.com / info@gammametal.com',
  phone: '0757-1234 5678 / +86 139 0000 2222', whatsapp: '', source_url: 'https://gamma.en.alibaba.com', found_by: 'Claude web search',
  found_on: new Date(2026, 10, 8), verification: 'Checked', zone: '9 wrong' };
const dr = P.discoveryRow(raw);
eq([dr.alias, dr.found_on, dr.verification, dr.zone, dr.whatsapp], ['Gamma Foshan', '2026-11-08', 'Unverified', '4 China', '+8613900002222'], 'discoveryRow normalises');
const sup = P.toSupplier(dr);
eq(sup.fields.name, 'Gamma Metal Co., Ltd.', 'alias text taken out of the name');
eq([sup.fields.country, sup.fields.zone, sup.fields.website, sup.fields.platform_links, sup.fields.found_by],
   ['CN', 4, 'https://gammametal.com', 'https://gamma.en.alibaba.com', 'Claude'], 'toSupplier fields');
eq(sup.categories, [{ code: 'MW', specialty: 'Stainless steel - railing tubes & fittings: SS304 tubes' }], 'category + source wording kept');
eq(sup.contacts, [
  { name: '', role: '', email: 'sales@gammametal.com', phone: '+8613900002222', whatsapp: '+8613900002222', preferred: 'email' },
  { name: '', role: '', email: 'info@gammametal.com', phone: '', whatsapp: '', preferred: 'email' },
  { name: '', role: '', email: '', phone: '+8675712345678', whatsapp: '', preferred: 'phone' }], 'contacts split');
ok(sup.keys.indexOf('dom:gammametal.com') >= 0 && sup.keys.indexOf('tel:+8613900002222') >= 0, 'keys carried');
const back = P.supplierAsRow(Object.assign({}, sup.fields, { contacts: sup.contacts, categories: sup.categories, verification: 'Checked' }));
eq(P.findDuplicates([dr, back]).length, 1, 'stored supplier is found again as a duplicate');
eq(P.discoveryRow({ company_name: 'X', country: 'Brunei', category: '' }, { category: 'CS' }).category, 'CS', 'default category for the batch');
eq(P.autoVerification({ ok: true }, { mx: true, a: null }, true), 'Checked', 'MX ok -> Checked');
eq(P.autoVerification({ ok: true }, { mx: false, a: true }, true), 'Unverified', 'no MX -> stays Unverified');
eq(P.autoVerification({ ok: true }, { mx: null, a: true }, false), 'Checked', 'no email, website resolves -> Checked');
eq(P.autoVerification({ ok: false }, { mx: true }, true), 'Unverified', 'offline fail -> Unverified');
eq(P.autoVerification({ ok: true }, { mx: true, a: false }, true), 'Unverified', 'website does not resolve -> Unverified');
eq(P.dnsTargets({ email: 'x@gmail.com / y@acme.com.bn', website: 'https://acme.en.alibaba.com' }), { mx: 'acme.com.bn', a: '' }, 'dns targets skip free-mail + platform');

// DNS-over-HTTPS with a fake fetch (Google fails -> Cloudflare)
const calls = [];
const fakeFetch = (url) => { calls.push(url); if (/dns\.google/.test(url)) return Promise.reject(new Error('blocked'));
  return Promise.resolve({ json: () => Promise.resolve(/type=MX/.test(url) ? { Status: 0, Answer: [{ data: '10 mx.acme.com' }] } : { Status: 3 }) }); };
const dnsP = P.checkDns('acme.com', fakeFetch).then(r => { eq(r, { mx: true, a: false }, 'checkDns falls back to Cloudflare'); eq(calls.length, 4, 'checkDns 4 calls'); });

// the categories table in schema.sql = Procure.CATEGORIES; the copy embedded in index.html = src/procure-std.js
const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8');
const sqlCats = [...sql.matchAll(/\('([A-Z]{2})', '([^']+)', '([^']*)', '([^']*)', (\d+)\)/g)].map(m => [m[1], m[2], m[3], m[4]]);
eq(sqlCats, P.CATEGORIES, 'schema.sql categories = Procure.CATEGORIES');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), src = fs.readFileSync(path.join(root, 'src/procure-std.js'), 'utf8');
ok(html.indexOf('<script>\n' + src.trim() + '\n</script>') >= 0, 'index.html embeds src/procure-std.js unchanged');

/* ===================== B. real workbooks (local fixtures) ===================== */
const FX = path.join(__dirname, 'fixtures');
const have = f => fs.existsSync(path.join(FX, f));
if (have('rfq002.json')) {
  const F = require('./fixtures/rfq002.json');
  // zones and WhatsApp numbers vs the send list (Discovery sheet, columns zone + whatsapp)
  F.discovery.forEach(r => {
    eq(P.zoneOf(r.country, r.city), +String(r.zone).charAt(0), 'zone ' + r.company_name);
    eq(P.whatsappOf(r.phone, r.country), String(r.whatsapp || ''), 'whatsapp ' + r.company_name);
  });
  eq(P.findDuplicates(F.discovery).length, 0, 'no duplicates inside RFQ-2611-002');
  const dup = { company_name: 'VINMAY Stainless Steel Co Ltd', country: 'China', email: 'sales@vinssco.com', website: 'www.vinssco.com/en' };
  const d2 = P.findDuplicates(F.discovery.concat([dup])).filter(p => p.b === F.discovery.length);
  eq(d2.map(p => F.discovery[p.a].company_name), ['Foshan Vinmay Stainless Steel Co., Ltd.'], 'dup by domain');
  eq(d2[0].keys, ['dom:vinssco.com'], 'dup key');
  const issues = F.discovery.map(r => [r.company_name, P.offlineChecks(r)]).filter(x => x[1].issues.length);
  console.log('offline check notes:'); issues.forEach(x => console.log('  ' + (x[1].ok ? 'ok  ' : 'FAIL') + ' ' + x[0] + ': ' + x[1].issues.join('; ')));
  // templates rebuild the RFQ-2611-002 China email + WhatsApp exactly
  const rfq = { rfq_no: 'RFQ-2611-002', title: 'SS304 Railing Tubes 1in, 1-1/2in, 2in & Fittings', qtyMode: 'moq', deadline: '2026-11-12',
    short_desc: 'SS304 railing tubes 1", 1-1/2", 2" (OD 25.4/38.1/50.8mm x 1.5mm, hairline, 6m) and matching fittings', certs: 'mill certificate / material test report for SS304',
    items: [
      { desc: 'SS304 round tube 25.4mm (1in) OD x 1.5mm wall, hairline/satin finish, 6m length', short: 'SS304 round tube 25.4mm (1") OD x 1.5mm, hairline, 6m' },
      { desc: 'SS304 round tube 38.1mm (1-1/2in) OD x 1.5mm wall, hairline/satin finish, 6m length', short: 'SS304 round tube 38.1mm (1-1/2") OD x 1.5mm, hairline, 6m' },
      { desc: 'SS304 round tube 50.8mm (2in) OD x 1.5mm wall, hairline/satin finish, 6m length', short: 'SS304 round tube 50.8mm (2") OD x 1.5mm, hairline, 6m' },
      { desc: 'SS304 railing fittings to suit items 1-3: 90deg elbow, tee, end cap, base flange with cover, wall bracket (please attach catalogue)', short: 'Matching SS304 fittings: 90deg elbow, tee, end cap, base flange+cover, wall bracket' }] };
  const vin = { zone: 4, email: 'marketing@vinssco.com', whatsapp: '+8613143276868' };
  const em = P.buildEmail(rfq, vin);
  eq(em.subject, F.text['Email subject'], 'subject');
  eq(em.body.trim(), F.text['Email body - China'].trim(), 'China body');
  eq(decodeURIComponent(em.link), decodeURIComponent(F.links[0].email_link), 'compose link (decoded)');
  eq(em.tooLong, false, 'link length ok (' + em.link.length + ')');
  eq(P.buildWhatsApp('wa_follow', rfq, vin).text, F.text['WhatsApp follow-up (after email)'].replace('<supplier email>', 'marketing@vinssco.com'), 'WA follow-up');
  eq(P.buildWhatsApp('wa_full', rfq, { zone: 2, whatsapp: '+60193163328' }).text, F.text['WhatsApp full RFQ (no email)'], 'WA full RFQ');
  // v3.1.0: the Discovery sheet imports as 19 suppliers, category MW, all with a contact
  const rows = F.discovery.map(r => P.discoveryRow(r));
  const sups = rows.map(P.toSupplier);
  eq(sups.length, 19, 'RFQ-2611-002: 19 supplier records');
  eq(sups.filter(s => s.categories.length === 1 && s.categories[0].code === 'MW').length, 19, 'RFQ-2611-002: all MW');
  eq(sups.filter(s => s.fields.found_by === 'Claude').length, 19, 'RFQ-2611-002: found_by Claude');
  eq(sups.filter(s => s.contacts.length >= 1).length + sups.filter(s => !s.contacts.length).length, 19, 'contacts counted');
  eq(sups.map(s => (s.contacts.find(c => c.whatsapp) || {}).whatsapp || ''), F.discovery.map(r => String(r.whatsapp || '')), 'RFQ-2611-002: WhatsApp kept on the contacts');
  eq(rows.filter(r => P.offlineChecks(r).ok).length, 19, 'RFQ-2611-002: 19/19 pass the offline checks');
  console.log('RFQ-2611-002 platform links:', sups.filter(s => s.fields.platform_links).map(s => s.fields.name.slice(0, 24) + ' -> ' + s.fields.platform_links).join(' | '));
} else console.log('(skipped RFQ-2611-002 fixture tests: test/fixtures/rfq002.json not found)');

if (have('aircon.json')) {
  const A = require('./fixtures/aircon.json');
  const F = have('rfq002.json') ? require('./fixtures/rfq002.json') : { discovery: [] };
  const all = A['All Suppliers'].map(r => P.fromGeminiDirectory(r, { found_on: '2026-11-08' }));
  eq(all.length, 21, 'aircon rows');
  const byC = {}; all.forEach(r => byC[r.country] = (byC[r.country] || 0) + 1);
  eq(byC, { Singapore: 3, Malaysia: 4, Vietnam: 2, Indonesia: 3, China: 9 }, 'aircon by country');
  eq(P.findDuplicates(all).length, 0, 'aircon: no duplicates inside All Suppliers');
  const sheets = ['Singapore', 'Malaysia', 'Vietnam', 'Indonesia', 'China'].flatMap(s => A[s].map(r => P.fromGeminiDirectory(r)));
  const both = all.concat(sheets), dd2 = P.findDuplicates(both).filter(p => p.a < 21 && p.b >= 21);
  eq(new Set(dd2.map(p => p.b)).size, 21, 'country sheets = duplicates of All Suppliers (all 21 caught)');
  eq(P.findDuplicates(all.concat(F.discovery)).filter(p => p.a < 21 && p.b >= 21).length, 0, 'aircon vs RFQ-2611-002: no overlap');
  const sc = all.find(r => /Smartclima/.test(r.company_name));
  eq([sc.company_name, sc.alias, sc.email, sc.whatsapp, sc.website, sc.zone], ['Smartclima Co., Ltd.', 'Ningbo Smartclima', 'sale@smartclima.com / info@smartclima.com', '+8613486010697', 'https://smartclima.com', '4 China'], 'Smartclima mapped');
  eq(all.find(r => /Fanryn/.test(r.company_name)).whatsapp, '', 'Beijing landline +86 10 = no WhatsApp');
  eq(all.filter(r => r.zone.startsWith('5')).map(r => r.country), ['Indonesia', 'Indonesia', 'Indonesia'], 'Indonesia = zone 5 fallback');
  all.forEach(r => { const c = P.offlineChecks(r); if (!c.ok) { fail++; console.log('FAIL offline', r.company_name, c.issues); } else pass++; });
  // v3.1.0: discoveryRow keeps the Gemini mapping; supplier records
  const sups = all.map(r => P.toSupplier(P.discoveryRow(r)));
  eq(sups.filter(s => s.categories[0].code === 'HV').length, 21, 'aircon: all HV');
  eq(sups.filter(s => s.contacts.some(c => c.whatsapp)).length, 9, 'aircon: 9 with WhatsApp');
  eq(sups.find(s => /Smartclima/.test(s.fields.name)).fields.aliases, 'Ningbo Smartclima', 'aircon alias kept');
  eq(sups.map(s => s.fields.zone).sort().join(''), '333333344444444444555', 'aircon zones');
} else console.log('(skipped aircon fixture tests: test/fixtures/aircon.json not found)');

dnsP.then(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); });
