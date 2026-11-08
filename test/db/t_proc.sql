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

-- grants and row-level security as the app's database role
set role authenticated;
select pg_temp.ok((select count(*) from public.suppliers) = 3, 'authenticated reads suppliers through RLS');
select pg_temp.ok(jsonb_array_length(public.crm_procdata() -> 'suppliers') = 3, 'authenticated may call crm_procdata');
select pg_temp.err($q$insert into public.suppliers (supplier_id, name, country) values ('SUP-9999', 'x', 'BN')$q$, 'permission denied', 'no direct writes');
select pg_temp.err($q$select public.crm_supwrite(null, '{}', '[]', '[]', '{}', null)$q$, 'permission denied', 'internal functions not callable');
reset role;
select set_config('request.uid', '', false);
set role authenticated;
select pg_temp.ok((select count(*) from public.suppliers) = 0, 'not signed in: RLS shows nothing');
reset role;
\echo 'test/db/t_proc.sql: all checks passed'
