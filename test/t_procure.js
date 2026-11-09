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
eq(P.categoryCode('NBR insulation tube 3/8" x 19mm'), 'HV', 'NBR insulation tube -> HV');
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

/* ----- v3.1.2: templates, item lists, RFQ texts, chase list, prompt, KPIs ----- */
eq(P.TEMPLATE_COLS.length, 19, 'template = 17 discovery columns + alias, type');
ok(P.TEMPLATE_COLS.every(c => P.TEMPLATE_HELP[c]), 'every template column has help + example');
const tmplRow = {}; P.TEMPLATE_COLS.forEach(c => tmplRow[c] = P.TEMPLATE_HELP[c][1]);
const tSup = P.toSupplier(P.discoveryRow(tmplRow));
eq([tSup.fields.name, tSup.fields.country, tSup.fields.type, tSup.fields.aliases, tSup.categories[0].code, tSup.contacts[0].whatsapp], ['Foshan Vinmay Stainless Steel Co., Ltd.', 'CN', 'Manufacturer', 'Vinmay', 'MW', '+8613143276868'], 'template example row imports');
eq(P.dateIso('15/12/2026'), '2026-12-15', 'd/m/y date');
eq(P.dateIso(new Date(2026, 11, 15)), '2026-12-15', 'Date object');
eq(P.mrItem({ Description: 'Rebar Y12 x 12m', Qty: '1,200', Unit: 'pcs', 'Required date': '2026-11-20' }),
  { line: null, description: 'Rebar Y12 x 12m', spec_brand: '', qty: 1200, unit: 'pcs', required_date: '2026-11-20', category: 'RB', res_code: '', only_overseas: false, notes: '' }, 'mrItem guesses category');
eq(P.parsePasted('Cement OPC 50kg\t\t200\tbags\t20/11/2026\nPlywood 18mm\tmarine\t40\tsheets').map(x => [x.description, x.qty, x.unit, x.required_date, x.category]),
  [['Cement OPC 50kg', 200, 'bags', '2026-11-20', 'CC'], ['Plywood 18mm', 40, 'sheets', '', 'FW']], 'paste from Excel');
