-- v3.1.0 Procurement functions on a local database (after sb_stub.sql + schema.sql). Synthetic data only.
-- Every check raises an exception when it fails, so psql -v ON_ERROR_STOP=1 stops at the first failure.
\set QUIET on
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  %', msg; end $$;
create or replace function pg_temp.err(q text, want text, msg text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm ~* want then raise notice 'ok  % (%)', msg, sqlerrm; return; end if;
    raise exception 'FAIL: % - wrong error: %', msg, sqlerrm;
  end;
  raise exception 'FAIL: % - no error', msg;
end $$;

-- users: admin (first account), qs, viewer
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'admin@test', '{"full_name":"Admin Person"}'),
  ('00000000-0000-0000-0000-000000000002', 'qs@test', '{"full_name":"Qs Person"}'),
  ('00000000-0000-0000-0000-000000000003', 'viewer@test', '{}');
update public.profiles set role = 'qs' where email = 'qs@test';
select pg_temp.ok((select role from public.profiles where email = 'admin@test') = 'admin', 'first account is admin');

-- viewer: can read, cannot write
select set_config('request.uid', '00000000-0000-0000-0000-000000000003', false);
select pg_temp.ok(jsonb_array_length(public.crm_procdata() -> 'categories') = 23, 'viewer reads 23 categories');
select pg_temp.ok(jsonb_array_length(public.crm_procdata() #> '{lists,urgency}') = 5, '5 urgency classes');
select pg_temp.err($q$select public.crm_savesupplier('{"fields":{"name":"X","country":"BN","zone":1},"categories":[{"code":"CS"}]}')$q$, 'Read-only', 'viewer cannot add a supplier');
select pg_temp.err($q$select public.crm_setsettings('{"key":"company","value":{"name":"X"}}')$q$, 'Only the admin', 'viewer cannot change settings');

-- qs: manual supplier, validation, duplicates
select set_config('request.uid', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.err($q$select public.crm_savesupplier('{"fields":{"name":"","country":"BN","zone":1},"categories":[{"code":"CS"}]}')$q$, 'supplier name', 'name required');
select pg_temp.err($q$select public.crm_savesupplier('{"fields":{"name":"A","country":"Brunei","zone":1},"categories":[{"code":"CS"}]}')$q$, 'not known', 'country must be ISO2');
select pg_temp.err($q$select public.crm_savesupplier('{"fields":{"name":"A","country":"BN","zone":1},"categories":[]}')$q$, 'at least one material category', 'category required');
select pg_temp.err($q$select public.crm_savesupplier('{"fields":{"name":"A","country":"BN","zone":1},"categories":[{"code":"ZZ"}]}')$q$, 'Unknown category', 'category must exist');
select pg_temp.err($q$select public.crm_savesupplier('{"fields":{"name":"A","country":"BN","zone":1},"categories":[{"code":"CS"}],"contacts":[{"whatsapp":"8765432"}]}')$q$, 'international form', 'WhatsApp in E.164');
select pg_temp.err($q$select public.crm_savesupplier('{"fields":{"name":"A","country":"BN","zone":1},"categories":[{"code":"CS"}],"contacts":[{"email":"not-an-email"}]}')$q$, 'not valid', 'email checked');
select public.crm_savesupplier($j${"fields":{"name":"Beta Hardware Sdn Bhd","country":"BN","city":"Gadong","zone":1,"type":"Stockist","found_by":"Walk-in","found_on":"2026-11-09"},
  "categories":[{"code":"HW","specialty":"anchors, bolts"},{"code":"CS"}],
  "contacts":[{"name":"Ali","email":"Sales@BetaHW.com.bn","phone":"+6732223333","whatsapp":"+6738765432","preferred":"whatsapp"},{"email":"info@betahw.com.bn","preferred":"email"}],
  "keys":["email:sales@betahw.com.bn","dom:betahw.com.bn","tel:+6732223333","tel:+6738765432","name:beta hardware|BN"]}$j$) as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{supplier,supplier_id}') = 'SUP-0001', 'first supplier = SUP-0001');
select pg_temp.ok(jsonb_array_length(:'r'::jsonb #> '{supplier,contacts}') = 2 and (:'r'::jsonb #>> '{supplier,contacts,0,email}') = 'sales@betahw.com.bn', '2 contacts, email lower case');
select pg_temp.ok((:'r'::jsonb #>> '{supplier,verification}') = 'Unverified' and (:'r'::jsonb #>> '{supplier,status}') = 'Active', 'new = Unverified, Active');
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> '_log') = 1, 'log line returned');
-- same email domain -> not saved, duplicates returned; force saves it
select public.crm_savesupplier('{"fields":{"name":"Beta HW (Kiulap)","country":"BN","zone":1},"categories":[{"code":"HW"}],"keys":["dom:betahw.com.bn","name:beta hw|BN"]}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'saved') = 'false' and (:'r'::jsonb #>> '{dups,0,supplier_id}') = 'SUP-0001' and (:'r'::jsonb #>> '{dups,0,keys,0}') = 'dom:betahw.com.bn', 'duplicate by domain found');
select public.crm_savesupplier('{"force":true,"fields":{"name":"Beta HW (Kiulap)","country":"BN","zone":1},"categories":[{"code":"HW"}],"keys":["dom:betahw.com.bn"]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{supplier,supplier_id}') = 'SUP-0002', 'forced save = SUP-0002');
-- update
select public.crm_savesupplier('{"supplier_id":"sup-0002","fields":{"name":"Beta HW Kiulap Branch","country":"BN","zone":1,"notes":"branch"},"categories":[{"code":"HW"}],"keys":["dom:betahw.com.bn"]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{supplier,name}') = 'Beta HW Kiulap Branch' and (:'r'::jsonb #>> '{_log,0,detail}') ~ 'name: Beta HW \(Kiulap\) -> Beta HW Kiulap Branch', 'update logs the changed fields');

-- verification and status rules
select pg_temp.err($q$select public.crm_setsupplierstate('{"supplier_id":"SUP-0001","verification":"Verified"}')$q$, 'Say how it was verified', 'Verified needs a note');
select public.crm_setsupplierstate('{"supplier_id":"SUP-0001","verification":"Verified","note":"call OK 9 Nov"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{supplier,verification}') = 'Verified' and (:'r'::jsonb #>> '{supplier,verified_at}') is not null, 'Verified with note');
select pg_temp.err($q$select public.crm_setsupplierstate('{"supplier_id":"SUP-0002","status":"Blacklisted"}')$q$, 'reason for blacklisting', 'Blacklisted needs a reason');
select public.crm_setsupplierstate('{"supplier_id":"SUP-0002","status":"Inactive","note":"same as SUP-0001"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{supplier,status}') = 'Inactive', 'Inactive');
select pg_temp.ok(jsonb_array_length(public.crm_supplier('{"supplier_id":"SUP-0001"}') -> 'log') = 2, 'supplier log: created + verified');

-- review queue: add, skip identical, DNS, approve / duplicate / merge / reject / reopen
select public.crm_queueadd($j${"source_file":"test.xlsx","rows":[
  {"row_no":2,"data":{"company_name":"Gamma Metal Co., Ltd.","country":"China","category":"MW"},"checks":{"ok":true,"issues":[]},"keys":["email:sales@gammametal.com","dom:gammametal.com","name:gamma metal|CN"]},
  {"row_no":3,"data":{"company_name":"Beta Hardware","country":"Brunei","category":"HW"},"checks":{"ok":true,"issues":[]},"keys":["email:ali@betahw.com.bn","dom:betahw.com.bn","name:beta hardware|BN"]},
  {"row_no":4,"data":{"company_name":"Delta Tiles","country":"Malaysia","category":"TI"},"checks":{"ok":false,"issues":["unknown city"]},"keys":["name:delta tiles|MY"]}]}$j$) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'added') = '3', '3 rows added to the queue');
select public.crm_queueadd('{"source_file":"test.xlsx","rows":[{"row_no":2,"data":{"company_name":"Gamma Metal Co., Ltd."},"keys":["name:gamma metal|CN","dom:gammametal.com","email:sales@gammametal.com"]}]}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'added') = '0' and (:'r'::jsonb ->> 'skipped') = '1', 'same row again = skipped');
select public.crm_queue() as q \gset
select pg_temp.ok(jsonb_array_length(:'q'::jsonb -> 'rows') = 3 and (:'q'::jsonb #>> '{counts,Pending}') = '3', 'queue: 3 pending');
select pg_temp.ok((select jsonb_array_length(x -> 'dups') from jsonb_array_elements(:'q'::jsonb -> 'rows') x where x #>> '{data,company_name}' = 'Beta Hardware') = 2, 'Beta Hardware matches SUP-0001 and SUP-0002');
select id as gid from public.discovery_candidates where data ->> 'company_name' = 'Gamma Metal Co., Ltd.' \gset
select id as bid from public.discovery_candidates where data ->> 'company_name' = 'Beta Hardware' \gset
select id as did from public.discovery_candidates where data ->> 'company_name' = 'Delta Tiles' \gset
select public.crm_queuedns(jsonb_build_object('rows', jsonb_build_array(jsonb_build_object('id', :gid, 'dns', '{"mx":true,"a":true,"mx_domain":"gammametal.com"}'::jsonb)))) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'updated') = '1', 'DNS result stored');
select public.crm_queuedecide(jsonb_build_object('items', jsonb_build_array(
  jsonb_build_object('id', :gid, 'action', 'approve', 'verification', 'Checked',
    'fields', '{"name":"Gamma Metal Co., Ltd.","country":"CN","city":"Foshan","zone":4,"found_by":"Claude","found_on":"2026-11-08"}'::jsonb,
    'categories', '[{"code":"MW","specialty":"SS tubes"}]'::jsonb, 'contacts', '[{"email":"sales@gammametal.com","preferred":"email"}]'::jsonb),
  jsonb_build_object('id', :bid, 'action', 'approve', 'fields', '{"name":"Beta Hardware","country":"BN","zone":1}'::jsonb, 'categories', '[{"code":"HW"}]'::jsonb),
  jsonb_build_object('id', :did, 'action', 'approve', 'fields', '{"name":"Delta Tiles","country":"MY","zone":7}'::jsonb, 'categories', '[{"code":"TI"}]'::jsonb)))) as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{results,0,supplier_id}') = 'SUP-0003' and (select verification from public.suppliers where supplier_id = 'SUP-0003') = 'Checked'
  and (select dns ->> 'mx' from public.suppliers where supplier_id = 'SUP-0003') = 'true', 'approve -> SUP-0003, Checked, DNS kept');
select pg_temp.ok((:'r'::jsonb #>> '{results,1,ok}') = 'false' and (:'r'::jsonb #>> '{results,1,error}') ~ 'Possible duplicate of SUP-0001', 'approve of a duplicate is held back');
select pg_temp.ok((:'r'::jsonb #>> '{results,2,ok}') = 'false' and (:'r'::jsonb #>> '{results,2,error}') ~ 'zone must be 1 to 5', 'bad row -> error for that row only');
select pg_temp.ok((:'r'::jsonb ->> 'pending') = '2', '2 still pending');
select public.crm_queuedecide(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', :bid, 'action', 'merge', 'supplier_id', 'SUP-0001',
  'fields', '{"name":"Beta Hardware","country":"BN","zone":1,"address":"Unit 5, Gadong","notes":"from test.xlsx"}'::jsonb,
  'categories', '[{"code":"HW"},{"code":"PL","specialty":"taps"}]'::jsonb,
  'contacts', '[{"email":"ali@betahw.com.bn","preferred":"email"},{"email":"SALES@betahw.com.bn"},{"phone":"+6738765432"}]'::jsonb)))) as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{results,0,status}') = 'Merged', 'merged into SUP-0001');
select pg_temp.ok((select count(*) from public.supplier_contacts where supplier_id = 'SUP-0001') = 3, 'merge adds only the new email (3 contacts)');
select pg_temp.ok((select count(*) from public.supplier_categories where supplier_id = 'SUP-0001') = 3, 'merge adds category PL');
select pg_temp.ok((select address from public.suppliers where supplier_id = 'SUP-0001') = 'Unit 5, Gadong' and (select notes from public.suppliers where supplier_id = 'SUP-0001') = 'from test.xlsx', 'merge fills blank fields, adds notes');
select pg_temp.ok((select 'email:ali@betahw.com.bn' = any (dedup_keys) from public.suppliers where supplier_id = 'SUP-0001'), 'merge adds the de-dup keys');
select public.crm_queuedecide(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', :did, 'action', 'reject', 'reason', 'not a tile supplier')))) as r \gset
select pg_temp.ok((select status from public.discovery_candidates where id = :did) = 'Rejected', 'reject');
select public.crm_queuedecide(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', :did, 'action', 'reopen')))) as r \gset
select pg_temp.ok((select status from public.discovery_candidates where id = :did) = 'Pending', 'reopen');
select public.crm_queuedecide(jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', :gid, 'action', 'reject')))) as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{results,0,error}') ~ 'already approved', 'decided rows stay decided');
select pg_temp.ok((public.crm_queue('{"status":"All"}') #>> '{counts,Approved}') = '1' and (public.crm_queue('{"status":"All"}') #>> '{counts,Merged}') = '1', 'queue counts');
select pg_temp.ok(jsonb_array_length(public.crm_supplier('{"supplier_id":"SUP-0003"}') -> 'sources') = 1, 'supplier knows its queue row');
select pg_temp.ok((public.crm_procdata() ->> 'pending') = '1' and jsonb_array_length(public.crm_procdata() -> 'suppliers') = 3, 'procdata: 3 suppliers, 1 pending');

-- settings (admin)
select set_config('request.uid', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.ok((public.crm_settings() #>> '{approval,email}') = 'qs@arzabrunei.com', 'default approval addressee');
select pg_temp.err($q$select public.crm_setsettings('{"key":"company","value":{"logo":"data:text/html;base64,AAAA"}}')$q$, 'PNG, JPG or WebP', 'logo must be an image');
select public.crm_setsettings('{"key":"company","value":{"name":"ARZA SDN BHD","address":"Bandar Seri Begawan","hack":"x","logo":"data:image/png;base64,iVBORw0KGgo="}}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{value,name}') = 'ARZA SDN BHD' and not (:'r'::jsonb -> 'value') ? 'hack', 'company saved, unknown keys dropped');
select pg_temp.ok((public.crm_settings() #>> '{company,logo}') like 'data:image/png;base64,%', 'logo stored');
select pg_temp.err($q$select public.crm_setholidays('{"add":[{"date":"2026-13-01"}]}')$q$, 'date|out of range', 'holiday date checked');
select public.crm_setholidays('{"add":[{"date":"2026-12-25","label":"Christmas Day"},{"date":"2027-01-01","label":"New Year"}]}') as r \gset
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> 'holidays') = 2, '2 holidays');
select public.crm_setholidays('{"remove":["2027-01-01"]}') as r \gset
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> 'holidays') = 1 and (:'r'::jsonb #>> '{holidays,0,label}') = 'Christmas Day', 'holiday removed');

-- v3.1.2: RFQs (as qs)
select set_config('request.uid', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.err($q$select public.crm_saverfq('{"header":{"title":""},"items":[{"description":"x"}]}')$q$, 'title', 'RFQ title required');
select pg_temp.err($q$select public.crm_saverfq('{"header":{"title":"T"},"items":[]}')$q$, 'at least one item', 'items required');
select pg_temp.err($q$select public.crm_saverfq('{"header":{"title":"T"},"items":[{"description":"x","qty":"ten"}]}')$q$, 'not a number', 'qty must be a number');
select pg_temp.err($q$select public.crm_saverfq('{"header":{"title":"T"},"items":[{"description":"x","category":"ZZ"}]}')$q$, 'Unknown category', 'item category checked');
-- import RFQ-2611-002 with its own number, then the first new RFQ of the month is RFQ-2611-003
select public.crm_saverfq('{"rfq_no":"RFQ-2611-002","new":true,"header":{"title":"SS304 railing tubes","rfq_date":"2026-11-08","deadline":"2026-11-12","urgency":"RESTOCK","qty_mode":"moq"},"items":[{"description":"SS304 tube 25.4mm","category":"MW"},{"description":"SS304 fittings","category":"MW"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'rfq_no') = 'RFQ-2611-002' and (:'r'::jsonb #>> '{rfq,status}') = 'Draft', 'imported RFQ keeps its number');
select pg_temp.err($q$select public.crm_saverfq('{"rfq_no":"RFQ-2611-002","new":true,"header":{"title":"again"},"items":[{"description":"x"}]}')$q$, 'already exists', 'imported number cannot be reused');
select public.crm_saverfq('{"header":{"title":"Cement and plywood","rfq_date":"2026-11-09","urgency":"URGENT","deadline":"2026-11-10","delivery_place":"Gadong"},"items":[{"description":"Cement OPC 50kg","qty":200,"unit":"bags","category":"CC","required_date":"2026-11-14"},{"description":"Plywood 18mm","qty":"40","unit":"sheets","category":"FW","required_date":"2026-11-12"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'rfq_no') = 'RFQ-2611-003', 'next number RFQ-2611-003');
select pg_temp.ok((:'r'::jsonb #>> '{rfq,required_date}') = '2026-11-12', 'required date = earliest item date');
select public.crm_saverfq('{"header":{"title":"December job","rfq_date":"2026-12-01"},"items":[{"description":"Paint"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'rfq_no') = 'RFQ-2612-001', 'numbering restarts each month');
-- send list
select pg_temp.err($q$select public.crm_setrecipients('{"rfq_no":"RFQ-2611-003","add":[{"supplier_id":"SUP-0009"}]}')$q$, 'not found', 'unknown supplier');
select public.crm_setrecipients('{"rfq_no":"rfq-2611-003","add":[{"supplier_id":"SUP-0001","zone":1,"priority":1,"email":"sales@betahw.com.bn","whatsapp":"+6738765432"},{"supplier_id":"SUP-0003","zone":4,"priority":2,"email":"sales@gammametal.com"},{"supplier_id":"SUP-0002","zone":1,"priority":1}]}') as r \gset
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> 'recipients') = 3 and (:'r'::jsonb #>> '{recipients,0,stats,rfqs}') = '1', '3 on the send list, with stats');
select public.crm_setrecipients('{"rfq_no":"RFQ-2611-003","remove":["SUP-0002"]}') as r \gset
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> 'recipients') = 2, 'remove a not-contacted supplier');
-- clicks: Email then WhatsApp -> statuses + RFQ Sent
select public.crm_rfqclick('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","action":"email"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{recipient,status}') = 'Emailed' and (:'r'::jsonb ->> 'rfq_status') = 'Sent', 'Email click -> Emailed, RFQ Sent');
select public.crm_rfqclick('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","action":"whatsapp"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{recipient,status}') = 'WhatsApp sent' and (:'r'::jsonb #>> '{recipient,emailed_at}') is not null, 'WhatsApp click -> WhatsApp sent');
select pg_temp.err($q$select public.crm_setrecipients('{"rfq_no":"RFQ-2611-003","remove":["SUP-0001"]}')$q$, 'already contacted', 'contacted supplier cannot be removed');
select public.crm_rfqclick('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0003","action":"email"}') as r \gset
select public.crm_rfqclick('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0003","action":"reminder1"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{recipient,status}') = 'Reminder 1' and (:'r'::jsonb ->> 'rfq_status') = 'Chasing', 'reminder -> Chasing');
select pg_temp.ok((select count(*) from public.rfq_clicks where rfq_no = 'RFQ-2611-003') = 4, '4 clicks logged');
-- replies: Quoted -> supplier Verified; Bounced with no phone -> Failed
update public.suppliers set verification = 'Checked' where supplier_id = 'SUP-0001';
select public.crm_setrecipient('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","status":"Quoted","note":"B$ 7.20/bag"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{recipient,valid_quote}') = 'true' and (:'r'::jsonb #>> '{recipient,replied_at}') is not null, 'Quoted = valid by default, reply time set');
select pg_temp.ok((select verification from public.suppliers where supplier_id = 'SUP-0001') = 'Verified', 'reply -> supplier Verified');
select public.crm_setrecipient('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0003","status":"Bounced"}') as r \gset
select pg_temp.ok((select verification from public.suppliers where supplier_id = 'SUP-0003') = 'Failed', 'bounced + no phone -> supplier Failed');
select public.crm_setrecipient('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","status":"Quoted","valid_quote":false}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{recipient,valid_quote}') = 'false', 'valid tick can be removed');
select pg_temp.ok((select (x -> 'stats' ->> 'responded')::int from jsonb_array_elements(public.crm_procdata() -> 'suppliers') x where x ->> 'supplier_id' = 'SUP-0001') = 1, 'supplier stats: 1 response');
-- import with statuses and dates
select public.crm_setrecipients('{"rfq_no":"RFQ-2611-002","add":[{"supplier_id":"SUP-0003","status":"Quoted","emailed_at":"2026-11-08 10:00","replied_at":"2026-11-09 09:00","valid_quote":true}]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{recipients,0,status}') = 'Quoted' and (:'r'::jsonb #>> '{rfq,status}') = 'Sent' and (:'r'::jsonb #>> '{rfq,sent_at}') = '2026-11-08 10:00', 'import keeps status and dates');
-- register, status by hand
select pg_temp.ok(jsonb_array_length(public.crm_rfqs() -> 'rfqs') = 3 and (public.crm_rfqs() #>> '{rfqs,0,rfq_no}') = 'RFQ-2612-001', 'register lists 3 RFQs, newest first');
select pg_temp.err($q$select public.crm_rfqstatus('{"rfq_no":"RFQ-2612-001","status":"Cancelled"}')$q$, 'reason', 'cancel needs a reason');
select public.crm_rfqstatus('{"rfq_no":"RFQ-2612-001","status":"Cancelled","note":"job postponed"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') = 'Cancelled', 'cancelled');
select pg_temp.err($q$select public.crm_saverfq('{"rfq_no":"RFQ-2612-001","header":{"title":"x"},"items":[{"description":"y"}]}')$q$, 'cannot be changed', 'cancelled RFQ is locked');
select public.crm_rfqstatus('{"rfq_no":"RFQ-2612-001","status":"auto"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') = 'Draft', 'back to automatic status');
select pg_temp.ok(jsonb_array_length(public.crm_rfq('{"rfq_no":"RFQ-2611-003"}') -> 'log') >= 4, 'RFQ history');
select set_config('request.uid', '00000000-0000-0000-0000-000000000003', false);
select pg_temp.err($q$select public.crm_rfqclick('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","action":"email"}')$q$, 'Read-only', 'viewer cannot click-log');
select pg_temp.ok(jsonb_array_length(public.crm_rfq('{"rfq_no":"RFQ-2611-003"}') -> 'items') = 2, 'viewer reads an RFQ');

-- v3.1.3: quotes, FX, recommendation, approval, award, connections (as qs, then admin)
select set_config('request.uid', '00000000-0000-0000-0000-000000000002', false);
select pg_temp.err($q$select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0002","header":{},"lines":[{"line":1,"unit_price":"7"}]}')$q$, 'not on the send list', 'quote only from a send-list supplier');
select pg_temp.err($q$select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","header":{},"lines":[{"line":1,"unit_price":""}]}')$q$, 'at least one unit price', 'quote needs a price');
select pg_temp.err($q$select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","header":{"lead_days":"two"},"lines":[{"line":1,"unit_price":"7"}]}')$q$, 'must be a number', 'lead days numeric');
update public.rfq_recipients set status = 'Replied', valid_quote = null where rfq_no = 'RFQ-2611-003' and supplier_id = 'SUP-0001';
select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","header":{"currency":"BND","lead_days":"2","validity":"2026-12-31","payment_terms":"COD","quote_ref":"Q-881"},"lines":[{"line":1,"unit_price":"7.20","unit":"bags"},{"line":2,"unit_price":"31"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{quote,rev}') = '1' and jsonb_array_length(:'r'::jsonb #> '{quote,lines}') = 2 and (:'r'::jsonb #>> '{quote,ref}') = 'RFQ-2611-003/SUP-0001/1', 'quote saved, rev 1, 2 lines');
select pg_temp.ok((select status || ' ' || valid_quote from public.rfq_recipients where rfq_no = 'RFQ-2611-003' and supplier_id = 'SUP-0001') = 'Quoted true', 'quote -> recipient Quoted + valid');
select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","header":{"currency":"BND"},"lines":[{"line":1,"unit_price":"7.00"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{quote,rev}') = '1' and jsonb_array_length(:'r'::jsonb #> '{quote,lines}') = 1, 'saving again updates the current revision');
select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","new_rev":true,"header":{"currency":"USD","freight":"50"},"lines":[{"line":1,"unit_price":"5.5"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{quote,rev}') = '2' and (select count(*) from public.quotes where rfq_no = 'RFQ-2611-003' and supplier_id = 'SUP-0001' and current) = 1, 'revised quote = rev 2, only one current');
select pg_temp.ok(jsonb_array_length(public.crm_rfq('{"rfq_no":"RFQ-2611-003"}') -> 'quotes') = 2 and (public.crm_rfq('{"rfq_no":"RFQ-2611-003"}') #>> '{fx,USD,rate}') = '1.2813', 'crm_rfq returns quotes + FX');
select pg_temp.ok((select (x ->> 'quotes_n')::int from jsonb_array_elements(public.crm_rfqs() -> 'rfqs') x where x ->> 'rfq_no' = 'RFQ-2611-003') = 1, 'register counts current quotes');
select pg_temp.err($q$select public.crm_setfx('{"rates":{"SGD":{"rate":"1"}}}')$q$, 'always 1:1', 'S$ fixed 1:1');
select pg_temp.err($q$select public.crm_setfx('{"rates":{"USD":{"rate":"-1"}}}')$q$, 'positive', 'FX positive');
select public.crm_setfx('{"rates":{"USD":{"rate":"1.29","date":"2026-11-09","source":"bank"},"CNY":{"rate":"0.189"},"EUR":{"rate":""}}}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{fx,USD,rate}') = '1.29' and not (:'r'::jsonb -> 'fx') ? 'EUR', 'FX saved (blank rates dropped)');
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"recommend","supplier_id":"SUP-0003"}')$q$, 'has no quote', 'recommend needs a quote');
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-002","action":"approval_sent"}')$q$, 'recommended supplier first', 'approval needs a recommendation');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"recommend","supplier_id":"SUP-0001","reason":"lowest landed, in stock"}') as r \gset
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"approval_sent"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') = 'Approval sent' and (:'r'::jsonb #>> '{rfq,fx_snapshot,USD,rate}') = '1.29', 'approval sent, FX snapshot kept');
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"award","supplier_id":"SUP-0001"}')$q$, 'Who approved', 'award needs the approver');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"award","supplier_id":"SUP-0001","award_by":"Hj Ahmad","po_ref":"PO-2611-01"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') = 'Awarded' and (:'r'::jsonb #>> '{rfq,award_supplier}') = 'SUP-0001' and (:'r'::jsonb #>> '{rfq,award_date}') is not null, 'awarded');
select pg_temp.err($q$select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","header":{},"lines":[{"line":1,"unit_price":"7"}]}')$q$, 'awarded', 'awarded RFQ locks quotes');
select public.crm_rfqclick('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0001","action":"thanks"}') as r \gset
select pg_temp.ok((select count(*) from public.rfq_clicks where rfq_no = 'RFQ-2611-003' and action = 'thanks') = 1, 'thank-you click logged');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"reopen","note":"PO cancelled"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') <> 'Awarded' and (:'r'::jsonb #>> '{rfq,award_supplier}') is null, 'reopen clears the award');
select public.crm_deletequote(jsonb_build_object('id', (select id from public.quotes where rfq_no = 'RFQ-2611-003' and rev = 2))) as r \gset
select pg_temp.ok((select rev from public.quotes where rfq_no = 'RFQ-2611-003' and current) = 1, 'deleting rev 2 makes rev 1 current again');
select public.crm_queueadd('{"source_file":"AI answer","rows":[{"i":"7","data":{"company_name":"Zeta Co","country":"Brunei"},"keys":["name:zeta|BN"]}]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{ids,0,i}') = '7' and (:'r'::jsonb #>> '{ids,0,id}') is not null, 'queueadd returns the new ids');
select set_config('request.uid', '00000000-0000-0000-0000-000000000001', false);
select pg_temp.err($q$select public.crm_setsettings('{"key":"connections","value":{"drive_url":"https://example.com/x"}}')$q$, 'must look like', 'Drive link checked');
select public.crm_setsettings('{"key":"connections","value":{"drive_url":"https://script.google.com/macros/s/AKfycbx-Ab_12/exec"}}') as r \gset
select pg_temp.ok((public.crm_settings() #>> '{connections,drive_url}') = 'https://script.google.com/macros/s/AKfycbx-Ab_12/exec', 'Drive link stored in the database');

-- v3.2.0: tender status Pending, closing list, scoring settings, quote link, rate proposals, delivery, must-pass,
-- price history, marketplace posts, mailbox (admin is signed in here)
select pg_temp.ok((select sort from public.lists where list = 'status' and value = 'Pending') = 3 and (select sort from public.lists where list = 'status' and value = 'Submitted') = 4, 'status Pending between Pricing and Submitted');
insert into public.tenders (arza_no, title, status, closing_date) select 'T' || (900 + g), 'Tender ' || g, case when g = 2 then 'Won' when g = 3 then 'Pending' else 'Pricing' end,
  ((now() at time zone 'Asia/Brunei')::date + (case when g <= 3 then g * 5 else 25 + g * 5 end)) + time '10:00' from generate_series(1, 8) g;
select public.crm_dashboard() as r \gset
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> 'closing') = 5 and (:'r'::jsonb #>> '{closing,0,arza_no}') = 'T901', 'closing list: at least the 5 nearest (Won left out)');
select pg_temp.ok((select count(*) from jsonb_array_elements(:'r'::jsonb -> 'closing') x where (x ->> 'later')::boolean) = 3, 'closing list flags tenders after 30 days');
select pg_temp.ok((:'r'::jsonb #>> '{kpi,pending}') = '1' and (:'r'::jsonb #>> '{kpi,open}')::int >= 7, 'Pending counts as open');
select pg_temp.err($q$select public.crm_setjson('{"key":"scoring","value":{"price":"x","lead":20,"payment":10,"reliability":10}}')$q$, 'must be a number', 'scoring weights checked');
select public.crm_setjson('{"key":"scoring","value":{"price":60,"lead":20,"payment":10,"reliability":10,"must_in_time":true}}') as r \gset
select pg_temp.ok((public.crm_settings() #>> '{scoring,must_in_time}') = 'true' and (public.crm_settings() #>> '{scoring,must_complete}') = 'true', 'scoring saved with must-pass defaults');
select pg_temp.err($q$select public.crm_setjson('{"key":"prompts","value":{"ZZ":"x"}}')$q$, 'Unknown category', 'prompts per known category');
select public.crm_setjson('{"key":"prompts","value":{"HV":"Find aircon suppliers in {zones} for {items}"}}') as r \gset
select pg_temp.ok((public.crm_settings() #>> '{prompts,HV}') like 'Find aircon%', 'discovery prompt saved');
select public.crm_setjson('{"key":"kpi_baseline","value":{"minutes_per_rfq":"70","reply_rate":"0.3","note":"manual log"}}') as r \gset
select pg_temp.ok((public.crm_settings() #>> '{kpi_baseline,minutes_per_rfq}') = '70', 'KPI baseline saved');
select pg_temp.err($q$select public.crm_setjson('{"key":"mailbox","value":{"enabled":true}}')$q$, 'who approved', 'mailbox needs the approval record');
-- quote link (no sign-in)
select token as tok from public.rfq_recipients where rfq_no = 'RFQ-2611-003' and supplier_id = 'SUP-0003' \gset
select pg_temp.ok(:'tok' ~ '^[0-9a-f]{64}$', 'each recipient has a 64-hex quote token');
select set_config('request.uid', '', false);
select pg_temp.err($q$select public.crm_rfq('{"rfq_no":"RFQ-2611-003"}')$q$, 'Not signed in', 'no sign-in: RFQ page refused');
select pg_temp.err($q$select public.crm_qform('{"t":"abc"}')$q$, 'not valid', 'bad token refused');
select public.crm_qform(jsonb_build_object('t', :'tok')) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'open')::boolean and jsonb_array_length(:'r'::jsonb -> 'items') = 2 and not (:'r'::jsonb ? 'recipients'), 'quote form shows the items only');
select pg_temp.err(format($q$select public.crm_qsubmit('{"t":"%s","lines":[{"line":1,"unit_price":"9"}]}')$q$, :'tok'), 'your name', 'quote form needs a name');
select public.crm_qsubmit(jsonb_build_object('t', :'tok', 'name', 'Mr Tan', 'header', jsonb_build_object('currency', 'BND', 'lead_days', '3', 'valid', false, 'clearing_bnd', '999'),
  'lines', jsonb_build_array(jsonb_build_object('line', 1, 'unit_price', '8.10'), jsonb_build_object('line', 2, 'unit_price', '31')))) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'ok')::boolean and (select source || ' ' || submitted_by || ' ' || valid || ' ' || clearing_bnd from public.quotes where rfq_no = 'RFQ-2611-003' and supplier_id = 'SUP-0003' and current) = 'link Mr Tan true 0', 'link quote saved (supplier cannot set our own cost fields)');
select pg_temp.ok((select status from public.rfq_recipients where rfq_no = 'RFQ-2611-003' and supplier_id = 'SUP-0003') = 'Quoted', 'link quote marks the supplier Quoted');
select pg_temp.ok((select user_name from public.activity_log where arza_no = 'RFQ-2611-003' order by id desc limit 1) like 'Supplier link - Mr Tan%', 'log names the supplier as the actor');
select pg_temp.ok(coalesce(current_setting('crm.actor', true), '') = '', 'actor cleared after the link quote');
select pg_temp.err($q$select public.crm_savequote('{"rfq_no":"RFQ-2611-003","supplier_id":"SUP-0003","header":{},"lines":[{"line":1,"unit_price":"7"}]}')$q$, 'Not signed in', 'no sign-in: normal quote entry refused');
set role anon;
select pg_temp.ok((public.crm_qform(jsonb_build_object('t', :'tok')) ->> 'rfq_no') = 'RFQ-2611-003', 'anon may open the quote form');
select pg_temp.err($q$select public.crm_rfqs()$q$, 'permission denied', 'anon may not call anything else');
reset role;
select set_config('request.uid', '00000000-0000-0000-0000-000000000002', false);
-- must-pass, award with rate proposals, delivery
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"must_pass","must_pass":{"complete":true,"spec":true,"valid":false,"in_time":true,"bogus":true}}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,must_pass,valid}') = 'false' and not (:'r'::jsonb #> '{rfq,must_pass}') ? 'bogus', 'must-pass checks per RFQ');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"award","supplier_id":"SUP-0003","award_by":"Hj Ahmad","total_bnd":"1402.00","saving_bnd":"120.5","scores":[{"supplier_id":"SUP-0003","score":88}],
  "proposals":[{"line":1,"res_code":"M01","description":"Cement OPC 50kg","unit":"bags","ml_unit":"bag","ml_price":"7.50","new_price":"8.104"},{"line":2,"res_code":"bad code","new_price":"1"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,award_total_bnd}') = '1402.00' and (:'r'::jsonb #>> '{rfq,scores,0,score}') = '88', 'award keeps total, saving and scores');
select pg_temp.ok((select count(*) from public.rate_proposals where rfq_no = 'RFQ-2611-003') = 1 and (select new_price from public.rate_proposals where rfq_no = 'RFQ-2611-003') = 8.10, 'one rate proposal (bad code skipped, rounded)');
select id as pid from public.rate_proposals where rfq_no = 'RFQ-2611-003' \gset
select public.crm_ratedecide(jsonb_build_object('id', :pid, 'decision', 'Accepted', 'note', 'written to Res')) as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{proposal,status}') = 'Accepted' and (:'r'::jsonb #>> '{proposal,decided_by}') = 'Qs Person', 'rate proposal accepted');
select pg_temp.ok(jsonb_array_length(public.crm_rateprops('{"status":"Accepted"}') -> 'proposals') = 1, 'rate proposals listed by status');
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"delivery","quality":"9"}')$q$, '1 \(poor\)', 'quality 1-5');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"delivery","delivered_on":"2026-11-20","on_time":true,"quality":"4"}') as r \gset
select pg_temp.ok((public.crm_supstats('SUP-0003') ->> 'on_time') = '1' and (public.crm_supstats('SUP-0003') ->> 'quality') = '4.0' and (public.crm_supstats('SUP-0003') ->> 'awards') = '1', 'scorecard: award, on time, quality');
select pg_temp.ok(jsonb_array_length(public.crm_quoteprices('{"q":"cement"}') -> 'rows') >= 2 and (public.crm_quoteprices('{"q":"cement opc"}') #>> '{rows,0,awarded}') is not null, 'price history by words');
select pg_temp.ok(jsonb_array_length(public.crm_quoteprices('{"q":"cement -none zzz"}') -> 'rows') = 0, 'price history: all words must match');
-- marketplace posts
select pg_temp.err($q$select public.crm_savepost('{"rfq_no":"RFQ-2611-003","platform":"Alibaba RFQ","url":"ftp://x"}')$q$, 'https', 'post link checked');
select public.crm_savepost('{"rfq_no":"RFQ-2611-003","platform":"Alibaba RFQ","url":"https://rfq.alibaba.com/x"}') as r \gset
select public.crm_savepost(jsonb_build_object('rfq_no', 'RFQ-2611-003', 'id', :'r'::jsonb #>> '{post,id}', 'platform', 'Alibaba RFQ', 'responses', '4')) as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{post,responses}') = '4' and jsonb_array_length(public.crm_rfq('{"rfq_no":"RFQ-2611-003"}') -> 'posts') = 1, 'marketplace post saved + updated');
select public.crm_deletepost(jsonb_build_object('id', :'r'::jsonb #>> '{post,id}')) as r \gset
select pg_temp.ok(jsonb_array_length(public.crm_rfq('{"rfq_no":"RFQ-2611-003"}') -> 'posts') = 0, 'marketplace post removed');
-- mailbox
select pg_temp.err($q$select public.crm_setjson('{"key":"mailbox","value":{"enabled":false}}')$q$, 'Only the admin', 'mailbox setting is admin only');
select pg_temp.err($q$select public.crm_mailqueue('{"rfq_no":"RFQ-2611-002","items":[]}')$q$, 'mailbox connection is off', 'queue refused while the mailbox is off');
select set_config('request.uid', '00000000-0000-0000-0000-000000000001', false);
select public.crm_setjson('{"key":"mailbox","value":{"enabled":true,"daily_limit":"2","auto_followups":true,"approved_by":"Hj Ahmad","approved_on":"2026-11-09"}}') as r \gset
select pg_temp.ok((public.crm_settings() #>> '{mailbox,enabled}') = 'true', 'mailbox on with the approval record');
select set_config('request.uid', '00000000-0000-0000-0000-000000000002', false);
update public.rfq_recipients set email = 'sales@gammametal.com' where rfq_no = 'RFQ-2611-002' and supplier_id = 'SUP-0003';
select public.crm_mailqueue('{"rfq_no":"RFQ-2611-002","items":[{"supplier_id":"SUP-0003","kind":"rfq","to":"Sales@GammaMetal.com","subject":"RFQ RFQ-2611-002","body":"Dear Sir"}]}') as r \gset
select public.crm_mailqueue('{"rfq_no":"RFQ-2611-002","items":[{"supplier_id":"SUP-0003","kind":"rfq","to":"sales@gammametal.com","subject":"RFQ RFQ-2611-002","body":"Dear Sir"}]}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'skipped') = '1' and jsonb_array_length(:'r'::jsonb -> 'outbox') = 1, 'same email not queued twice');
select pg_temp.err($q$select public.crm_mjob_pending()$q$, 'Mailbox job only', 'signed-in users cannot run the job functions');
select set_config('request.uid', '', false);
select public.crm_mjob_pending() as r \gset
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> 'outbox') = 1 and (:'r'::jsonb ->> 'left_today') = '2' and jsonb_array_length(:'r'::jsonb -> 'rfqs') >= 2, 'job gets the queue and open RFQs');
select public.crm_mjob_done(jsonb_build_object('sent', jsonb_build_array(jsonb_build_object('id', :'r'::jsonb #>> '{outbox,0,id}', 'message_id', '<m1@arza>')),
  'inbox', jsonb_build_array(
    jsonb_build_object('message_id', '<r1@gamma>', 'from', 'Ann <ann@gammametal.com>', 'subject', 'Re: RFQ-2611-002 steel', 'received_at', '2026-11-10T09:00:00+08', 'snippet', 'Please find our quote', 'attachments', '[{"name":"Q123.pdf"}]'),
    jsonb_build_object('message_id', '<r1@gamma>', 'from', 'Ann <ann@gammametal.com>', 'subject', 'dup'),
    jsonb_build_object('message_id', '<x9@other>', 'from', 'spam@nowhere.com', 'subject', 'Hello')))) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'sent') = '1' and (:'r'::jsonb ->> 'received') = '2' and (:'r'::jsonb ->> 'matched') = '1', 'job results stored (duplicate skipped, unmatched kept)');
select pg_temp.ok((select status from public.rfq_recipients where rfq_no = 'RFQ-2611-002' and supplier_id = 'SUP-0003') = 'Quoted', 'a reply never downgrades Quoted');
select pg_temp.ok((select emailed_at is not null from public.rfq_recipients where rfq_no = 'RFQ-2611-002' and supplier_id = 'SUP-0003') and (select user_name from public.rfq_clicks order by id desc limit 1) = 'Mailbox job', 'sent email recorded as a click by the mailbox job');
select pg_temp.ok((select value ->> 'matched' from public.settings where key = 'mailbox_status') = '1', 'job status stored');
set role authenticated;
select pg_temp.err($q$select public.crm_mjob_done('{}')$q$, 'permission denied', 'app users cannot call the job functions');
reset role;
set role service_role;
select pg_temp.ok((public.crm_mjob_pending() ->> 'enabled')::boolean, 'the service key may run the job');
reset role;
select set_config('request.uid', '00000000-0000-0000-0000-000000000001', false);

-- grants and row-level security as the app's database role
set role authenticated;
select pg_temp.ok((select count(*) from public.suppliers) = 3, 'authenticated reads suppliers through RLS');
select pg_temp.ok((select count(*) from public.rfqs) = 3, 'authenticated reads RFQs through RLS');
select pg_temp.ok((select count(*) from public.mail_outbox) = 1 and (select count(*) from public.rate_proposals) = 1, 'authenticated reads the new tables');
select pg_temp.ok(jsonb_array_length(public.crm_procdata() -> 'suppliers') = 3, 'authenticated may call crm_procdata');
select pg_temp.err($q$insert into public.suppliers (supplier_id, name, country) values ('SUP-9999', 'x', 'BN')$q$, 'permission denied', 'no direct writes');
select pg_temp.err($q$select public.crm_supwrite(null, '{}', '[]', '[]', '{}', null)$q$, 'permission denied', 'internal functions not callable');
reset role;
select set_config('request.uid', '', false);
set role authenticated;
select pg_temp.ok((select count(*) from public.suppliers) = 0, 'not signed in: RLS shows nothing');
reset role;
\echo 'test/db/t_proc.sql: all checks passed'
