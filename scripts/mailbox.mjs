// QS CRM mailbox job (v3.2.0, optional) - runs from .github/workflows/mailbox.yml every 30 minutes.
//  1. sends the RFQ emails queued in the app (mail_outbox) from the QS mailbox, within the daily limit, and files a copy in "Sent";
//  2. if "automatic reminders" is on: sends the reminder emails that are due (Procure.chaseDue, same timetable as the app);
//  3. picks up replies whose subject / text has an RFQ number (and delivery failures), copies attachments to Drive, and hands
//     everything to the database (crm_mjob_done): the supplier becomes Replied / Bounced and the email is logged on the RFQ.
// Off unless the admin switched it on (Admin Settings › Connections › Mailbox) AND the GitHub secrets are set:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, MAIL_USER, MAIL_PASS, MAIL_IMAP_HOST, MAIL_SMTP_HOST
//   optional: MAIL_SMTP_PORT (465), MAIL_IMAP_PORT (993), APP_URL (https://qsarza.darkwizlab.com/), DRIVE_URL + DRIVE_JOB_KEY (attachments to Drive)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const P = require('../src/procure-std.js');

const LOOKBACK_DAYS = 4, MAX_ATTACH = 10 * 1024 * 1024;

// ---------- the job (pure: every outside call comes in through deps, so it can be tested) ----------
export async function run(deps) {
  const log = deps.log || console.log, now = deps.now ? deps.now() : new Date();
  const d = await deps.rpc('crm_mjob_pending', {});
  if (!d.enabled) { log('Mailbox connection is off in QS CRM (Admin Settings › Connections) - nothing to do.'); return { skipped: true }; }
  const sent = [], failed = [], inbox = [], notes = [];
  let left = d.left_today, error = '';
  const co = d.company || {}, from = co.sender_name ? `${co.sender_name} - ${co.name || 'ARZA SDN BHD'}` : (co.name || 'ARZA SDN BHD');
  const sig = '\n\nBest regards,\n' + [co.sender_name, co.sender_designation, co.name, [co.sender_phone || co.phone, co.sender_email || co.email].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
  try {
    // 1. queued emails (the database already counted them against today's limit)
    for (const o of d.outbox || []) {
      try { const id = await deps.send({ from, to: o.to, subject: o.subject, text: o.body }); sent.push({ id: o.id, message_id: id }); }
      catch (e) { failed.push({ id: o.id, error: String(e.message || e).slice(0, 300) }); }
    }
    left -= (d.outbox || []).length;
    // 2. automatic reminders
    if (d.settings && d.settings.auto_followups) {
      for (const r of d.rfqs || []) {
        if (['Draft', 'Awarded', 'Cancelled', 'Approval sent'].includes(r.status)) continue;
        const T = P.rfqForTemplates(Object.assign({}, r, { sent_date: r.sent_at ? String(r.sent_at).slice(0, 10) : r.rfq_date,
          close_date: r.deadline ? P.iso(P.addWorkdays(r.deadline, 1, d.holidays || [])) : '' }), r.items || [], co.sender_name || 'Gemar');
        for (const x of r.recipients || []) {
          if (left <= 0) break;
          if (!x.email || x.status === 'Quoted') continue;
          const due = P.chaseDue(x, r, now, d.holidays || []);
          if (due.due !== 'reminder1' && due.due !== 'reminder2') continue;
          const ql = x.token && deps.appUrl ? P.quoteLink(deps.appUrl.replace(/\/?$/, '/') + 'quote.html', x.token) : '';
          const e = P.buildReminderEmail(due.due, T, { zone: x.zone, email: x.email, quote_link: ql },
            { sent_date: P.longDate(String(x.emailed_at || x.whatsapp_at || r.rfq_date).slice(0, 10)) });
          const body = e.body.replace(/\s+$/, '') + sig;
          try { const id = await deps.send({ from, to: x.email, subject: e.subject, text: body });
            sent.push({ rfq_no: r.rfq_no, supplier_id: x.supplier_id, kind: due.due, to: x.email, subject: e.subject, body, message_id: id }); left--; }
          catch (err) { notes.push(`${r.rfq_no}/${x.supplier_id} ${due.due}: ${err.message}`); }
        }
      }
    }
    // 3. replies and bounces
    const msgs = await deps.fetchInbox(new Date(now.getTime() - LOOKBACK_DAYS * 86400000));
    for (const m of msgs) {
      const text = String(m.text || ''), bounce = P.isBounce(m.from, m.subject), ref = P.rfqRef(m.subject) || P.rfqRef(text.slice(0, 4000));
      if (!ref && !bounce) continue;
      const att = [];
      for (const a of m.attachments || []) {
        if (!a.content || a.content.length > MAX_ATTACH || /^(image\/(gif|x-icon)|application\/(pgp|pkcs7)-signature)/.test(a.contentType || '')) continue;
        let link = '';
        if (deps.upload && ref) { try { link = await deps.upload(ref + ' - replies', a); } catch (e) { notes.push('attachment ' + a.filename + ': ' + e.message); } }
        att.push({ name: a.filename || 'attachment', link });
      }
      inbox.push({ message_id: m.messageId, from: m.from, subject: m.subject, received_at: m.date ? new Date(m.date).toISOString() : '',
        snippet: (ref && !P.rfqRef(m.subject) ? ref + ' · ' : '') + text.replace(/\s+/g, ' ').trim().slice(0, 1500), attachments: att, bounce });
    }
  } catch (e) { error = String(e.message || e).slice(0, 300); log('Error: ' + error); }
  const res = await deps.rpc('crm_mjob_done', { sent, failed, inbox, status: { error, note: notes.join(' | ').slice(0, 500) } });
  log(`sent ${res.sent}, failed ${res.failed}, picked up ${res.received} (matched ${res.matched})${notes.length ? ' · ' + notes.join(' | ') : ''}`);
  if (error) throw new Error(error);
  return res;
}

// ---------- real connections (GitHub Actions) ----------
async function main() {
  const env = process.env, need = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'MAIL_USER', 'MAIL_PASS', 'MAIL_IMAP_HOST', 'MAIL_SMTP_HOST'];
  const miss = need.filter(k => !env[k]);
  if (miss.length) { console.log('Mailbox job not set up (missing secrets: ' + miss.join(', ') + ') - nothing to do.'); return; }
  const nodemailer = require('nodemailer'), MailComposer = require('nodemailer/lib/mail-composer'), { ImapFlow } = require('imapflow'), { simpleParser } = require('mailparser');
  const key = env.SUPABASE_SERVICE_KEY, headers = { apikey: key, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(key)) headers.Authorization = 'Bearer ' + key;
  const rpc = async (fn, p) => {
    const r = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers, body: JSON.stringify({ p }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(fn + ': ' + (j.message || r.status)); return j;
  };
  const smtp = nodemailer.createTransport({ host: env.MAIL_SMTP_HOST, port: +(env.MAIL_SMTP_PORT || 465), secure: +(env.MAIL_SMTP_PORT || 465) === 465, auth: { user: env.MAIL_USER, pass: env.MAIL_PASS } });
  const imap = new ImapFlow({ host: env.MAIL_IMAP_HOST, port: +(env.MAIL_IMAP_PORT || 993), secure: true, auth: { user: env.MAIL_USER, pass: env.MAIL_PASS }, logger: false });
  await imap.connect();
  let sentBox = null;
  try { const boxes = await imap.list(); sentBox = (boxes.find(b => b.specialUse === '\\Sent') || boxes.find(b => /^(INBOX\.)?Sent( Items| Messages)?$/i.test(b.path)) || {}).path || null; } catch (e) { /* no Sent copy */ }
  const send = async ({ from, to, subject, text }) => {
    const raw = await new MailComposer({ from: { name: from, address: env.MAIL_USER }, to, subject, text }).compile().build();
    const info = await smtp.sendMail({ envelope: { from: env.MAIL_USER, to: [to] }, raw });
    if (sentBox) { try { await imap.append(sentBox, raw, ['\\Seen']); } catch (e) { /* the email went out; the Sent copy is a bonus */ } }
    const m = /^Message-ID:\s*(<[^>]+>)/im.exec(raw.toString('utf8')); return m ? m[1] : info.messageId;
  };
  const fetchInbox = async (since) => {
    const out = [], lock = await imap.getMailboxLock('INBOX');
    try {
      const uids = await imap.search({ since }, { uid: true }) || [];
      for await (const msg of imap.fetch(uids.slice(-200), { source: true }, { uid: true })) {
        const p = await simpleParser(msg.source);
        out.push({ messageId: p.messageId || ('uid-' + msg.uid + '@' + env.MAIL_IMAP_HOST), from: p.from ? p.from.text : '', subject: p.subject || '', date: p.date, text: p.text || '',
          attachments: (p.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content })) });
      }
    } finally { lock.release(); }
    return out;
  };
  const upload = env.DRIVE_URL && env.DRIVE_JOB_KEY ? async (folder, a) => {
    const r = await fetch(env.DRIVE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
      body: JSON.stringify({ action: 'procUpload', jobKey: env.DRIVE_JOB_KEY, folder, file: { name: a.filename || 'attachment', type: a.contentType, data: Buffer.from(a.content).toString('base64') } }) });
    const j = await r.json(); if (!j.ok) throw new Error(j.error || 'Drive upload failed'); return j.data.url;
  } : null;
  try { await run({ rpc, send, fetchInbox, upload, appUrl: env.APP_URL || 'https://qsarza.darkwizlab.com/' }); }
  finally { await imap.logout().catch(() => {}); smtp.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e.message); process.exit(1); });
