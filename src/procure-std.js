/*
 * QS CRM v3 Procurement — v3.0 standards helpers (supplier-crm/v3.0-standards.md)
 * IDs and numbers, country/zone, urgency -> sourcing zones + goal guard, phone/email/web
 * normalisation, de-duplication keys, Brunei working days, Roundcube / WhatsApp links,
 * message templates.
 * v3.1.0: material categories (standards §3), discovery import rows -> supplier records + contacts.
 * v3.1.2: import templates, item lists (MR), RFQ texts that fit the link, reminders, chase list, discovery prompt, RFQ KPIs.
 * v3.1.3: AI answers pasted as tables, FX, landed cost in B$, quote comparison, masterlist budget check.
 * v3.2.0: weighted scoring + must-pass, reliability, reply-rate learning, quote link, rate proposals, validity alerts, monthly KPIs, saved prompts, goal guard, mailbox parsing.
 * Works in the browser (global Procure) and in Node (module.exports). No dependencies.
 */
(function (root) {
  'use strict';

  /* ---------- IDs and numbers ---------- */
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function yymm(d) { d = toDate(d); return pad(d.getFullYear() % 100, 2) + pad(d.getMonth() + 1, 2); }
  // RFQ-YYMM-NNN, MR-YYMM-NNN: running number restarts every month (month of issue).
  function docNo(prefix, date, seq) { return prefix + '-' + yymm(date) + '-' + pad(seq, 3); }
  function rfqNo(date, seq) { return docNo('RFQ', date, seq); }
  function mrNo(date, seq) { return docNo('MR', date, seq); }
  var DOC_RE = /^(RFQ|MR)-(\d{2})(\d{2})-(\d{3,})(?:-R(\d+))?$/;
  function parseDocNo(s) {
    var m = DOC_RE.exec(String(s || '').trim().toUpperCase());
    if (!m || +m[3] < 1 || +m[3] > 12) return null;
    return { prefix: m[1], yy: +m[2], mm: +m[3], seq: +m[4], rev: m[5] ? +m[5] : 0 };
  }
  // next number in the month from the numbers already used (any revision counts once)
  function nextDocNo(prefix, date, used) {
    var key = yymm(date), max = 0;
    (used || []).forEach(function (u) {
      var p = parseDocNo(u);
      if (p && p.prefix === prefix && pad(p.yy, 2) + pad(p.mm, 2) === key) max = Math.max(max, p.seq);
    });
    return docNo(prefix, date, max + 1);
  }
  function supplierId(n) { return 'SUP-' + pad(n, 4); }
  function parseSupplierId(s) { var m = /^SUP-(\d{4,})$/.exec(String(s || '').trim().toUpperCase()); return m ? +m[1] : null; }

  /* ---------- countries and sourcing zones ---------- */
  // name/alias -> [ISO2, dialling code, trunk prefix to drop]
  var COUNTRIES = {
    BN: ['Brunei', '673', ''], MY: ['Malaysia', '60', '0'], SG: ['Singapore', '65', ''],
    CN: ['China', '86', '0'], VN: ['Vietnam', '84', '0'], ID: ['Indonesia', '62', '0'],
    TH: ['Thailand', '66', '0'], PH: ['Philippines', '63', '0'], IN: ['India', '91', '0'],
    TW: ['Taiwan', '886', '0'], KR: ['South Korea', '82', '0'], JP: ['Japan', '81', '0'],
    HK: ['Hong Kong', '852', ''], AE: ['UAE', '971', '0'], TR: ['Turkey', '90', '0'],
    AU: ['Australia', '61', '0'], GB: ['United Kingdom', '44', '0'], DE: ['Germany', '49', '0'],
    IT: ['Italy', '39', ''], US: ['USA', '1', '']
  };
  var ALIASES = { 'brunei darussalam': 'BN', 'negara brunei darussalam': 'BN', 'prc': 'CN', "people's republic of china": 'CN',
    'viet nam': 'VN', 'korea': 'KR', 'republic of korea': 'KR', 'united arab emirates': 'AE', 'uk': 'GB',
    'united states': 'US', 'turkiye': 'TR' };
  var BORNEO_RE = /\b(borneo|sarawak|sabah|labuan|miri|limbang|lawas|bintulu|sibu|kuching|kota kinabalu|sandakan|tawau|marudi|kuala belait)\b/i;
  function countryCode(name) {
    var s = String(name || '').toLowerCase().replace(/\(.*?\)/g, '').trim();
    if (!s) return '';
    if (/^[a-z]{2}$/.test(s) && COUNTRIES[s.toUpperCase()]) return s.toUpperCase();
    if (ALIASES[s]) return ALIASES[s];
    for (var k in COUNTRIES) if (COUNTRIES[k][0].toLowerCase() === s) return k;
    return '';
  }
  // Zone 1 Brunei · 2 Borneo (Sarawak/Sabah/Labuan) · 3 MY/SG · 4 China/Vietnam · 5 other countries
  var ZONES = { 1: 'Brunei', 2: 'Borneo', 3: 'MY/SG', 4: 'China/Vietnam', 5: 'Other countries' };
  function zoneOf(country, city) {
    var cc = countryCode(country), where = String(country || '') + ' ' + String(city || '');
    if (cc === 'BN') return 1;
    if (cc === 'MY') return BORNEO_RE.test(where) ? 2 : 3;
    if (cc === 'SG') return 3;
    if (cc === 'CN' || cc === 'VN') return 4;
    return 5;
  }
  function zoneLabel(z, country) {
    var cc = countryCode(country);
    if (z === 4) return '4 ' + (cc === 'VN' ? 'Vietnam' : 'China');
    return z + ' ' + ZONES[z];
  }

  /* ---------- urgency -> zones, priority, goal guard ---------- */
  // Urgency = calendar days from RFQ date to required-on-site date (Gemz, 8 Nov 2026):
  //   SUPER URGENT 1-2 · URGENT 3-7 · NORMAL 8-14 · NEEDED SOON 15-21 (22-29 counted here too) · RESTOCK 30+ or no date
  // Each class: zones to contact first, zone priority (1 = send first), freight, channels, and the RFQ timetable
  // (offsets from sending: h = clock hours, wd = Brunei working days).
  var URGENCY = [
    { code: 'SUPER URGENT', max: 2, zones: [1], priority: { 1: 1 }, widenTo: [2], freight: 'local delivery / pick-up',
      channels: 'call + WhatsApp full RFQ + email at the same time', reminder1: { h: 2 }, reminder2: { h: 4 }, deadline: { h: 6 } },
    { code: 'URGENT', max: 7, zones: [1, 2], priority: { 1: 1, 2: 1 }, widenTo: [3], freight: 'local delivery; MY/SG by air/courier if widened',
      channels: 'email + WhatsApp within the hour', reminder1: { h: 4 }, reminder2: { wd: 1 }, deadline: { wd: 1 } },
    { code: 'NORMAL', max: 14, zones: [1, 2, 3], priority: { 1: 1, 2: 1, 3: 2 }, widenTo: [4], freight: 'local / short sea; zone 4 by air only',
      channels: 'email then WhatsApp', reminder1: { wd: 1 }, reminder2: { wd: 2 }, deadline: { wd: 2 } },
    { code: 'NEEDED SOON', max: 29, zones: [1, 2, 3, 4], priority: { 1: 1, 2: 1, 3: 1, 4: 2 }, widenTo: [5], freight: 'zone 4 by air/express, compare landed cost',
      channels: 'email then WhatsApp', reminder1: { wd: 2 }, reminder2: { wd: 3 }, deadline: { wd: 3 } },
    { code: 'RESTOCK', max: Infinity, zones: [4, 3, 1, 2], priority: { 4: 1, 3: 2, 1: 2, 2: 2 }, vietnamPriority: 2, widenTo: [5], freight: 'sea (lead-time warning if quote > days available)',
      channels: 'email then WhatsApp', benchmark: [1, 2], reminder1: { wd: 2 }, reminder2: { wd: 4 }, deadline: { wd: 4 } }
  ];
  function daysBetween(a, b) { return Math.round((stripTime(toDate(b)) - stripTime(toDate(a))) / 86400000); }
  function urgencyClass(code) { for (var i = 0; i < URGENCY.length; i++) if (URGENCY[i].code === code) return URGENCY[i]; return URGENCY[URGENCY.length - 1]; }
  function urgencyOf(rfqDate, requiredDate) {
    if (!requiredDate) return 'RESTOCK';
    var d = Math.max(daysBetween(rfqDate, requiredDate), 0);
    for (var i = 0; i < URGENCY.length; i++) if (d <= URGENCY[i].max) return URGENCY[i].code;
    return 'RESTOCK';
  }
  // Which zones to contact first, and the priority of each zone (1 = send first).
  // onlyOverseas: item/brand only made in China (or another zone-4/5 country) -> that zone P1 + air/express when < 30 days.
  function sourcingPlan(urgency, onlyOverseas) {
    var c = urgencyClass(urgency), p = { code: c.code, zones: c.zones.slice(), priority: JSON.parse(JSON.stringify(c.priority)),
      widenTo: (c.widenTo || []).slice(), freight: c.freight, channels: c.channels, benchmark: (c.benchmark || []).slice() };
    if (onlyOverseas && c.code !== 'RESTOCK') {
      if (p.zones.indexOf(4) < 0) p.zones.push(4);
      p.priority[4] = 1; p.freight = 'air/express from the maker; local suppliers as benchmark'; p.benchmark = [1, 2];
    }
    return p;
  }
  // lead-time warning: quote lead time (days) longer than the days left to the required date
  function leadTimeWarning(rfqDate, requiredDate, leadDays) {
    if (!requiredDate || leadDays == null) return '';
    var left = daysBetween(rfqDate, requiredDate);
    return leadDays > left ? 'lead time ' + leadDays + ' d > ' + left + ' d available' : '';
  }
  // Goal guard: >= 3 valid quotes. Widen when no supplier in the allowed zones, or < 3 valid quotes
  // after the 2nd reminder. Returns the zones to add next (next zones, then zone 5), or [] if goal met.
  function goalGuard(state) {
    var used = state.zonesUsed || [], valid = state.validQuotes || 0;
    var short = (state.suppliersInZones === 0) || (valid < 3 && state.reminder2Done);
    if (!short) return { widen: false, zones: [] };
    var order = [1, 2, 3, 4, 5], next = order.filter(function (z) { return used.indexOf(z) < 0; });
    var add = next.filter(function (z) { return z < 5; });
    if (!add.length && next.indexOf(5) >= 0) add = [5];
    else if (add.length) add = [add[0]];
    return { widen: add.length > 0, zones: add, flag: add.length ? 'search widened to ' + add.map(function (z) { return ZONES[z]; }).join(', ') : 'all zones used' };
  }

  /* ---------- phones ---------- */
  var DIAL = Object.keys(COUNTRIES).map(function (k) { return [COUNTRIES[k][1], k]; })
    .sort(function (a, b) { return b[0].length - a[0].length; });
  function kindOf(cc, n) {
    switch (cc) {
      case 'BN': return n.length !== 7 ? 'invalid' : /^[78]/.test(n) ? 'mobile' : /^[2-5]/.test(n) ? 'landline' : 'invalid';
      case 'MY': return /^1\d{8,9}$/.test(n) ? 'mobile' : /^[3-9]\d{7,8}$/.test(n) ? 'landline' : 'invalid';
      case 'SG': return !/^\d{8}$/.test(n) ? 'invalid' : /^[89]/.test(n) ? 'mobile' : /^6/.test(n) ? 'landline' : 'other';
      case 'CN': return /^1[3-9]\d{9}$/.test(n) ? 'mobile' : /^(10|2\d|[3-9]\d{2})\d{7,8}$/.test(n) ? 'landline' : 'invalid';
      case 'VN': return /^[35789]\d{8}$/.test(n) ? 'mobile' : /^2\d{9}$/.test(n) ? 'landline' : 'invalid';
      case 'ID': return /^8\d{8,11}$/.test(n) ? 'mobile' : /^[2-7]\d{6,10}$/.test(n) ? 'landline' : 'invalid';
      case 'TH': return /^[689]\d{8}$/.test(n) ? 'mobile' : /^[2-7]\d{7}$/.test(n) ? 'landline' : 'invalid';
      case 'PH': return /^9\d{9}$/.test(n) ? 'mobile' : /^[2-8]\d{7,8}$/.test(n) ? 'landline' : 'invalid';
      case 'IN': return /^[6-9]\d{9}$/.test(n) ? 'mobile' : /^[1-5]\d{9}$/.test(n) ? 'landline' : 'invalid';
      default: return n.length >= 6 && n.length <= 13 ? 'unknown' : 'invalid';
    }
  }
  // "+86 131 4327 6868 / 0757-85436751", "+673 242 8981 / HP 874 0081, 890 6000", "0757-82707815 / WA +86 137 0260 0484"
  function parsePhones(raw, country) {
    var home = countryCode(country), out = [], seen = {};
    String(raw || '').split(/\s*\/\s*|\s*[,;]\s*|\s+or\s+|\n/).forEach(function (part) {
      var p = part.trim(); if (!p) return;
      var waTag = /\b(WA|whats\s*app)\b/i.test(p), mobTag = /\b(HP|H\/P|mob(ile)?|cell)\b/i.test(p);
      var s = p.replace(/[^\d+]/g, '');
      if (s.replace(/\+/g, '').length < 6) return;
      var cc = home, nat;
      if (/^\+|^00/.test(s)) {
        s = s.replace(/^\+|^00/, '').replace(/\+/g, '');
        var hit = null; for (var i = 0; i < DIAL.length; i++) if (s.indexOf(DIAL[i][0]) === 0) { hit = DIAL[i]; break; }
        if (!hit) { out.push({ raw: p, e164: '+' + s, cc: '', kind: 'unknown', whatsapp: waTag }); return; }
        cc = hit[1]; nat = s.slice(hit[0].length);
        if (nat.charAt(0) === '0' && COUNTRIES[cc][2] === '0') nat = nat.slice(1); // "+60 (0)19..."
      } else {
        if (!cc) { out.push({ raw: p, e164: '', cc: '', kind: 'invalid', whatsapp: false, note: 'no country code' }); return; }
        nat = s.replace(/\+/g, '');
        if (COUNTRIES[cc][2] && nat.indexOf(COUNTRIES[cc][2]) === 0) nat = nat.slice(COUNTRIES[cc][2].length);
      }
      var kind = kindOf(cc, nat), e164 = '+' + COUNTRIES[cc][1] + nat;
      if (seen[e164]) return; seen[e164] = 1;
      out.push({ raw: p, e164: e164, cc: cc, kind: kind,
        whatsapp: waTag || kind === 'mobile' || (mobTag && kind !== 'landline'), tag: waTag ? 'WA' : mobTag ? 'HP' : '' });
    });
    return out;
  }
  // Best WhatsApp number: a WA-tagged number first, then the first mobile.
  function whatsappOf(raw, country) {
    var ph = parsePhones(raw, country).filter(function (x) { return x.whatsapp && x.kind !== 'invalid'; });
    var wa = ph.filter(function (x) { return x.tag === 'WA'; });
    return (wa[0] || ph[0] || {}).e164 || '';
  }
  function digits(e164) { return String(e164 || '').replace(/\D/g, ''); }

  /* ---------- email, web, de-duplication ---------- */
  var FREE_MAIL = ['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.sg', 'yahoo.com.my', 'hotmail.com', 'outlook.com',
    'live.com', 'icloud.com', 'msn.com', '163.com', '126.com', 'qq.com', 'sina.com', 'sina.cn', 'foxmail.com', 'aliyun.com',
    'yeah.net', 'tom.com', 'sohu.com', 'streamyx.com', 'brunet.bn', 'simpur.net.bn'];
  var PLATFORMS = ['alibaba.com', '1688.com', 'made-in-china.com', 'globalsources.com', 'indiamart.com', 'tradeindia.com',
    'suppliergo.com', 'archify.com', 'facebook.com', 'linkedin.com', 'instagram.com', 'issuu.com', 'yellowpages.com.bn',
    'bruneiproperty.com.bn', 'miribiz.com', 'newpages.asia', 'google.com', 'wa.me'];
  var EMAIL_RE = /^[^\s@<>()"',;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
  function splitEmails(raw) {
    var out = [];
    String(raw || '').split(/\s*[\/,;]\s*|\s+/).forEach(function (e) {
      e = e.trim().replace(/^mailto:/i, '').replace(/[.)]+$/, '').toLowerCase();
      if (EMAIL_RE.test(e) && out.indexOf(e) < 0) out.push(e);
    });
    return out;
  }
  function emailDomain(e) { e = String(e || '').toLowerCase(); return e.indexOf('@') > 0 ? e.split('@')[1] : ''; }
  function webDomain(url) {
    var s = String(url || '').trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/^[a-z]+:\/\//, '').split(/[\/?#]/)[0].replace(/:\d+$/, '').replace(/^www\d?\./, '').replace(/^m\./, '');
    return /\./.test(s) ? s : '';
  }
  function baseDomain(d) { // abcsteel.m.en.alibaba.com -> alibaba.com ; sonha.com.vn -> sonha.com.vn
    var p = String(d || '').split('.'); if (p.length <= 2) return d;
    var sl = p[p.length - 2]; var two = /^(com|net|org|edu|gov|co|ac)$/.test(sl) && p[p.length - 1].length === 2;
    return p.slice(two ? -3 : -2).join('.');
  }
  function isFreeMail(d) { return FREE_MAIL.indexOf(String(d || '').toLowerCase()) >= 0; }
  function isPlatform(d) { return PLATFORMS.indexOf(baseDomain(String(d || '').toLowerCase())) >= 0; }
  function normName(n) {
    return String(n || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/&/g, ' and ')
      .replace(/\b(sdn\.?\s*bhd\.?|bhd|pte\.?\s*ltd\.?|co\.?,?\s*ltd\.?|company|limited|ltd|inc|corp(oration)?|llc|jsc|enterprise|trading|industries|industry|group|factory|the)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }
  // keys used to find duplicates: email, phone (E.164), company web domain, company email domain, name+country
  function dedupKeys(s) {
    var k = [], cc = countryCode(s.country);
    splitEmails(s.email).forEach(function (e) { k.push('email:' + e); var d = emailDomain(e); if (d && !isFreeMail(d)) k.push('dom:' + baseDomain(d)); });
    parsePhones(s.phone, s.country).concat(parsePhones(s.whatsapp, s.country)).forEach(function (p) { if (p.e164 && p.kind !== 'invalid') k.push('tel:' + p.e164); });
    var w = webDomain(s.website); if (w && !isPlatform(w)) k.push('dom:' + baseDomain(w));
    var nm = normName(s.company_name || s.name); if (nm) k.push('name:' + nm + '|' + cc);
    return k.filter(function (x, i) { return k.indexOf(x) === i; });
  }
  function findDuplicates(rows) { // -> [{a, b, keys}] index pairs sharing at least one key
    var by = {}, pairs = {};
    rows.forEach(function (r, i) { dedupKeys(r).forEach(function (key) { (by[key] = by[key] || []).push(i); }); });
    Object.keys(by).forEach(function (key) {
      var ix = by[key]; for (var a = 0; a < ix.length; a++) for (var b = a + 1; b < ix.length; b++) {
        var id = ix[a] + '-' + ix[b]; (pairs[id] = pairs[id] || { a: ix[a], b: ix[b], keys: [] }).keys.push(key);
      }
    });
    return Object.keys(pairs).map(function (k) { return pairs[k]; });
  }
  // Format checks that need no network. MX / A lookups are done in the browser (checkDns).
  function offlineChecks(s) {
    var issues = [], cc = countryCode(s.country);
    if (!s.company_name) issues.push('no company name');
    if (!cc) issues.push('unknown country "' + (s.country || '') + '"');
    var em = splitEmails(s.email);
    if (s.email && !em.length) issues.push('email not valid');
    var ph = parsePhones(s.phone, s.country);
    ph.forEach(function (p) { if (p.kind === 'invalid') issues.push('phone ' + p.raw + ' not valid for ' + (cc || '?')); });
    if (!em.length && !ph.length && !s.whatsapp) issues.push('no email or phone - platform/form only');
    var w = webDomain(s.website); if (w && isPlatform(w)) issues.push('website is a platform listing (' + baseDomain(w) + ')');
    if (em.length && em.every(function (e) { return isFreeMail(emailDomain(e)); })) issues.push('free-mail address only');
    return { ok: !issues.filter(function (i) { return !/free-mail|platform/.test(i); }).length, issues: issues };
  }
  // Browser only: free DNS-over-HTTPS (Google, then Cloudflare). Returns {mx: bool|null, a: bool|null}.
  function checkDns(domain, fetchFn) {
    fetchFn = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchFn || !domain) return Promise.resolve({ mx: null, a: null });
    function q(type) {
      var urls = ['https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=' + type,
                  'https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(domain) + '&type=' + type];
      function go(i) {
        if (i >= urls.length) return Promise.resolve(null);
        return fetchFn(urls[i], { headers: { accept: 'application/dns-json' } }).then(function (r) { return r.json(); })
          .then(function (j) { return j.Status === 0 && !!(j.Answer && j.Answer.length); }, function () { return go(i + 1); });
      }
      return go(0);
    }
    return Promise.all([q('MX'), q('A')]).then(function (r) { return { mx: r[0], a: r[1] }; });
  }

  /* ---------- importers ---------- */
  // city from an address: the 1-2 parts before the country, postcodes removed
  function cityFromAddress(addr, country) {
    var parts = String(addr || '').split(',').map(function (s) { return s.replace(/\(.*?\)/g, '').replace(/\b\d{5,6}\b/g, '').replace(/#\S+/g, '').trim(); }).filter(Boolean);
    var cc = countryCode(country), cname = (COUNTRIES[cc] || [''])[0].toLowerCase();
    if (cc === 'SG' || cc === 'HK') return COUNTRIES[cc][0];
    if (parts.length && parts[parts.length - 1].toLowerCase() === cname) parts.pop();
    var noStreet = parts.filter(function (s) { return !/\d/.test(s); });
    if (noStreet.length) parts = noStreet;
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0].replace(/^(.*?)\s*\b(province|city)\b.*$/i, '$1').trim() || parts[0];
    return parts.slice(-2).join(', ').replace(/\s+(Province|City)\b/g, '');
  }
  // Gemini "Aircon Materials Suppliers Directory" row -> discovery row (spec §5 mapping)
  // in: {Country, 'Company Name', Status, 'Export Responsiveness', Specialty, Address, 'Contact Email', 'Contact Number'}
  function fromGeminiDirectory(r, opts) {
    opts = opts || {};
    var name = String(r['Company Name'] || '').trim(), alias = (/\((.*?)\)/.exec(name) || [])[1] || '';
    var emails = splitEmails(r['Contact Email']), dom = emails.map(emailDomain).filter(function (d) { return d && !isFreeMail(d); })[0] || '';
    var notes = [];
    if (r['Export Responsiveness']) notes.push('AI estimate (Gemini) export responsiveness: ' + r['Export Responsiveness']);
    if (r.Status && !/pending contact/i.test(r.Status)) notes.push('Gemini status: ' + r.Status);
    if (dom) notes.push('website guessed from email domain');
    return {
      company_name: name.replace(/\s*\(.*?\)\s*/g, ' ').trim(), alias: alias, country: String(r.Country || '').trim(),
      city: cityFromAddress(r.Address, r.Country), address: String(r.Address || '').trim(), website: dom ? 'https://' + dom : '',
      category: opts.category || 'HV', specialty: String(r.Specialty || '').trim(), contact_person: '',
      email: emails.join(' / '), phone: String(r['Contact Number'] || '').trim(), whatsapp: whatsappOf(r['Contact Number'], r.Country),
      source_url: opts.source || 'Aircon_Materials_Suppliers_Directory-v2.xlsx', notes: notes.join('; '),
      found_by: 'Gemini', found_on: opts.found_on || '', verification: 'Unverified', zone: zoneLabel(zoneOf(r.Country, r.Address), r.Country)
    };
  }

  /* ---------- Brunei working days (Mon-Thu + Sat; Fri and Sun off) ---------- */
  function toDate(d) { if (d instanceof Date) return new Date(d.getTime()); if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) { var p = d.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); } return new Date(d); }
  function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function iso(d) { d = toDate(d); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
  function isWorkday(d, holidays) { d = toDate(d); var w = d.getDay(); return w !== 5 && w !== 0 && (holidays || []).indexOf(iso(d)) < 0; }
  function addWorkdays(d, n, holidays) { d = stripTime(toDate(d)); while (n > 0) { d.setDate(d.getDate() + 1); if (isWorkday(d, holidays)) n--; } return d; }
  // RFQ timetable from the send date-time, by urgency class (default RESTOCK: R1 +2 wd, R2 + deadline +4 wd).
  // "no reply" flag: 1 wd after the later of deadline and reminder 2 (hour-based classes: at the deadline).
  function isoT(d) { return iso(d) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2); }
  function offset(sent, o, h) { if (o.h) return new Date(toDate(sent).getTime() + o.h * 3600000); return addWorkdays(sent, o.wd, h); }
  function timetable(sent, opts) {
    opts = opts || {}; var h = opts.holidays || [], c = urgencyClass(opts.urgency || 'RESTOCK'), hourly = !!c.deadline.h;
    var fmt = hourly ? isoT : iso;
    var deadline = opts.deadline ? toDate(opts.deadline) : offset(sent, c.deadline, h);
    var r1 = offset(sent, c.reminder1, h), r2 = offset(sent, c.reminder2, h);
    var noReply = hourly ? deadline : addWorkdays(deadline > r2 ? deadline : r2, 1, h);
    return { urgency: c.code, sent: fmt(toDate(sent)), reminder1: fmt(r1), reminder2: fmt(r2), deadline: fmt(deadline), noReply: fmt(noReply) };
  }
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function longDate(d) { d = toDate(d); return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }

  /* ---------- links ---------- */
  var ROUNDCUBE = 'https://emailmg.ipage.com/roundcube/';
  var LINK_MAX = 1600; // tested 8 Nov 2026: links up to ~1,580 chars open fine from Excel
  function composeLink(to, subject, body, base) {
    return (base || ROUNDCUBE) + '?_task=mail&_action=compose&_to=' + encodeURIComponent(to) +
      '&_subject=' + encodeURIComponent(subject) + '&_body=' + encodeURIComponent(body);
  }
  function mailtoLink(to, subject, body) { return 'mailto:' + encodeURIComponent(to).replace(/%40/g, '@') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
  function waLink(e164, text) { return 'https://wa.me/' + digits(e164) + (text ? '?text=' + encodeURIComponent(text) : ''); }

  /* ---------- templates ---------- */
  // Audience: L = zones 1-3 (local / regional, delivered BSB), O = zones 4-5 (overseas, USD, FOB + CIF Muara)
  function audienceOf(zone) { return zone >= 4 ? 'O' : 'L'; }
  function currencyText(zone) { return zone === 1 ? 'in B$' : zone <= 3 ? 'in B$, S$ or RM' : 'in USD'; }
  var T = {
    subject: '{{rfq_no}} - {{title}} - ARZA SDN BHD',
    open_L: 'Dear {{greeting}},\n\nGood day. ARZA SDN BHD (Brunei) would like to request your best quotation for the following, delivered to {{delivery_place}}:',
    open_O: 'Dear {{greeting}},\n\nGood day. ARZA SDN BHD is a construction company in Brunei Darussalam. We would like to request your best quotation for the following:',
    qty_firm: 'Please quote your unit price {{currency}} for the quantities above, with price breaks if any.',
    qty_moq: 'Quantities are being finalised. Please state your Minimum Order Quantity (MOQ) for each item and quote the unit price at MOQ {{currency}}, with price breaks if any.',
    terms_L: 'Please also include stock availability, delivery lead time and charges to {{delivery_short}}, payment terms and quote validity.',
    terms_O: 'Please quote FOB (nearest port) and, if possible, CIF Muara Port, Brunei. Please also include production lead time, packing, payment terms, quote validity, and {{certs}}.',
    close: 'Kindly reply by {{deadline}}.',
    online: 'You may also enter your prices online (no login needed): {{quote_link}}',
    wa_follow: 'Good day, this is {{sender}}, Quantity Surveyor of ARZA SDN BHD (Brunei). We have emailed our {{rfq_no}} to {{supplier_email}} for {{short_desc}}. Kindly check and send your {{ask_short}} by {{deadline}}. Thank you.',
    wa_full: 'Good day, this is {{sender}}, Quantity Surveyor of ARZA SDN BHD (Brunei). Request for quotation {{rfq_no}}:\n{{items_wa}}\n{{qty_wa}} - please send your {{ask_wa}} by {{deadline}}. Thank you.',
    reminder1: 'Good day, this is {{sender}} of ARZA SDN BHD (Brunei). Kindly reminding you of our {{rfq_no}} for {{short_desc}} sent on {{sent_date}}. May we have your quotation by {{deadline}}? Thank you.',
    reminder2: 'Good day, this is {{sender}} of ARZA SDN BHD (Brunei). Final reminder for our {{rfq_no}} ({{short_desc}}). We will close the comparison on {{close_date}}. If you cannot quote, a short "regret" reply is appreciated. Thank you.',
    thanks: 'Good day, this is {{sender}} of ARZA SDN BHD (Brunei). Thank you for your quotation for {{rfq_no}}. We are pleased to inform you that it has been accepted; our procurement team will contact you with the purchase order. Thank you.',
    regret: 'Good day, this is {{sender}} of ARZA SDN BHD (Brunei). Thank you for your quotation for {{rfq_no}}. This time the order has been placed with another supplier. We appreciate your time and will keep you in our list for future requirements. Thank you.'
  };
  function fill(t, v) { return t.replace(/\{\{(\w+)\}\}/g, function (m, k) { return v[k] != null && v[k] !== '' ? String(v[k]) : m; }); }
  function itemsText(items, wa) {
    return items.map(function (it, i) {
      var q = it.qty ? ' - ' + it.qty + ' ' + (it.unit || '') : '';
      return wa ? (i + 1) + ') ' + (it.short || it.desc) + q.trim().replace(/^-/, ' -') : (i + 1) + '. ' + it.desc + q;
    }).join('\n');
  }
  // rfq: {rfq_no, title, short_desc, items:[{desc, short, qty, unit}], qtyMode 'firm'|'moq', deadline (date),
  //       delivery_place, delivery_short, certs, sender}; sup: {zone, email, greeting}
  function buildEmail(rfq, sup) {
    var a = audienceOf(sup.zone), v = vars(rfq, sup);
    var body = [fill(T['open_' + a], v), itemsText(rfq.items, false), fill(rfq.qtyMode === 'moq' ? T.qty_moq : T.qty_firm, v),
      fill(T['terms_' + a], v), fill(T.close, v) + (sup.quote_link ? '\n' + fill(T.online, v) : '')].join('\n\n') + '\n';
    var subject = fill(T.subject, v), link = sup.email ? composeLink(sup.email, subject, body) : '';
    return { subject: subject, body: body, link: link, tooLong: link.length > LINK_MAX };
  }
  function buildWhatsApp(kind, rfq, sup, extra) {
    var v = vars(rfq, sup); for (var k in (extra || {})) v[k] = extra[k];
    var text = fill(T[kind], v);
    if (sup.quote_link && ['wa_follow', 'wa_full', 'reminder1', 'reminder2'].indexOf(kind) >= 0) text += ' Quote online (no login): ' + sup.quote_link;
    return { text: text, link: sup.whatsapp ? waLink(sup.whatsapp, text) : '' };
  }
  function vars(rfq, sup) {
    var moq = rfq.qtyMode === 'moq';
    return {
      rfq_no: rfq.rfq_no, title: rfq.title, short_desc: rfq.short_desc, greeting: sup.greeting || 'Sir/Madam',
      delivery_place: rfq.delivery_place || 'Bandar Seri Begawan, Brunei', delivery_short: rfq.delivery_short || 'Brunei',
      currency: currencyText(sup.zone), certs: rfq.certs || 'mill certificate / material test report',
      deadline: longDate(rfq.deadline), sender: rfq.sender || 'Gemar', supplier_email: sup.email || '', quote_link: sup.quote_link || '',
      items_wa: itemsText(rfq.items, true),
      qty_wa: moq ? 'Quantities being finalised' : 'Quantities as above',
      ask_wa: moq ? 'MOQ per item and unit price at MOQ, lead time, delivery to Brunei, payment terms and validity' : 'unit prices, lead time, delivery to Brunei, payment terms and validity',
      ask_short: moq ? 'MOQ and unit price at MOQ' : 'quotation',
      sent_date: rfq.sent_date ? longDate(rfq.sent_date) : '', close_date: rfq.close_date ? longDate(rfq.close_date) : ''
    };
  }

  /* ---------- statuses and KPIs ---------- */
  var RECIPIENT_STATUS = ['Not contacted', 'Emailed', 'WhatsApp sent', 'Reminder 1', 'Reminder 2', 'Replied', 'Quoted', 'Declined', 'No reply', 'Bounced'];
  var RESPONDED = ['Replied', 'Quoted', 'Declined'];
  var VERIFICATION = ['Unverified', 'Checked', 'Verified', 'Failed'];
  function kpis(recips) { // recips: [{status, valid_quote:bool, first_contact, first_reply}]
    var contacted = recips.filter(function (r) { return r.status && r.status !== 'Not contacted'; });
    var replied = contacted.filter(function (r) { return RESPONDED.indexOf(r.status) >= 0; });
    var quoted = contacted.filter(function (r) { return r.status === 'Quoted'; });
    var valid = quoted.filter(function (r) { return r.valid_quote; });
    var hrs = replied.filter(function (r) { return r.first_contact && r.first_reply; })
      .map(function (r) { return (toDate(r.first_reply) - toDate(r.first_contact)) / 3600000; });
    return { contacted: contacted.length, replied: replied.length, quoted: quoted.length, valid: valid.length,
      replyRate: contacted.length ? replied.length / contacted.length : 0, quoteRate: contacted.length ? quoted.length / contacted.length : 0,
      goalMet: valid.length >= 3, avgResponseHours: hrs.length ? hrs.reduce(function (a, b) { return a + b; }, 0) / hrs.length : null };
  }
  // how many suppliers to contact for >= 3 valid quotes: ceil(3 / validQuoteRate), 8-10 when no history
  function contactTarget(validQuoteRate, history) {
    if (!history || history < 5 || !validQuoteRate) return 10;
    return Math.max(5, Math.min(25, Math.ceil(3 / validQuoteRate)));
  }

  /* ---------- v3.1.0: material categories (standards §3) ---------- */
  // [code, name, examples, masterlist rate prefix] - same list as the categories table in supabase/schema.sql
  var CATEGORIES = [
    ['CC', 'Cement, concrete & aggregates', 'cement, ready-mix, sand, aggregate, admixtures', 'CN'],
    ['RB', 'Reinforcement', 'rebar, BRC mesh, tie wire, spacers', 'RB'],
    ['FW', 'Formwork & timber', 'plywood, timber, props', 'FW'],
    ['BW', 'Blocks & bricks', 'hollow blocks, bricks, lintels', 'BW'],
    ['MW', 'Structural steel & metalwork', 'sections, plates, hollow sections, SS tubes & railings, gratings', ''],
    ['RF', 'Roofing, cladding & rainwater', 'metal deck, insulation, foil, gutters, downpipes', ''],
    ['DW', 'Doors, windows & glazing', 'doors, frames, alu windows, glass, ironmongery sets', ''],
    ['TI', 'Tiles & stone', 'floor/wall tiles, adhesive, grout', 'TI'],
    ['FN', 'Finishes', 'plaster, skim, ceiling boards, partitions', 'FN'],
    ['PT', 'Paint & coatings', 'emulsion, weather-shield, primers, epoxy floor', 'FN'],
    ['WP', 'Waterproofing & sealants', 'membranes, coatings, sealants, waterstops', 'WP'],
    ['RP', 'Concrete repair & chemicals', 'repair mortar, bonding agent, epoxy injection, anti-corrosion', ''],
    ['PL', 'Plumbing, sanitary & tanks', 'pipes & fittings, sanitary ware, tanks, pumps', 'PL'],
    ['DR', 'Drainage & precast', 'uPVC/RC pipes, precast U-drains, manholes, gratings, culverts', ''],
    ['EL', 'Electrical & lighting', 'cables, DBs, switches, lights, conduits', 'EL'],
    ['HV', 'HVAC / aircon & ducting', 'GI ducting, copper pipe, insulation, aircon units', ''],
    ['FP', 'Fire protection & safety systems', 'extinguishers, hose reels, detectors, signage', ''],
    ['FF', 'Furniture, fit-out & equipment', 'furniture, blinds, TVs, projectors, signage', ''],
    ['HW', 'Hardware & fixings', 'anchors, bolts, screws, adhesives', ''],
    ['CS', 'Consumables, tools & PPE', 'discs, welding rods, small tools, PPE', ''],
    ['PH', 'Plant & equipment hire', 'excavator, lorry, scaffold, generator', 'P'],
    ['SV', 'Services & subcontract', 'testing labs, transport, freight forwarding, specialist sub-con', 'S'],
    ['EW', 'External works & landscaping', 'fencing, paving, kerbs, turfing', '']
  ];
  // keyword guesses for free-text categories ("Stainless steel - railing tubes & fittings" -> MW); first match wins
  var CAT_WORDS = [
    ['HV', /\b(hvac|air[\s-]?con|aircond|ducting|duct|refrigera|copper (pipe|tube)|chiller|nbr|armaflex|insulation tube)\w*/i],
    ['FP', /\b(fire|extinguisher|hose reel|sprinkler|smoke detector)\w*/i],
    ['RB', /\b(rebar|reinforc|brc|tie wire|y\d{2}\b)\w*/i],
    ['MW', /\b(stainless|ss30[46]|steel|metal ?work|railing|hollow section|grating|beam|channel|angle bar|plate)\w*/i],
    ['CC', /\b(cement|concrete|ready[\s-]?mix|aggregate|sand|admixture)\w*/i],
    ['FW', /\b(formwork|plywood|timber|props?)\b/i],
    ['BW', /\b(block|brick|lintel)s?\b/i],
    ['RF', /\b(roof|cladding|metal deck|gutter|downpipe|rainwater)\w*/i],
    ['DW', /\b(door|window|glazing|glass|ironmongery)\w*/i],
    ['TI', /\b(tile|tiling|stone|granite|marble|grout)\w*/i],
    ['PT', /\b(paint|coating|primer|emulsion|epoxy floor)\w*/i],
    ['WP', /\b(waterproof|membrane|sealant|waterstop)\w*/i],
    ['RP', /\b(repair mortar|bonding agent|epoxy injection|anti[\s-]?corrosion|concrete repair)\w*/i],
    ['PL', /\b(plumbing|sanitary|pipe|tank|pump|tap|basin|wc)\w*/i],
    ['DR', /\b(drain|precast|culvert|manhole|u[\s-]?drain)\w*/i],
    ['EL', /\b(electric|cable|lighting|light|switch|conduit|db\b)\w*/i],
    ['FN', /\b(plaster|skim|ceiling|partition|gypsum|finish)\w*/i],
    ['FF', /\b(furniture|blind|fit[\s-]?out|projector|tv)\w*/i],
    ['HW', /\b(hardware|anchor|bolt|screw|fixing|fastener)\w*/i],
    ['CS', /\b(consumable|ppe|welding rod|cutting disc|tools?)\b/i],
    ['PH', /\b(hire|rental|excavator|lorry|crane|scaffold|generator)\w*/i],
    ['SV', /\b(service|testing|laboratory|transport|freight|forwarding|sub[\s-]?con)\w*/i],
    ['EW', /\b(fencing|fence|paving|kerb|turf|landscap)\w*/i]
  ];
  function categoryName(code) { for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i][0] === code) return CATEGORIES[i][1]; return ''; }
  // one text -> one code: the code itself, the category name, else a keyword guess, else ''
  function categoryCode(text) {
    var s = String(text || '').trim(); if (!s) return '';
    var up = s.toUpperCase(), lo = s.toLowerCase(), i;
    for (i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i][0] === up) return CATEGORIES[i][0];
    for (i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i][1].toLowerCase() === lo) return CATEGORIES[i][0];
    for (i = 0; i < CAT_WORDS.length; i++) if (CAT_WORDS[i][1].test(s)) return CAT_WORDS[i][0];
    return '';
  }
  // "HV, PL" / "HV / Plumbing" -> ['HV', 'PL']; a free text that is one category name stays one
  function categoryCodes(text) {
    var one = categoryCode(text);
    var parts = String(text || '').split(/\s*[,;\/|]\s*/).filter(Boolean);
    if (parts.length < 2) return one ? [one] : [];
    var codes = parts.map(function (p) { return /^[A-Za-z]{2}$/.test(p) || categoryName(String(p).toUpperCase()) ? categoryCode(p) : ''; }).filter(Boolean);
    if (codes.length === parts.length) return codes.filter(function (c, i) { return codes.indexOf(c) === i; });
    return one ? [one] : [];
  }
  function countryName(cc) { return (COUNTRIES[String(cc || '').toUpperCase()] || [cc || ''])[0]; }
  var FOUND_BY = ['Claude', 'Gemini', 'Google', 'Referral', 'Marketplace', 'Walk-in', 'Other'];
  function foundBy(text) {
    var s = String(text || '').toLowerCase(); if (!s) return '';
    if (/claude/.test(s)) return 'Claude'; if (/gemini/.test(s)) return 'Gemini'; if (/google/.test(s)) return 'Google';
    if (/refer/.test(s)) return 'Referral'; if (/alibaba|made-in-china|marketplace|global ?sources|indiamart|platform/.test(s)) return 'Marketplace';
    if (/walk/.test(s)) return 'Walk-in';
    return 'Other';
  }
  var SUPPLIER_TYPES = ['Manufacturer', 'Exporter', 'Stockist', 'Dealer', 'Fabricator', 'Sub-con', 'Service'];
  function supplierType(text) { // "Manufacturer/exporter" -> "Manufacturer"
    var s = String(text || '').toLowerCase(); if (!s) return '';
    for (var i = 0; i < SUPPLIER_TYPES.length; i++) if (s.indexOf(SUPPLIER_TYPES[i].toLowerCase().replace('-', '')) >= 0 || s.indexOf(SUPPLIER_TYPES[i].toLowerCase()) >= 0) return SUPPLIER_TYPES[i];
    if (/distribut|wholesal|retail|trader|supplier/.test(s)) return 'Dealer';
    if (/contractor/.test(s)) return 'Sub-con';
    return '';
  }

  /* ---------- v3.1.0: discovery rows (standards §5) -> supplier records ---------- */
  var DISCOVERY_COLS = ['company_name', 'country', 'city', 'address', 'website', 'category', 'specialty', 'contact_person', 'email', 'phone',
    'whatsapp', 'source_url', 'notes', 'found_by', 'found_on', 'verification', 'zone'];
  function str(v) { return v == null ? '' : (v instanceof Date ? iso(v) : String(v)).trim(); }
  // any header-keyed row (17-col discovery sheet / CSV, Gemini row already converted) -> clean discovery row
  function discoveryRow(r, opts) {
    opts = opts || {}; var o = {};
    DISCOVERY_COLS.forEach(function (k) { o[k] = str(r[k]); });
    if (r.alias != null) o.alias = str(r.alias);
    if (!o.alias) { var m = /\((.*?)\)/.exec(o.company_name); if (m) o.alias = m[1].trim(); }
    if (r.type != null) o.type = str(r.type);
    if (!o.found_on) o.found_on = opts.found_on || '';
    if (/^\d{4}-\d{2}-\d{2}/.test(o.found_on)) o.found_on = o.found_on.slice(0, 10);
    o.verification = 'Unverified';                        // always Unverified on import
    var cc = countryCode(o.country);
    o.zone = cc ? zoneLabel(zoneOf(o.country, o.city + ' ' + o.address), o.country) : '';
    if (!o.whatsapp) o.whatsapp = whatsappOf(o.phone, o.country);
    else o.whatsapp = (parsePhones(o.whatsapp, o.country)[0] || {}).e164 || o.whatsapp;
    if (!categoryCodes(o.category).length && opts.category) o.category = opts.category;
    return o;
  }
  // contacts: the first gets the person, first email, first phone and the WhatsApp number; more emails / phones get rows of their own
  function contactsOf(row) {
    var emails = splitEmails(row.email), phones = parsePhones(row.phone, row.country).filter(function (p) { return p.e164; });
    var wa = row.whatsapp ? ((parsePhones(row.whatsapp, row.country)[0] || {}).e164 || '') : whatsappOf(row.phone, row.country);
    var out = [], main = { name: str(row.contact_person), role: '', email: emails[0] || '', phone: '', whatsapp: wa, preferred: '' };
    var rest = phones.filter(function (p) { return p.e164 !== wa; });
    var waPh = phones.filter(function (p) { return p.e164 === wa; })[0];
    main.phone = waPh ? waPh.e164 : (rest.length ? rest.shift().e164 : '');
    out.push(main);
    emails.slice(1).forEach(function (e) { out.push({ name: '', role: '', email: e, phone: '', whatsapp: '', preferred: 'email' }); });
    rest.forEach(function (p) { out.push({ name: '', role: '', email: '', phone: p.e164, whatsapp: p.whatsapp && p.kind === 'mobile' ? p.e164 : '', preferred: 'phone' }); });
    main.preferred = main.email ? 'email' : main.whatsapp ? 'whatsapp' : main.phone ? 'phone' : '';
    return out.filter(function (c) { return c.name || c.email || c.phone || c.whatsapp; });
  }
  // discovery row -> what crm_savesupplier / crm_queuedecide store
  function toSupplier(row) {
    var cc = countryCode(row.country), web = str(row.website), wd = webDomain(web), plat = [];
    if (wd && isPlatform(wd)) { plat.push(web); web = ''; }
    var src = str(row.source_url); if (src && isPlatform(webDomain(src)) && plat.indexOf(src) < 0) plat.push(src);
    if (web && !/^[a-z]+:\/\//i.test(web)) web = 'https://' + web;
    var cats = categoryCodes(row.category), specialty = str(row.specialty);
    var catText = str(row.category);
    if (catText && cats.length === 1 && cats[0] !== catText.toUpperCase() && categoryName(cats[0]).toLowerCase() !== catText.toLowerCase())
      specialty = specialty ? catText + ': ' + specialty : catText;   // keep the source wording ("Stainless steel - railing tubes & fittings")
    var name = str(row.company_name), alias = str(row.alias);
    if (alias && name.indexOf('(' + alias + ')') >= 0) name = name.replace('(' + alias + ')', '').replace(/\s+/g, ' ').trim();
    return {
      fields: {
        name: name, aliases: alias, country: cc, city: str(row.city), address: str(row.address),
        zone: cc ? zoneOf(row.country, str(row.city) + ' ' + str(row.address)) : null,
        type: supplierType(row.type), website: web, platform_links: plat.join(' / '), specialty: specialty,
        source_url: str(row.source_url), found_by: foundBy(row.found_by), found_on: str(row.found_on).slice(0, 10), notes: str(row.notes)
      },
      categories: cats.map(function (c) { return { code: c, specialty: specialty }; }),
      contacts: contactsOf(row),
      keys: dedupKeys(row)
    };
  }
  // supplier record (from the database) -> a row shaped like a discovery row, for de-dup keys and the Excel export
  function supplierAsRow(s) {
    var c = s.contacts || [];
    var pick = function (k) { return c.map(function (x) { return x[k]; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / '); };
    return { company_name: s.name || '', alias: s.aliases || '', country: countryName(s.country), city: s.city || '', address: s.address || '',
      website: s.website || '', category: (s.categories || []).map(function (x) { return x.code; }).join(', '), specialty: s.specialty || '',
      contact_person: pick('name'), email: pick('email'), phone: pick('phone'), whatsapp: pick('whatsapp'), source_url: s.source_url || '',
      notes: s.notes || '', found_by: s.found_by || '', found_on: s.found_on || '', verification: s.verification || 'Unverified',
      zone: s.zone ? zoneLabel(s.zone, s.country) : '' };
  }
  // Unverified -> Checked when the automatic checks pass: offline OK and a mail server (MX) for a company email,
  // or the website domain resolves (A) when there is no email. dns: {mx, a} (null = not checked).
  function autoVerification(checks, dns, hasEmail) {
    if (!checks || !checks.ok) return 'Unverified';
    dns = dns || {};
    if (dns.a === false) return 'Unverified';                // a website that does not resolve
    if (hasEmail) return dns.mx === true ? 'Checked' : 'Unverified';
    return dns.a === true ? 'Checked' : 'Unverified';
  }
  // which domains to look up for a discovery row: MX for the first company (or any) email domain, A for the website
  function dnsTargets(row) {
    var em = splitEmails(row.email), doms = em.map(emailDomain);
    var mx = doms.filter(function (d) { return !isFreeMail(d); })[0] || doms[0] || '';
    var w = webDomain(row.website); if (w && isPlatform(w)) w = '';
    return { mx: mx, a: w };
  }

  /* ---------- v3.1.2: import templates, RFQ texts, chase list, discovery prompt, KPIs ---------- */
  // supplier import template = the 17 discovery columns + 2 optional ones the importer also reads
  var TEMPLATE_COLS = DISCOVERY_COLS.concat(['alias', 'type']);
  var TEMPLATE_HELP = {
    company_name: ['Company name (required)', 'Foshan Vinmay Stainless Steel Co., Ltd.'],
    country: ['Country name or 2-letter code (required)', 'China'],
    city: ['City / area - Miri, Limbang, Kota Kinabalu etc. decide zone 2 Borneo', 'Sanshui, Foshan'],
    address: ['Full address', 'No. 8 Industrial Rd, Sanshui, Foshan, Guangdong'],
    website: ['Company website (not Alibaba)', 'https://vinssco.com'],
    category: ['Category code or name (see Categories sheet); several codes as "HV, PL"', 'MW'],
    specialty: ['What they sell', 'SS304 ornamental tubes + handrail fittings'],
    contact_person: ['Contact person', 'Ms Lily Chen'],
    email: ['Email(s), separate with " / "', 'sales@vinssco.com / marketing@vinssco.com'],
    phone: ['Phone(s) with country code, separate with " / "; mark WhatsApp with "WA"', '+86 757 8543 6751 / WA +86 131 4327 6868'],
    whatsapp: ['WhatsApp number (optional - else the first mobile is used)', '+86 131 4327 6868'],
    source_url: ['Where the details came from (page link)', 'https://vinssco.com/contact'],
    notes: ['Anything useful', 'Exports to 100+ countries'],
    found_by: ['Claude / Gemini / Google / Referral / Marketplace / Walk-in / Other', 'Google'],
    found_on: ['Date found (YYYY-MM-DD)', '2026-11-09'],
    verification: ['Leave blank - always imported as Unverified', ''],
    zone: ['Leave blank - worked out from country + city', ''],
    alias: ['Other name / brand (optional)', 'Vinmay'],
    type: ['Manufacturer / Exporter / Stockist / Dealer / Fabricator / Sub-con / Service (optional)', 'Manufacturer']
  };
  // requisition (MR) / item list: one row per item (standards §5)
  var MR_COLS = ['line', 'description', 'spec_brand', 'qty', 'unit', 'required_date', 'category', 'res_code', 'only_overseas', 'notes'];
  var MR_HELP = {
    line: ['Line no. (optional)', 1], description: ['Item (required)', 'SS304 round tube 25.4mm OD x 1.5mm, hairline, 6m'],
    spec_brand: ['Specification / brand / standard', 'ASTM A554, SS304'], qty: ['Quantity (blank = ask MOQ + price at MOQ)', 120],
    unit: ['Unit', 'lengths'], required_date: ['Required on site (YYYY-MM-DD)', '2026-12-15'],
    category: ['Category code (optional - guessed from the description)', 'MW'], res_code: ['Masterlist resource code (optional)', ''],
    only_overseas: ['Y if only made overseas (e.g. China)', ''], notes: ['Notes', '']
  };
  function num(v) { if (v == null || v === '') return null; var n = +String(v).replace(/[, ]/g, ''); return isFinite(n) ? n : null; }
  function dateIso(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return iso(v);
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + '-' + pad(m[2], 2) + '-' + pad(m[3], 2);
    if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/.exec(s))) { var y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return y + '-' + pad(m[2], 2) + '-' + pad(m[1], 2); } // d/m/y (Brunei)
    var d = new Date(s); return isNaN(d) ? '' : iso(d);
  }
  // one item row from an MR sheet / pasted text -> clean item (category guessed when blank)
  function mrItem(r) {
    var o = {}; Object.keys(r || {}).forEach(function (k) { o[String(k).trim().toLowerCase().replace(/[\s\/]+/g, '_')] = r[k]; });
    var desc = str(o.description || o.item || o.resource || o.material), cat = categoryCode(o.category) || categoryCode(desc + ' ' + str(o.spec_brand));
    return { line: num(o.line), description: desc, spec_brand: str(o.spec_brand || o.spec || o.brand), qty: num(o.qty || o.quantity), unit: str(o.unit),
      required_date: dateIso(o.required_date || o.required || o.date), category: cat, res_code: str(o.res_code || o.code),
      only_overseas: /^(y|yes|true|1)$/i.test(str(o.only_overseas)), notes: str(o.notes) };
  }
  // pasted from Excel (tab separated) or typed one per line: description [tab spec] [tab qty] [tab unit] [tab required date]
  function parsePasted(text) {
    var rows = String(text || '').replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (!rows.length) return [];
    var first = rows[0].toLowerCase(), hasHead = /description|item/.test(first) && /qty|quantity|unit/.test(first);
    var head = hasHead ? rows.shift().split('\t').map(function (h) { return h.trim(); }) : ['description', 'spec_brand', 'qty', 'unit', 'required_date'];
    return rows.map(function (l) {
      var c = l.split('\t'), r = {};
      if (!hasHead && c.length === 1) { var m = /^(.*?)(?:\s+[-–x×]\s*|\s+)(\d+(?:\.\d+)?)\s*([a-zA-Z.]+)?\s*$/.exec(l.trim()); if (m && m[1].length > 2) { r = { description: m[1], qty: m[2], unit: m[3] || '' }; return mrItem(r); } }
      head.forEach(function (h, i) { r[h] = c[i]; }); return mrItem(r);
    }).filter(function (x) { return x.description; });
  }
  function shortDesc(items) {
    var s = items.map(function (it) { return it.short || it.description || it.desc; }).filter(Boolean);
    var t = s.slice(0, 3).join('; ') + (s.length > 3 ? ' and ' + (s.length - 3) + ' more item' + (s.length > 4 ? 's' : '') : '');
    return t.length > 160 ? t.slice(0, 157) + '...' : t;
  }
  // items as the templates want them: desc = description + spec/brand
  function rfqItems(items) {
    return (items || []).map(function (it) {
      var d = str(it.description || it.desc), sp = str(it.spec_brand);
      return { desc: sp && d.toLowerCase().indexOf(sp.toLowerCase()) < 0 ? d + ' (' + sp + ')' : d, short: str(it.short) || d, qty: it.qty == null ? '' : it.qty, unit: str(it.unit) };
    });
  }
  // RFQ record (+ items) -> the object buildEmail / buildWhatsApp expect
  function rfqForTemplates(r, items, sender) {
    var it = rfqItems(items);
    return { rfq_no: r.rfq_no, title: r.title, short_desc: r.short_desc || shortDesc(it), items: it,
      qtyMode: r.qty_mode || (it.some(function (x) { return x.qty === '' || x.qty == null; }) ? 'moq' : 'firm'),
      deadline: r.deadline, delivery_place: r.delivery_place, certs: r.certs, sender: sender || 'Gemar', sent_date: r.sent_date, close_date: r.close_date };
  }
  // email that fits the Roundcube link (≤ 1,600 chars); longer RFQs: short body + attach the RFQ PDF
  function buildEmailFit(rfq, sup) {
    var e = buildEmail(rfq, sup);
    if (!e.tooLong) return e;
    if (sup.quote_link) {   // v3.2.0: the full RFQ text matters more than the link (the WhatsApp follow-up still carries it)
      var plain = {}; for (var k in sup) plain[k] = sup[k]; plain.quote_link = '';
      var e2 = buildEmail(rfq, plain); if (!e2.tooLong) { e2.linkDropped = true; return e2; }
    }
    var a = audienceOf(sup.zone), v = vars(rfq, sup);
    var body = [fill(T['open_' + a], v).replace(/ for the following(, delivered to [^:]*)?:$/, ' for the items in the attached RFQ ' + rfq.rfq_no + ' (' + rfq.items.length + ' items)$1.'),
      'Please quote unit prices ' + v.currency + ' for every item, and include ' + (a === 'O' ? 'FOB / CIF Muara, production lead time, packing, payment terms and quote validity.' : 'stock availability, delivery lead time and charges, payment terms and quote validity.'),
      fill(T.close, v) + (sup.quote_link ? '\n' + fill(T.online, v) : '')].join('\n\n') + '\n';
    var link = sup.email ? composeLink(sup.email, e.subject, body) : '';
    return { subject: e.subject, body: body, link: link, tooLong: link.length > LINK_MAX, attach: true };
  }
  // reminder by email (same channel as the first contact)
  function buildReminderEmail(kind, rfq, sup, extra) {
    var w = buildWhatsApp(kind, rfq, sup, extra), subject = (kind === 'reminder2' ? 'Final reminder: ' : 'Reminder: ') + fill(T.subject, vars(rfq, sup));
    var body = 'Dear ' + (sup.greeting || 'Sir/Madam') + ',\n\n' + w.text.replace(/^Good day, this is [^.]*\. /, 'Good day. ') + '\n';
    return { subject: subject, body: body, link: sup.email ? composeLink(sup.email, subject, body) : '' };
  }
  // what to chase for one recipient now: reminder1 | reminder2 | noreply | '' (and when it was due)
  var CHASE_OPEN = ['Emailed', 'WhatsApp sent', 'Reminder 1', 'Reminder 2'];
  function chaseDue(rec, rfq, now, holidays) {
    if (CHASE_OPEN.indexOf(rec.status) < 0) return { due: '' };
    var first = [rec.emailed_at, rec.whatsapp_at].filter(Boolean).sort()[0]; if (!first) return { due: '' };
    var t = timetable(toDate(String(first).replace(' ', 'T')), { urgency: rfq.urgency, holidays: holidays, deadline: rfq.deadline || null });
    var n = toDate(now || new Date()), at = function (s) { return toDate(/\d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') : s); };
    var after = function (s) { return /\d{2}:\d{2}/.test(s) ? n >= at(s) : iso(n) >= s; };
    if (rec.status === 'Reminder 2') return after(t.noReply) ? { due: 'noreply', at: t.noReply, t: t } : { due: '', t: t };
    if (rec.status === 'Reminder 1') return after(t.reminder2) ? { due: 'reminder2', at: t.reminder2, t: t } : { due: '', t: t };
    return after(t.reminder1) ? { due: 'reminder1', at: t.reminder1, t: t } : { due: '', t: t };
  }
  // prompt for Claude / Gemini to find more suppliers in the template columns
  function discoveryPrompt(rfq, items, opts) {
    opts = opts || {};
    var zones = (opts.zones || []).map(function (z) { return ZONES[z] + (z === 2 ? ' (Miri, Limbang, Lawas, Kota Kinabalu, Labuan)' : z === 4 ? ' (China first, then Vietnam)' : ''); });
    var cats = []; (items || []).forEach(function (it) { if (it.category && cats.indexOf(it.category) < 0) cats.push(it.category); });
    return ['Find ' + (opts.count || 10) + ' real suppliers for this request for quotation from ARZA SDN BHD, a construction company in Brunei Darussalam.',
      '', 'RFQ ' + (rfq.rfq_no || '') + ' - ' + (rfq.title || ''), 'Items:',
      (items || []).map(function (it, i) { return (i + 1) + '. ' + it.description + (it.spec_brand ? ' (' + it.spec_brand + ')' : '') + (it.qty ? ' - ' + it.qty + ' ' + (it.unit || '') : ''); }).join('\n'),
      'Material category: ' + cats.map(function (c) { return c + ' ' + categoryName(c); }).join(', '),
      'Search in: ' + (zones.join('; ') || 'any country') + (rfq.urgency ? ' (urgency ' + rfq.urgency + ')' : '') + '.',
      (opts.exclude && opts.exclude.length ? 'Leave out these suppliers I already have: ' + opts.exclude.join('; ') + '.' : ''),
      '', 'Rules: only companies you can find on a real web page; give the page in source_url; never invent emails or phone numbers - leave them blank if not published; phone numbers with country code; mark WhatsApp numbers with "WA".',
      'Answer as a table (CSV) with exactly these columns, header first:', TEMPLATE_COLS.join(','),
      'verification and zone: leave blank. found_by: your name (Claude / Gemini). found_on: today\'s date (YYYY-MM-DD). category: ' + (cats[0] || 'the category code') + '.'
    ].filter(function (l, i, a) { return l !== '' || a[i - 1] !== ''; }).join('\n');
  }
  // read the "RFQ Text" sheet of an Excel send list (RFQ-2611-002 format) -> RFQ header + items
  function rfqFromTextSheet(t) {
    var ref = str(t['RFQ ref']), subj = str(t['Email subject']), body = str(t['Email body - China'] || t['Email body - Brunei/Borneo/MY'] || '');
    var title = subj.replace(ref + ' - ', '').replace(/\s*-\s*ARZA SDN BHD\s*$/, '');
    var dl = str(t['Quote deadline']), d = /(\d{1,2}) (\w+) (\d{4})/.exec(dl), deadline = d ? d[3] + '-' + pad(MONTHS.indexOf(d[2]) + 1, 2) + '-' + pad(d[1], 2) : '';
    var items = body.split('\n').filter(function (l) { return /^\d+\.\s/.test(l); }).map(function (l, i) { var x = l.replace(/^\d+\.\s*/, ''); return { line: i + 1, description: x, category: categoryCode(x) }; });
    var wa = str(t['WhatsApp full RFQ (no email)']).split('\n').filter(function (l) { return /^\d+\)\s/.test(l); }).map(function (l) { return l.replace(/^\d+\)\s*/, ''); });
    items.forEach(function (it, i) { if (wa[i]) it.short = wa[i]; });
    var follow = /for (.*?)\. Kindly check/.exec(str(t['WhatsApp follow-up (after email)']));
    var place = /delivered to ([^:]+):/.exec(str(t['Email body - Brunei/Borneo/MY']));
    var certs = /validity, and (.*?)\.\s*$/m.exec(body);
    return { rfq_no: ref, title: title, deadline: deadline, qty_mode: /Minimum Order Quantity/.test(body) ? 'moq' : 'firm', short_desc: follow ? follow[1] : '',
      delivery_place: place ? place[1] : '', certs: certs ? certs[1] : '', notes: str(t['SOURCING RULE USED']), items: items };
  }
  // KPIs over RFQs (standards §9): rfqs [{rfq_no, rfq_date, categories[], recipients:[{status, valid_quote, emailed_at, whatsapp_at, replied_at, zone, country}]}]
  function rfqKpis(rfqs) {
    var rec = [], ok = 0, sent = 0;
    rfqs.forEach(function (r) {
      var rs = (r.recipients || []).map(function (x) { return Object.assign({}, x, { first_contact: [x.emailed_at, x.whatsapp_at].filter(Boolean).sort()[0] || '', first_reply: x.replied_at || '' }); });
      rs.forEach(function (x) { rec.push(x); });
      if (rs.some(function (x) { return x.status !== 'Not contacted'; })) { sent++; if (rs.filter(function (x) { return x.status === 'Quoted' && x.valid_quote; }).length >= 3) ok++; }
    });
    var fix = function (a) { return a.map(function (x) { return Object.assign({}, x, { first_contact: x.first_contact ? String(x.first_contact).replace(' ', 'T') : '', first_reply: x.first_reply ? String(x.first_reply).replace(' ', 'T') : '' }); }); };
    var k = kpis(fix(rec)), hrs = fix(rec).filter(function (x) { return x.first_contact && x.first_reply && RESPONDED.indexOf(x.status) >= 0; })
      .map(function (x) { return (toDate(x.first_reply) - toDate(x.first_contact)) / 3600000; }).sort(function (a, b) { return a - b; });
    k.rfqs = rfqs.length; k.rfqsSent = sent; k.rfqSuccess = sent ? ok / sent : 0; k.rfqsOk = ok;
    k.validRate = k.contacted ? k.valid / k.contacted : 0;
    k.medianResponseHours = hrs.length ? (hrs.length % 2 ? hrs[(hrs.length - 1) / 2] : (hrs[hrs.length / 2 - 1] + hrs[hrs.length / 2]) / 2) : null;
    return k;
  }
  // match a send-list row to a supplier in the database by the de-dup keys; returns supplier_id or ''
  function matchSupplier(row, suppliers) {
    var keys = dedupKeys(row), best = '', n = 0;
    (suppliers || []).forEach(function (s) { var sk = dedupKeys(supplierAsRow(s)), c = keys.filter(function (k) { return sk.indexOf(k) >= 0; }).length; if (c > n) { n = c; best = s.supplier_id; } });
    return best;
  }

  /* ---------- v3.1.3: AI answers, quotes, FX, landed cost, comparison, budget (standards §8) ---------- */
  // a table pasted from Claude / Gemini: CSV, tab-separated or a markdown table; header row must hold company_name
  function splitCsvLine(l, sep) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < l.length; i++) {
      var ch = l.charAt(i);
      if (q) { if (ch === '"') { if (l.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map(function (x) { return x.trim(); });
  }
  function parseTable(text) {
    var lines = String(text || '').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/^\s+|\s+$/g, ''); })
      .filter(function (l) { return l && !/^```/.test(l) && !/^\|?\s*:?-{3,}/.test(l); });
    var hi = -1; for (var i = 0; i < lines.length; i++) if (/company_name/i.test(lines[i])) { hi = i; break; }
    if (hi < 0) return { rows: [], error: 'no header row with company_name' };
    var md = /^\|/.test(lines[hi]), sep = md ? '|' : (lines[hi].split('\t').length > lines[hi].split(',').length ? '\t' : ',');
    var cells = function (l) { var c = md ? l.replace(/^\||\|$/g, '').split('|').map(function (x) { return x.trim(); }) : splitCsvLine(l, sep); return c; };
    var head = cells(lines[hi]).map(function (h) { return h.toLowerCase().replace(/\*|`/g, '').trim(); });
    var rows = lines.slice(hi + 1).map(cells).filter(function (c) { return c.some(function (x) { return x; }); }).map(function (c) {
      var o = {}; head.forEach(function (h, j) { if (h) o[h] = (c[j] || '').replace(/^\*\*|\*\*$/g, ''); }); return o; })
      .filter(function (o) { return o.company_name && !/^(e\.g\.|example\b)/i.test(o.company_name); });
    return { rows: rows, columns: head };
  }
  // FX: B$ per 1 unit of the currency. B$ = S$ 1:1 (Currency Interchangeability Agreement); others from the FX table
  var CURRENCIES = ['BND', 'SGD', 'USD', 'MYR', 'CNY', 'EUR', 'AUD', 'JPY', 'THB', 'IDR', 'VND', 'PHP', 'INR', 'HKD', 'GBP', 'AED', 'KRW', 'TWD'];
  function fxRate(cur, fx) {
    cur = String(cur || 'BND').toUpperCase(); if (cur === 'BND' || cur === 'SGD') return 1;
    var r = fx && fx[cur]; var v = r && (typeof r === 'object' ? +r.rate : +r); return v > 0 ? v : null;
  }
  // one quote -> amounts in B$ at site. items: RFQ items [{line, qty, unit}]; q: {currency, freight, insurance, duty_pct, clearing_bnd,
  // delivery_bnd, lines:[{line, unit_price, qty, moq}]}. Qty used = RFQ qty, else the quoted qty, else the MOQ.
  function landed(q, items, fx) {
    var rate = fxRate(q.currency, fx), byLine = {}, out = { rate: rate, fxMissing: rate == null, lines: [], missing: [] };
    (q.lines || []).forEach(function (l) { byLine[l.line] = l; });
    var goods = 0;
    (items || []).forEach(function (it) {
      var l = byLine[it.line], up = l && l.unit_price !== '' && l.unit_price != null ? +l.unit_price : null;
      if (up == null || isNaN(up)) { out.missing.push(it.line); out.lines.push({ line: it.line, unit_price: null }); return; }
      var qty = num(it.qty) || num(l.qty) || num(l.moq) || 1, ub = rate == null ? null : up * rate;
      goods += up * qty;
      out.lines.push({ line: it.line, unit_price: up, qty: qty, qty_from: num(it.qty) ? 'rfq' : num(l.qty) ? 'quote' : num(l.moq) ? 'moq' : 'one', moq: num(l.moq),
        unit_bnd: ub, amount_bnd: ub == null ? null : ub * qty, compliant: l.compliant !== false, brand: l.brand || '' });
    });
    var fr = (+q.freight || 0) + (+q.insurance || 0), duty = (+q.duty_pct || 0) / 100;
    out.goods = goods; out.partial = out.missing.length > 0; out.complete = !out.partial;
    if (rate == null) { out.total_bnd = null; return out; }
    out.goods_bnd = goods * rate; out.freight_bnd = fr * rate; out.duty_bnd = (goods + fr) * rate * duty;
    out.local_bnd = (+q.clearing_bnd || 0) + (+q.delivery_bnd || 0);
    out.total_bnd = out.goods_bnd + out.freight_bnd + out.duty_bnd + out.local_bnd;
    return out;
  }
  // compare the quotes of one RFQ. opts: {fx, today, required_date, rfq_date}. Valid for the comparison = ticked valid, priced for every
  // line, within validity, FX known. Lead-time warning when lead_days > days left to the required date (counted from today).
  function compareQuotes(items, quotes, opts) {
    opts = opts || {}; var today = opts.today || iso(new Date());
    var rows = (quotes || []).map(function (q) {
      var L = landed(q, items, opts.fx), flags = [];
      if (q.valid === false) flags.push('not valid (unticked)');
      if (L.partial) flags.push('partial: no price for line ' + L.missing.join(', '));
      if (L.fxMissing) flags.push('no FX rate for ' + q.currency);
      if (q.validity && q.validity < today) flags.push('expired ' + q.validity);
      if (L.lines.some(function (l) { return l.unit_price != null && !l.compliant; })) flags.push('not to spec on some lines');
      var lw = leadTimeWarning(today, opts.required_date, q.lead_days == null || q.lead_days === '' ? null : +q.lead_days);
      return { q: q, L: L, flags: flags, leadWarning: lw, ok: !flags.length };
    });
    var ok = rows.filter(function (r) { return r.ok; }).sort(function (a, b) { return a.L.total_bnd - b.L.total_bnd; });
    ok.forEach(function (r, i) { r.rank = i + 1; });
    var best = ok.filter(function (r) { return !r.leadWarning; })[0] || ok[0] || null;
    var lowLine = {};
    (items || []).forEach(function (it) {
      var c = rows.filter(function (r) { return r.ok; }).map(function (r) { var l = r.L.lines.filter(function (x) { return x.line === it.line; })[0]; return l && l.unit_bnd != null ? { id: r.q.supplier_id, v: l.unit_bnd } : null; }).filter(Boolean)
        .sort(function (a, b) { return a.v - b.v; });
      lowLine[it.line] = c.length ? c[0].id : '';
    });
    var hi = ok.length ? ok[ok.length - 1].L.total_bnd : null;
    return { rows: rows, valid: ok.length, goalMet: ok.length >= 3, best: best ? best.q.supplier_id : '', lowLine: lowLine,
      saving: best && hi != null ? hi - best.L.total_bnd : null };
  }
  // masterlist Res tab (via Apps Script) -> {code: {name, unit, price, conf}}
  function resIndex(res) {
    var out = {}; if (!res || !res.head) return out;
    var h = res.head.map(function (x) { return String(x).toLowerCase(); }), ci = function (re) { for (var i = 0; i < h.length; i++) if (re.test(h[i])) return i; return -1; };
    var cC = ci(/^code/), cN = ci(/^resource/), cU = ci(/^unit/), cP = ci(/^price/), cF = ci(/^conf/);
    (res.rows || []).forEach(function (r) { var c = String(r[cC] || '').trim(), p = num(r[cP]); if (/^[A-Z]{1,3}\d{1,4}[a-z]?$/.test(c) && p != null) out[c] = { name: String(r[cN] || ''), unit: String(r[cU] || ''), price: p, conf: String(r[cF] || '') }; });
    return out;
  }
  // budget from the masterlist (items with a res_code and a quantity) vs a quote's landed total for the same lines
  function budgetCheck(items, resIdx, Lq) {
    var lines = [], budget = 0, quoted = 0, n = 0;
    (items || []).forEach(function (it) {
      var r = it.res_code && resIdx[it.res_code], qty = num(it.qty); if (!r || qty == null) return;
      var ql = Lq && Lq.lines.filter(function (x) { return x.line === it.line; })[0];
      lines.push({ line: it.line, code: it.res_code, ml_price: r.price, ml_unit: r.unit, conf: r.conf, budget: r.price * qty, quoted: ql && ql.amount_bnd != null ? ql.amount_bnd : null });
      budget += r.price * qty; if (ql && ql.amount_bnd != null) { quoted += ql.amount_bnd; n++; }
    });
    return { lines: lines, budget: budget, quoted: quoted, covered: lines.length, priced: n, diff: n ? quoted - budget : null };
  }
  function money(v, d) { if (v == null || isNaN(v)) return '—'; d = d == null ? 2 : d; var s = (+v).toFixed(d).split('.'); s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return s.join('.'); }

  /* ---------- v3.2.0: evaluation, quote link, rate proposals, KPIs, discovery prompts, goal guard, mailbox (standards §8-9) ---------- */
  var SCORING_DEFAULT = { price: 60, lead: 20, payment: 10, reliability: 10, must_complete: true, must_spec: true, must_valid: true, must_in_time: false };
  var MUST = [['complete', 'all lines priced'], ['spec', 'to spec'], ['valid', 'quote still valid'], ['in_time', 'arrives in time']];
  // global settings + the RFQ's own must-pass ticks (rfqs.must_pass) -> one scoring set
  function scoringOf(settings, rfqMust) {
    var o = {}, k; for (k in SCORING_DEFAULT) o[k] = SCORING_DEFAULT[k];
    for (k in (settings || {})) if (settings[k] != null && settings[k] !== '') o[k] = settings[k];
    MUST.forEach(function (m) { if (rfqMust && rfqMust[m[0]] != null) o['must_' + m[0]] = !!rfqMust[m[0]]; });
    ['price', 'lead', 'payment', 'reliability'].forEach(function (x) { o[x] = Math.max(0, +o[x] || 0); });
    return o;
  }
  // payment terms text -> credit days (0 = cash / advance), null = cannot tell
  function paymentDays(terms) {
    var t = String(terms || '').toLowerCase(); if (!t.trim()) return null;
    if (/\b(cod|c\.o\.d|cash|advance|prepay|pre-pay|upfront|up-front|before (delivery|shipment)|t\/?t in advance|100\s*%)/.test(t)) return 0;
    var m = /(\d{1,3})\s*(days?|d\b|hari)/.exec(t); if (m) return Math.min(180, +m[1]);
    m = /\bnet\s*(\d{1,3})\b/.exec(t); if (m) return Math.min(180, +m[1]);
    if (/credit|net/.test(t)) return 30;
    return null;
  }
  function paymentScore(terms) {
    var t = String(terms || '').toLowerCase(), d = paymentDays(terms);
    if (d == null) return 50;
    var dep = /(\d{1,3})\s*%\s*(deposit|advance|down|dp)/.exec(t), s = 40 + Math.min(60, d);
    if (dep && +dep[1] < 100) s = Math.max(20, s - Math.round(+dep[1] * 0.4));
    return Math.max(0, Math.min(100, s));
  }
  // supplier history (crm_supstats) -> 0-100; no history = 50 (neutral)
  function reliability(st) {
    st = st || {}; var parts = [];
    if ((+st.contacted || 0) >= 2) parts.push([0.4, (+st.responded || 0) / st.contacted]);
    if (+st.delivered > 0) parts.push([0.35, (+st.on_time || 0) / st.delivered]);
    if (st.quality != null && st.quality !== '') parts.push([0.25, (+st.quality - 1) / 4]);
    if (!parts.length) return 50;
    var w = 0, v = 0; parts.forEach(function (p) { w += p[0]; v += p[0] * p[1]; });
    return Math.round(v / w * 100);
  }
  // weighted scoring over compareQuotes; must-pass checks decide who may be recommended
  // opts: {fx, today, required_date, scoring (scoringOf), stats {supplier_id: crm_supstats}}
  function scoreQuotes(items, quotes, opts) {
    opts = opts || {}; var sc = opts.scoring || scoringOf(), cmp = compareQuotes(items, quotes, opts), today = opts.today || iso(new Date());
    cmp.rows.forEach(function (r) {
      var f = [], q = r.q;
      if (q.valid === false) f.push('marked not valid');
      if (r.L.fxMissing) f.push('no FX rate for ' + q.currency);
      if (r.L.partial && sc.must_complete) f.push('not all lines priced');
      if (sc.must_spec && r.L.lines.some(function (l) { return l.unit_price != null && !l.compliant; })) f.push('not to spec');
      if (sc.must_valid && q.validity && q.validity < today) f.push('expired');
      if (sc.must_in_time && r.leadWarning) f.push('too late (' + r.leadWarning + ')');
      r.fails = f; r.pass = !f.length;
    });
    var P = cmp.rows.filter(function (r) { return r.pass && r.L.total_bnd != null; }), W = sc.price + sc.lead + sc.payment + sc.reliability || 1;
    var minT = Math.min.apply(null, P.map(function (r) { return r.L.total_bnd; }).concat([Infinity]));
    var leads = P.map(function (r) { return r.q.lead_days === '' || r.q.lead_days == null ? null : +r.q.lead_days; }).filter(function (x) { return x != null; });
    var minL = leads.length ? Math.min.apply(null, leads) : null;
    cmp.rows.forEach(function (r) {
      if (!r.pass || r.L.total_bnd == null) { r.score = null; return; }
      var ld = r.q.lead_days === '' || r.q.lead_days == null ? null : +r.q.lead_days;
      var s = { price: r.L.total_bnd > 0 ? minT / r.L.total_bnd * 100 : 100,
        lead: ld == null || minL == null ? 50 : (minL + 1) / (ld + 1) * 100,
        payment: paymentScore(r.q.payment_terms), reliability: reliability((opts.stats || {})[r.q.supplier_id]) };
      s.total = (s.price * sc.price + s.lead * sc.lead + s.payment * sc.payment + s.reliability * sc.reliability) / W;
      ['price', 'lead', 'payment', 'reliability', 'total'].forEach(function (k) { s[k] = Math.round(s[k] * 10) / 10; });
      r.score = s;
    });
    var ranked = P.slice().sort(function (a, b) { return b.score.total - a.score.total || a.L.total_bnd - b.L.total_bnd; });
    ranked.forEach(function (r, i) { r.srank = i + 1; });
    cmp.scoring = sc; cmp.ranked = ranked; cmp.passing = P.length;
    cmp.top = ranked[0] ? ranked[0].q.supplier_id : '';
    cmp.cheapest = P.slice().sort(function (a, b) { return a.L.total_bnd - b.L.total_bnd; }).map(function (r) { return r.q.supplier_id; })[0] || '';
    return cmp;
  }
  // reply-rate learning: valid quotes per supplier contacted, per category, from RFQs that are past the chasing stage
  function categoryRates(rfqs) {
    var out = {};
    (rfqs || []).forEach(function (r) {
      if (['Chasing', 'Comparison', 'Short', 'Approval sent', 'Awarded'].indexOf(r.status) < 0) return;
      var rec = (r.recipients || []).filter(function (x) { return x.status !== 'Not contacted'; }), v = rec.filter(function (x) { return x.status === 'Quoted' && x.valid_quote; }).length;
      (r.categories || []).forEach(function (c) { var o = out[c] || (out[c] = { contacted: 0, valid: 0, rfqs: 0 }); o.contacted += rec.length; o.valid += v; o.rfqs++; });
    });
    Object.keys(out).forEach(function (c) { out[c].rate = out[c].contacted ? out[c].valid / out[c].contacted : 0; });
    return out;
  }
  // how many suppliers to contact for these categories (the weakest category with history decides)
  function targetFor(cats, rates) {
    var best = null;
    (cats || []).forEach(function (c) { var o = (rates || {})[c]; if (o && o.contacted >= 5 && (!best || o.rate < best.rate)) best = { cat: c, rate: o.rate, contacted: o.contacted }; });
    if (!best) return { target: contactTarget(0, 0), basis: '' };
    return { target: contactTarget(best.rate, best.contacted), basis: best.cat + ' ' + Math.round(best.rate * 100) + '% valid quotes over ' + best.contacted + ' contacts', cat: best.cat, rate: best.rate };
  }
  function quoteLink(base, token) { return token ? String(base || '') + (String(base || '').indexOf('?') >= 0 ? '&' : '?') + 't=' + token : ''; }
  // awarded quote -> masterlist rate proposals (landed B$ per unit; freight, duty and local costs shared by line value)
  function proposalsFrom(row, items, resIdx) {
    if (!row || !row.L || row.L.total_bnd == null) return [];
    var L = row.L, extra = (L.freight_bnd || 0) + (L.duty_bnd || 0) + (L.local_bnd || 0), out = [];
    (items || []).forEach(function (it) {
      var code = String(it.res_code || '').trim(), l = L.lines.filter(function (x) { return x.line === it.line; })[0];
      if (!code || !l || l.amount_bnd == null || !l.qty) return;
      var share = L.goods_bnd ? l.amount_bnd / L.goods_bnd : 0, r = (resIdx || {})[code] || null, unit = String(it.unit || '');
      var lu = (l.amount_bnd + extra * share) / l.qty;
      out.push({ line: it.line, res_code: code, description: it.description, unit: unit, ml_unit: r ? r.unit : '', ml_price: r ? r.price : null,
        new_price: Math.round(lu * 100) / 100, unit_match: !r || !r.unit || normUnit(r.unit) === normUnit(unit), change: r && r.price ? lu / r.price - 1 : null });
    });
    return out;
  }
  function normUnit(u) { u = String(u || '').toLowerCase().replace(/[\s.]/g, '').replace(/²/g, '2').replace(/³/g, '3'); return { nos: 'no', pcs: 'pc', pc: 'pc', no: 'no', bags: 'bag', sheets: 'sheet', lengths: 'length', coils: 'coil', packs: 'pack', sqm: 'm2', cum: 'm3', ton: 't', tonne: 't' }[u] || u.replace(/s$/, ''); }
  // open RFQs whose earliest valid quote runs out within `days` (crm_rfqs valid_until)
  function validityAlerts(rfqs, today, days) {
    today = today || iso(new Date()); var lim = iso(addDays(today, days == null ? 7 : days));
    return (rfqs || []).filter(function (r) { return r.valid_until && ['Awarded', 'Cancelled'].indexOf(r.status) < 0 && r.valid_until <= lim; })
      .map(function (r) { return { rfq_no: r.rfq_no, title: r.title, valid_until: r.valid_until, days_left: daysBetween(today, r.valid_until), expired: r.valid_until < today }; })
      .sort(function (a, b) { return a.valid_until < b.valid_until ? -1 : 1; });
  }
  function addDays(d, n) { d = stripTime(toDate(d)); d.setDate(d.getDate() + n); return d; }
  // monthly KPI report: RFQs dated in month 'YYYY-MM'; baseline {minutes_per_rfq, reply_rate, quotes_per_rfq, suppliers_per_rfq}
  function monthKpis(rfqs, month, baseline) {
    var R = (rfqs || []).filter(function (r) { return String(r.rfq_date || '').slice(0, 7) === month && r.status !== 'Cancelled'; }), k = rfqKpis(R), b = baseline || {};
    var sent = R.filter(function (r) { return r.status !== 'Draft'; }), aw = R.filter(function (r) { return r.status === 'Awarded'; });
    var d2a = aw.filter(function (r) { return r.award_date; }).map(function (r) { return daysBetween(r.rfq_date, r.award_date); }).sort(function (a, b) { return a - b; });
    var cats = {};
    R.forEach(function (r) { (r.categories || []).forEach(function (c) { var o = cats[c] || (cats[c] = { rfqs: 0, contacted: 0, responded: 0, valid: 0 }); o.rfqs++;
      (r.recipients || []).forEach(function (x) { if (x.status === 'Not contacted') return; o.contacted++; if (RESPONDED.indexOf(x.status) >= 0) o.responded++; if (x.status === 'Quoted' && x.valid_quote) o.valid++; }); }); });
    var sup = {};
    R.forEach(function (r) { (r.recipients || []).forEach(function (x) { if (x.status === 'Not contacted') return; var o = sup[x.supplier_id] || (sup[x.supplier_id] = { supplier_id: x.supplier_id, name: x.name || x.supplier_id, contacted: 0, responded: 0, valid: 0, awards: 0 });
      o.contacted++; if (RESPONDED.indexOf(x.status) >= 0) o.responded++; if (x.status === 'Quoted' && x.valid_quote) o.valid++; if (r.status === 'Awarded' && r.award_supplier === x.supplier_id) o.awards++; }); });
    var out = { month: month, rfqs: R.length, sent: sent.length, awarded: aw.length, contacted: k.contacted, perRfq: sent.length ? k.contacted / sent.length : 0,
      replyRate: k.replyRate, validRate: k.validRate, quotesPerRfq: sent.length ? k.valid / sent.length : 0, goalMet: k.rfqsOk, goalRate: k.rfqSuccess,
      medianResponseHours: k.medianResponseHours, medianDaysToAward: d2a.length ? d2a[Math.floor((d2a.length - 1) / 2)] : null,
      awardedBnd: aw.reduce(function (s, r) { return s + (+r.award_total_bnd || 0); }, 0), savingBnd: aw.reduce(function (s, r) { return s + (+r.saving_bnd || 0); }, 0),
      byCategory: Object.keys(cats).sort().map(function (c) { var o = cats[c]; o.code = c; o.name = categoryName(c); o.replyRate = o.contacted ? o.responded / o.contacted : 0; o.validRate = o.contacted ? o.valid / o.contacted : 0; return o; }),
      topSuppliers: Object.keys(sup).map(function (s) { return sup[s]; }).sort(function (a, b) { return b.valid - a.valid || b.responded - a.responded; }).slice(0, 10),
      baseline: b, vs: {} };
    if (b.reply_rate != null) out.vs.replyRate = out.replyRate - b.reply_rate;
    if (b.quotes_per_rfq != null) out.vs.quotesPerRfq = out.quotesPerRfq - b.quotes_per_rfq;
    if (b.suppliers_per_rfq != null) out.vs.perRfq = out.perRfq - b.suppliers_per_rfq;
    if (b.minutes_per_rfq != null) out.vs.minutesSaved = null;   // time per RFQ is not measured by the app; the report shows the baseline only
    return out;
  }
  // saved discovery prompt per category: placeholders {rfq} {title} {items} {zones} {exclude} {count} {category} {urgency}; the answer format is always appended
  function promptFrom(tpl, rfq, items, opts) {
    var base = discoveryPrompt(rfq, items, opts); if (!tpl || !String(tpl).trim()) return base;
    opts = opts || {};
    var zones = (opts.zones || []).map(function (z) { return ZONES[z]; }).join('; ') || 'any country';
    var cats = []; (items || []).forEach(function (it) { if (it.category && cats.indexOf(it.category) < 0) cats.push(it.category); });
    var v = { rfq: rfq.rfq_no || '', title: rfq.title || '', zones: zones, count: opts.count || 10, urgency: rfq.urgency || '', category: cats.map(function (c) { return c + ' ' + categoryName(c); }).join(', '),
      exclude: (opts.exclude || []).join('; ') || 'none',
      items: (items || []).map(function (it, i) { return (i + 1) + '. ' + it.description + (it.spec_brand ? ' (' + it.spec_brand + ')' : '') + (it.qty ? ' - ' + it.qty + ' ' + (it.unit || '') : ''); }).join('\n') };
    var body = String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return v[k] != null ? String(v[k]) : m; });
    var fmt = base.slice(base.indexOf('Rules:'));
    return body.trim() + '\n\n' + fmt;
  }
  // RFQ short of quotes? (v3.5 goal guard) state: {status, deadline, recipients[], validQuotes}
  function shortOfQuotes(state, today) {
    today = today || iso(new Date()); var rec = state.recipients || [], v = state.validQuotes || 0;
    if (v >= 3 || ['Draft', 'Awarded', 'Cancelled', 'Approval sent'].indexOf(state.status) >= 0) return { short: false, valid: v };
    var waiting = rec.filter(function (x) { return CHASE_OPEN.indexOf(x.status) >= 0 && x.status !== 'Reminder 2'; }).length;
    var reasons = [];
    if (state.deadline && state.deadline < today) reasons.push('quote deadline ' + state.deadline + ' has passed');
    if (rec.length && !waiting) reasons.push('nobody left to chase (all replied, declined or had the final reminder)');
    if (state.status === 'Short') reasons.push('marked Short');
    var possible = v + waiting + rec.filter(function (x) { return x.status === 'Replied'; }).length;
    if (!reasons.length && possible < 3) reasons.push('even if everyone still waiting quotes, only ' + possible + ' valid quote' + (possible === 1 ? '' : 's') + ' possible');
    var zones = []; rec.forEach(function (x) { if (x.zone && zones.indexOf(+x.zone) < 0) zones.push(+x.zone); });
    var g = goalGuard({ zonesUsed: zones, validQuotes: v, reminder2Done: true });
    return { short: reasons.length > 0, valid: v, need: 3 - v, waiting: waiting, reasons: reasons, nextZones: g.zones };
  }
  // mailbox job: RFQ number in a subject / text, and delivery-failure messages
  function rfqRef(text) { var m = /RFQ-\d{4}-\d{3,}(?:-R\d+)?/i.exec(String(text || '')); return m ? m[0].toUpperCase() : ''; }
  function isBounce(from, subject) { return /mailer-daemon|postmaster|mail delivery (sub)?system/i.test(String(from || '')) || /undeliver|delivery (status notification|has failed|failure)|returned mail|failure notice|not delivered/i.test(String(subject || '')); }

  var api = {
    rfqNo: rfqNo, mrNo: mrNo, parseDocNo: parseDocNo, nextDocNo: nextDocNo, supplierId: supplierId, parseSupplierId: parseSupplierId,
    COUNTRIES: COUNTRIES, countryCode: countryCode, ZONES: ZONES, zoneOf: zoneOf, zoneLabel: zoneLabel,
    URGENCY: URGENCY, urgencyClass: urgencyClass, urgencyOf: urgencyOf, sourcingPlan: sourcingPlan, goalGuard: goalGuard,
    leadTimeWarning: leadTimeWarning, cityFromAddress: cityFromAddress, fromGeminiDirectory: fromGeminiDirectory,
    parsePhones: parsePhones, whatsappOf: whatsappOf, splitEmails: splitEmails, emailDomain: emailDomain, webDomain: webDomain,
    baseDomain: baseDomain, isFreeMail: isFreeMail, isPlatform: isPlatform, normName: normName, dedupKeys: dedupKeys,
    findDuplicates: findDuplicates, offlineChecks: offlineChecks, checkDns: checkDns,
    isWorkday: isWorkday, addWorkdays: addWorkdays, timetable: timetable, iso: iso, longDate: longDate,
    ROUNDCUBE: ROUNDCUBE, LINK_MAX: LINK_MAX, composeLink: composeLink, mailtoLink: mailtoLink, waLink: waLink,
    TEMPLATES: T, fill: fill, audienceOf: audienceOf, currencyText: currencyText, buildEmail: buildEmail, buildWhatsApp: buildWhatsApp,
    RECIPIENT_STATUS: RECIPIENT_STATUS, RESPONDED: RESPONDED, VERIFICATION: VERIFICATION, kpis: kpis, contactTarget: contactTarget,
    CATEGORIES: CATEGORIES, categoryName: categoryName, categoryCode: categoryCode, categoryCodes: categoryCodes, countryName: countryName,
    FOUND_BY: FOUND_BY, foundBy: foundBy, SUPPLIER_TYPES: SUPPLIER_TYPES, supplierType: supplierType,
    DISCOVERY_COLS: DISCOVERY_COLS, discoveryRow: discoveryRow, contactsOf: contactsOf, toSupplier: toSupplier, supplierAsRow: supplierAsRow,
    autoVerification: autoVerification, dnsTargets: dnsTargets, digits: digits,
    TEMPLATE_COLS: TEMPLATE_COLS, TEMPLATE_HELP: TEMPLATE_HELP, MR_COLS: MR_COLS, MR_HELP: MR_HELP, dateIso: dateIso, mrItem: mrItem, parsePasted: parsePasted,
    shortDesc: shortDesc, rfqItems: rfqItems, rfqForTemplates: rfqForTemplates, buildEmailFit: buildEmailFit, buildReminderEmail: buildReminderEmail,
    CHASE_OPEN: CHASE_OPEN, chaseDue: chaseDue, discoveryPrompt: discoveryPrompt, rfqFromTextSheet: rfqFromTextSheet, rfqKpis: rfqKpis, matchSupplier: matchSupplier,
    parseTable: parseTable, CURRENCIES: CURRENCIES, fxRate: fxRate, landed: landed, compareQuotes: compareQuotes, resIndex: resIndex, budgetCheck: budgetCheck, money: money, num: num,
    SCORING_DEFAULT: SCORING_DEFAULT, MUST: MUST, scoringOf: scoringOf, paymentDays: paymentDays, paymentScore: paymentScore, reliability: reliability, scoreQuotes: scoreQuotes,
    categoryRates: categoryRates, targetFor: targetFor, quoteLink: quoteLink, proposalsFrom: proposalsFrom, normUnit: normUnit, validityAlerts: validityAlerts, addDays: addDays,
    monthKpis: monthKpis, daysBetween: daysBetween, promptFrom: promptFrom, shortOfQuotes: shortOfQuotes, rfqRef: rfqRef, isBounce: isBounce
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Procure = api;
})(this);