eq(P.parsePasted('GI duct 0.6mm - 50 sheets\nCopper pipe 3/8" 15m').map(x => [x.description, x.qty, x.unit]), [['GI duct 0.6mm', 50, 'sheets'], ['Copper pipe 3/8"', 15, 'm']], 'typed lines');
eq(P.parsePasted('Description\tQty\tUnit\nTile adhesive\t30\tbags')[0].category, 'TI', 'pasted with header');
const R = { rfq_no: 'RFQ-2611-003', title: 'Cement and plywood', deadline: '2026-11-12', delivery_place: 'Gadong, Brunei' };
const tr = P.rfqForTemplates(R, [{ description: 'Cement OPC 50kg', spec_brand: 'Holcim', qty: 200, unit: 'bags' }, { description: 'Plywood 18mm', qty: 40, unit: 'sheets' }]);
eq([tr.qtyMode, tr.items[0].desc, tr.short_desc], ['firm', 'Cement OPC 50kg (Holcim)', 'Cement OPC 50kg; Plywood 18mm'], 'RFQ -> template object');
eq(P.rfqForTemplates(R, [{ description: 'X' }]).qtyMode, 'moq', 'blank qty -> MOQ wording');
const loc = P.buildEmailFit(tr, { zone: 1, email: 'a@b.com' });
ok(!loc.attach && /delivered to Gadong, Brunei/.test(loc.body) && /200 bags/.test(loc.body), 'short RFQ: full email');
const many = P.rfqForTemplates(R, Array.from({ length: 14 }, (_, i) => ({ description: 'Item number ' + (i + 1) + ' with a fairly long specification text for testing the length', qty: 10, unit: 'no' })));
const big = P.buildEmailFit(many, { zone: 4, email: 'a@b.com' });
ok(big.attach && !big.tooLong && /attached RFQ RFQ-2611-003 \(14 items\)/.test(big.body) && /in USD/.test(big.body), 'long RFQ: short body + attach PDF (' + big.link.length + ')');
const rem = P.buildReminderEmail('reminder1', Object.assign({}, tr, { sent_date: '2026-11-08' }), { zone: 1, email: 'a@b.com' });
ok(/^Reminder: RFQ-2611-003/.test(rem.subject) && /Kindly reminding you of our RFQ-2611-003/.test(rem.body) && !/\{\{/.test(rem.body), 'reminder email');
// chase list (RESTOCK sent Sun 8 Nov: R1 Tue 10, R2 Thu 12, no-reply Sat 14)
const rq = { urgency: 'RESTOCK' };
eq(P.chaseDue({ status: 'Emailed', emailed_at: '2026-11-08 10:00' }, rq, '2026-11-09').due, '', 'not due yet');
eq(P.chaseDue({ status: 'WhatsApp sent', emailed_at: '2026-11-08 10:00', whatsapp_at: '2026-11-08 10:05' }, rq, '2026-11-10').due, 'reminder1', 'R1 due Tue');
eq(P.chaseDue({ status: 'Reminder 1', emailed_at: '2026-11-08 10:00' }, rq, '2026-11-11').due, '', 'R2 not yet Wed');
eq(P.chaseDue({ status: 'Reminder 1', emailed_at: '2026-11-08 10:00' }, rq, '2026-11-12').due, 'reminder2', 'R2 due Thu');
eq(P.chaseDue({ status: 'Reminder 2', emailed_at: '2026-11-08 10:00' }, rq, '2026-11-14').due, 'noreply', 'no reply Sat');
eq(P.chaseDue({ status: 'Quoted', emailed_at: '2026-11-08 10:00' }, rq, '2026-11-20').due, '', 'responded = nothing to chase');
eq(P.chaseDue({ status: 'Emailed', emailed_at: '2026-11-09 09:00' }, { urgency: 'SUPER URGENT' }, new Date(2026, 10, 9, 11, 30)).due, 'reminder1', 'super urgent R1 after 2 h');
const pr = P.discoveryPrompt({ rfq_no: 'RFQ-2611-003', title: 'Aircon copper pipe', urgency: 'URGENT' }, [{ description: 'Copper pipe 3/8"', category: 'HV', qty: 15, unit: 'm' }], { zones: [1, 2], exclude: ['Far East Group'] });
ok(/Brunei; Borneo \(Miri/.test(pr) && /HV HVAC/.test(pr) && pr.indexOf(P.TEMPLATE_COLS.join(',')) > 0 && /Far East Group/.test(pr), 'discovery prompt');
const K = P.rfqKpis([{ rfq_no: 'A', recipients: [
  { status: 'Quoted', valid_quote: true, emailed_at: '2026-11-08 10:00', replied_at: '2026-11-08 14:00' },
  { status: 'Quoted', valid_quote: true, emailed_at: '2026-11-08 10:00', replied_at: '2026-11-09 10:00' },
  { status: 'Quoted', valid_quote: true, emailed_at: '2026-11-08 10:00', replied_at: '2026-11-08 12:00' },
  { status: 'Declined', emailed_at: '2026-11-08 10:00', replied_at: '2026-11-08 11:00' }, { status: 'No reply', emailed_at: '2026-11-08 10:00' }, { status: 'Not contacted' }] },
  { rfq_no: 'B', recipients: [{ status: 'Emailed', emailed_at: '2026-11-09 10:00' }] }, { rfq_no: 'C', recipients: [] }]);
eq([K.rfqs, K.rfqsSent, K.rfqsOk, K.contacted, K.replied, K.quoted, K.valid, Math.round(K.replyRate * 100), Math.round(K.rfqSuccess * 100), K.avgResponseHours, K.medianResponseHours],
   [3, 2, 1, 6, 4, 3, 3, 67, 50, 7.75, 3], 'RFQ KPIs');

/* ----- v3.1.3: AI answer tables, FXR, landed cost, comparison, budget ----- */
const csv = 'Here are the suppliers:\n```\ncompany_name,country,city,email,phone,category\n"Lee Hardware, Gadong",Brunei,Gadong,sales@leehw.com.bn,+673 222 1111 / HP 871 2222,HW\ne.g. Example Co,Brunei,,,,\n```';
const pt = P.parseTable(csv);
eq([pt.rows.length, pt.rows[0].company_name, pt.rows[0].phone], [1, 'Lee Hardware, Gadong', '+673 222 1111 / HP 871 2222'], 'CSV answer with quotes, fences, example row');
const mdt = P.parseTable('| company_name | country | email |\n|---|---|---|\n| **Acme Steel** | China | a@acme.cn |\n| Beta | Vietnam | b@beta.vn |');
eq(mdt.rows.map(r => r.company_name + '/' + r.country), ['Acme Steel/China', 'Beta/Vietnam'], 'markdown table answer');
eq(P.parseTable('Company_Name\tCountry\nX\tBrunei').rows[0].country, 'Brunei', 'tab-separated answer');
eq(P.parseTable('no table here').error, 'no header row with company_name', 'no table');
const FXR = { USD: { rate: 1.2813, date: '2026-11-06' }, MYR: { rate: 0.3118 } };
eq([P.fxRate('BND', FXR), P.fxRate('sgd', FXR), P.fxRate('USD', FXR), P.fxRate('CNY', FXR)], [1, 1, 1.2813, null], 'fxRate (S$ = B$, missing = null)');
const IT = [{ line: 1, qty: 100, unit: 'bags' }, { line: 2, qty: null, unit: 'pcs' }];
const qA = { supplier_id: 'SUP-0001', currency: 'BND', clearing_bnd: 0, delivery_bnd: 50, lines: [{ line: 1, unit_price: 8.5 }, { line: 2, unit_price: 2, moq: 20 }], valid: true, lead_days: 3 };
const LA = P.landed(qA, IT, FXR);
eq([LA.goods_bnd, LA.local_bnd, LA.total_bnd, LA.lines[1].qty, LA.lines[1].qty_from], [890, 50, 940, 20, 'moq'], 'landed local quote (MOQ line uses MOQ)');
const qB = { supplier_id: 'SUP-0002', currency: 'USD', freight: 100, insurance: 0, duty_pct: 5, clearing_bnd: 80, delivery_bnd: 40, lines: [{ line: 1, unit_price: 6 }, { line: 2, unit_price: 1.2, qty: 50 }], valid: true, lead_days: 40 };
const LB = P.landed(qB, IT, FXR);
eq([+LB.goods_bnd.toFixed(2), +LB.freight_bnd.toFixed(2), +LB.duty_bnd.toFixed(2), +LB.total_bnd.toFixed(2)], [845.66, 128.13, 48.69, 1142.48], 'landed overseas quote (FXR, freight, duty, clearing)');
const qC = { supplier_id: 'SUP-0003', currency: 'CNY', lines: [{ line: 1, unit_price: 40 }, { line: 2, unit_price: 9 }], valid: true };
const qD = { supplier_id: 'SUP-0004', currency: 'MYR', lines: [{ line: 1, unit_price: 25 }], valid: true, validity: '2026-11-01' };
const qE = { supplier_id: 'SUP-0005', currency: 'BND', lines: [{ line: 1, unit_price: 8 }, { line: 2, unit_price: 2.5 }], valid: true, lead_days: 2 };
const C = P.compareQuotes(IT, [qA, qB, qC, qD, qE], { fx: FXR, today: '2026-11-09', required_date: '2026-11-20' });
eq(C.rows.map(r => r.flags.join('|')), ['', '', 'no FX rate for CNY', 'partial: no price for line 2|expired 2026-11-01', ''], 'comparison flags');
eq([C.valid, C.goalMet, C.best, C.rows[1].leadWarning], [3, true, 'SUP-0005', 'lead time 40 d > 11 d available'], 'best = lowest landed valid without lead-time warning');
eq([C.rows[0].rank, C.rows[4].rank, C.rows[1].rank, C.lowLine[1], C.lowLine[2]], [2, 1, 3, 'SUP-0002', 'SUP-0002'], 'ranks and lowest per line');
eq(+C.saving.toFixed(2), 339.98, 'saving vs highest valid (1142.48 - 802.50)');
const RI = P.resIndex({ head: ['Code', 'Resource', 'Unit', 'Price (B$)', 'Conf.'], rows: [['MATERIALS & PRODUCTS'], ['M09', 'Portland cement, 50kg bag', 'bag', 8.5, 'A'], ['M10', 'Sand', 'm3', '28.75', 'B']] });
eq(Object.keys(RI), ['M09', 'M10'], 'masterlist Res index skips group rows');
const BC = P.budgetCheck([{ line: 1, qty: 100, res_code: 'M09' }, { line: 2, qty: null, res_code: 'M10' }], RI, P.landed(qE, IT, FXR));
eq([BC.budget, BC.quoted, BC.diff, BC.covered], [850, 800, -50, 1], 'budget check vs masterlist');
eq([P.money(1234567.891), P.money(null), P.money(5, 0)], ['1,234,567.89', '—', '5'], 'money format');

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

  // v3.1.2: the RFQ Text sheet rebuilds the RFQ; the send list rows find their suppliers
  const H = P.rfqFromTextSheet(F.text);
  eq([H.rfq_no, H.title, H.deadline, H.qty_mode, H.items.length, H.items[3].category, H.delivery_place], ['RFQ-2611-002', 'SS304 Railing Tubes 1in, 1-1/2in, 2in & Fittings', '2026-11-12', 'moq', 4, 'MW', 'Bandar Seri Begawan, Brunei'], 'RFQ Text sheet -> RFQ');
  const Hr = P.rfqForTemplates(Object.assign({}, H, { certs: 'mill certificate / material test report for SS304' }), H.items.map(i => ({ description: i.description, short: i.short })));
  eq(P.buildEmail(Hr, { zone: 4, email: 'x@y.com' }).body.trim(), F.text['Email body - China'].trim(), 'rebuilt RFQ -> same China email');
  eq(P.buildWhatsApp('wa_full', Hr, { zone: 2, whatsapp: '+60193163328' }).text, F.text['WhatsApp full RFQ (no email)'], 'rebuilt RFQ -> same WhatsApp full RFQ');
  const dbS = F.discovery.map((r, i) => Object.assign({ supplier_id: P.supplierId(i + 1) }, P.toSupplier(P.discoveryRow(r)).fields, { contacts: P.toSupplier(P.discoveryRow(r)).contacts, categories: [] }));
  eq(F.discovery.map(r => P.matchSupplier({ company_name: r.company_name, country: r.country, email: r.email, phone: r.phone, website: r.website }, dbS)), dbS.map(s => s.supplier_id), 'send-list rows match their suppliers');
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
