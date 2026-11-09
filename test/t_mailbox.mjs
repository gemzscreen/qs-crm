// v3.2.0 mailbox job with fake mail + database (no network): node test/t_mailbox.mjs
import { run } from '../scripts/mailbox.mjs';
let pass = 0, fail = 0;
const eq = (a, b, m) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL', m, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } };
const calls = [], mails = [], ups = [];
const pending = { enabled: true, left_today: 3, settings: { auto_followups: true }, holidays: [],
  company: { name: 'ARZA SDN BHD', sender_name: 'Gemar C. Tubalado', sender_designation: 'Quantity Surveyor', sender_email: 'qs@arzabrunei.com' },
  outbox: [{ id: 11, to: 'a@alpha.com', subject: 'RFQ-2611-005 - Cement', body: 'Dear Sir' }, { id: 12, to: 'bad@nowhere', subject: 'x', body: 'y' }],
  rfqs: [{ rfq_no: 'RFQ-2611-005', title: 'Cement', status: 'Sent', urgency: 'NORMAL', rfq_date: '2026-11-02', deadline: '2026-11-12', sent_at: '2026-11-02 09:00',
    items: [{ line: 1, description: 'Cement OPC 50kg', qty: 100, unit: 'bags' }],
    recipients: [{ supplier_id: 'SUP-0001', status: 'Emailed', email: 'b@beta.com', emailed_at: '2026-11-02 09:00', zone: 1, token: 'f'.repeat(64) },
      { supplier_id: 'SUP-0002', status: 'Quoted', email: 'q@q.com', emailed_at: '2026-11-02 09:00', zone: 1 },
      { supplier_id: 'SUP-0003', status: 'Emailed', email: 'c@gamma.com', emailed_at: '2026-11-09 09:00', zone: 1 }] }] };
const deps = {
  now: () => new Date('2026-11-09T15:00:00+08:00'), log: () => {}, appUrl: 'https://qs.example/',
  rpc: async (fn, p) => { calls.push([fn, p]); return fn === 'crm_mjob_pending' ? pending : { sent: p.sent.length, failed: p.failed.length, received: p.inbox.length, matched: 1 }; },
  send: async (m) => { if (m.to === 'bad@nowhere') throw new Error('550 no such user'); mails.push(m); return '<m' + mails.length + '@arza>'; },
  fetchInbox: async () => [
    { messageId: '<r1@beta>', from: 'Beta <b@beta.com>', subject: 'Re: RFQ-2611-005 - Cement', date: '2026-11-09T10:00:00Z', text: 'Our price is B$ 8.20', attachments: [{ filename: 'Q-77.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') }, { filename: 'logo.gif', contentType: 'image/gif', content: Buffer.from('g') }] },
    { messageId: '<n1@x>', from: 'news@shop.com', subject: 'Big sale', text: 'hello' },
    { messageId: '<b1@mx>', from: 'MAILER-DAEMON@mx.ipage.com', subject: 'Undelivered Mail Returned to Sender', text: 'c@gamma.com: user unknown\nSubject: RFQ-2611-005 - Cement' }],
  upload: async (folder, a) => { ups.push(folder + '/' + a.filename); return 'https://drive/' + a.filename; } };
const res = await run(deps);
const done = calls.find(c => c[0] === 'crm_mjob_done')[1];
eq(done.sent.map(s => s.id || s.kind + ':' + s.supplier_id), [11, 'reminder1:SUP-0001'], 'queued email sent + one due reminder (Quoted and not-yet-due skipped)');
eq(done.failed, [{ id: 12, error: '550 no such user' }], 'failed send reported');
eq(/Quote online \(no login\): https:\/\/qs\.example\/quote\.html\?t=f{64}/.test(mails[1].text) && /Best regards,\nGemar C. Tubalado\nQuantity Surveyor/.test(mails[1].text), true, 'reminder has the quote link and the signature');
eq(mails[0].from, 'Gemar C. Tubalado - ARZA SDN BHD', 'sender name');
eq(done.inbox.map(m => [m.message_id, m.bounce, m.attachments.map(a => a.link)]), [['<r1@beta>', false, ['https://drive/Q-77.pdf']], ['<b1@mx>', true, []]], 'reply + bounce picked up, newsletter and gif skipped');
eq(ups, ['RFQ-2611-005 - replies/Q-77.pdf'], 'attachment copied to the RFQ folder in Drive');
eq(res.matched, 1, 'result from the database');
pending.left_today = 2; mails.length = 0; calls.length = 0;
await run(deps);
eq(calls.find(c => c[0] === 'crm_mjob_done')[1].sent.length, 1, 'daily limit: queued emails use it up, no reminder');
const off = await run({ rpc: async () => ({ enabled: false }), log: () => {} });
eq(off, { skipped: true }, 'switched off in the app: nothing happens');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
