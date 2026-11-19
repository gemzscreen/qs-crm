-- v4.0.0 roles: the permission matrix, per-role reads and writes through the crm_* functions, row-level security per area,
-- project membership helpers. Runs after t_proc.sql on the same database (uses its tenders T901-T908, suppliers and RFQs). Synthetic data only.
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
create or replace function pg_temp.as_user(n int) returns void language sql as
$$ select set_config('request.uid', '00000000-0000-0000-0000-00000000000' || n, false) $$;

-- the matrix itself
select pg_temp.ok(public.crm_can('admin', 'rfq', 'manage') and public.crm_can('qs', 'project', 'writeall') and not public.crm_can('qs', 'users', 'write'), 'admin everything, qs all but users');
select pg_temp.ok(public.crm_can('viewer', 'perf', 'verify') and public.crm_can('viewer', 'rates', 'read') and not public.crm_can('viewer', 'tender', 'write'), 'Management reads all, verifies, no writes');
select pg_temp.ok(public.crm_can('pm', 'tender', 'read') and not public.crm_can('pm', 'rfq', 'read') and not public.crm_can('pm', 'rates', 'read') and not public.crm_can('pm', 'perf', 'read'), 'Project manager: no RFQ group, no QS Performance');
select pg_temp.ok(public.crm_can('pm', 'project', 'write') and not public.crm_can('pm', 'project', 'writeall') and public.crm_can('pm', 'project', 'readall'), 'Project manager reads all projects, writes assigned ones');
select pg_temp.ok(not exists (select 1 from public.crm_perms() where role = 'site' and (area <> 'project' and area <> 'dash' or action in ('money', 'readall', 'writeall'))), 'Project engineer: own projects only, no money');
select pg_temp.ok((select jsonb_agg(x order by x) from jsonb_array_elements_text(public.crm_perms_of('proc')) x) = '["rfq.award", "rfq.read", "rfq.write"]', 'Procurement: RFQ read, write, award only');
select pg_temp.ok(public.crm_role_label('proc') = 'Procurement' and public.crm_role_label('site') = 'Project engineer' and public.crm_area_label('rfq') = 'RFQs and suppliers', 'role and area labels');
select pg_temp.ok(public.crm_log_ok('pm', 'T901') and public.crm_log_ok('pm', 'P01') and not public.crm_log_ok('pm', 'RFQ-2611-003') and not public.crm_log_ok('site', 'T901') and public.crm_log_ok('viewer', 'SUP-0001'), 'activity-log lines per role');

-- users: pm (4), site (5), proc (6); the admin sets the roles
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000004', 'pm@test', '{"full_name":"Pm Person"}'),
  ('00000000-0000-0000-0000-000000000005', 'site@test', '{"full_name":"Site Person"}'),
  ('00000000-0000-0000-0000-000000000006', 'proc@test', '{"full_name":"Proc Person"}');
select pg_temp.as_user(1);
select public.crm_setuser('{"id":"00000000-0000-0000-0000-000000000004","role":"pm"}');
select public.crm_setuser('{"id":"00000000-0000-0000-0000-000000000005","role":"site"}');
select public.crm_setuser('{"id":"00000000-0000-0000-0000-000000000006","role":"proc"}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'role') = 'proc', 'admin sets the new Procurement role');
select pg_temp.err($q$select public.crm_setuser('{"id":"00000000-0000-0000-0000-000000000006","role":"boss"}')$q$, 'Unknown role', 'unknown role refused');
select pg_temp.as_user(2);
select pg_temp.err($q$select public.crm_setuser('{"id":"00000000-0000-0000-0000-000000000006","role":"qs"}')$q$, 'Only the admin', 'qs cannot change roles');
select pg_temp.ok((public.crm_me() -> 'perms') ? 'rfq.manage' and (public.crm_list() -> 'me' -> 'perms') ? 'tender.write', 'qs gets its matrix with crm_me / crm_list');

-- Project manager (4)
select pg_temp.as_user(4);
select pg_temp.ok((public.crm_me() ->> 'role') = 'pm' and not ((public.crm_me() -> 'perms') ? 'rfq.read'), 'pm: perms without the RFQ group');
select pg_temp.ok(jsonb_array_length(public.crm_list() -> 'tenders') = 8, 'pm reads the tenders');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.crm_list() -> 'log') l where coalesce(l ->> 'arza_no', '') !~ '^[TP]\d+$'), 'pm log: tender lines only');
select pg_temp.ok((public.crm_get('{"arza_no":"T901"}') #>> '{tender,arza_no}') = 'T901', 'pm opens a tender');
select pg_temp.ok((public.crm_library('{}') ->> 'total') is not null, 'pm opens the BQ Library');
select pg_temp.ok((public.crm_dashboard() -> 'kpi') ? 'tenders' and not ((public.crm_dashboard() -> 'kpi') ? 'value_to_verify') and not ((public.crm_dashboard() -> 'kpi') ? 'rfq_no_savings'), 'pm dashboard without value-log / savings counts');
select pg_temp.err($q$select public.crm_rfqs()$q$, 'No access: Project manager', 'pm cannot list RFQs');
select pg_temp.err($q$select public.crm_procdata()$q$, 'No access', 'pm cannot read suppliers');
select pg_temp.err($q$select public.crm_rfq('{"rfq_no":"RFQ-2611-003"}')$q$, 'No access', 'pm cannot open an RFQ');
select pg_temp.err($q$select public.crm_quoteprices()$q$, 'No access', 'pm cannot see quote prices');
select pg_temp.err($q$select public.crm_rateprops()$q$, 'No access', 'pm cannot see rate proposals');
select pg_temp.err($q$select public.crm_perf()$q$, 'No access', 'pm cannot open QS Performance');
select pg_temp.err($q$select public.crm_valuelog()$q$, 'No access', 'pm cannot read the value log');
select pg_temp.err($q$select public.crm_save('{"arza_no":"T901","fields":{"notes":"x"}}')$q$, 'Read-only account \(pm\)', 'pm cannot change a tender');
select pg_temp.ok((public.crm_settings() -> 'company') is not null, 'pm reads the letterhead settings');

-- Project engineer (5): nothing with money
select pg_temp.as_user(5);
select pg_temp.ok(public.crm_list() -> 'tenders' = '[]'::jsonb and public.crm_list() -> 'log' = '[]'::jsonb and (public.crm_list() -> 'lists') ? 'status', 'site: no tenders, no log, lists only');
select pg_temp.ok((public.crm_dashboard() ->> 'limited')::boolean and public.crm_dashboard() -> 'kpi' = '{}'::jsonb and public.crm_dashboard() -> 'won_projects' = '[]'::jsonb, 'site dashboard: no tender figures');
select pg_temp.err($q$select public.crm_get('{"arza_no":"T901"}')$q$, 'No access: Project engineer', 'site cannot open a tender');
select pg_temp.err($q$select public.crm_revdata('{"arza_no":"T902"}')$q$, 'No access', 'site cannot open the contract BQ');
select pg_temp.err($q$select public.crm_asbuiltdata('{"arza_no":"T902"}')$q$, 'No access', 'site cannot open as-built values');
select pg_temp.err($q$select public.crm_library('{}')$q$, 'No access', 'site cannot open the BQ Library');
select pg_temp.err($q$select public.crm_rfqs()$q$, 'No access', 'site cannot list RFQs');
select pg_temp.err($q$select public.crm_perf()$q$, 'No access', 'site cannot open QS Performance');
select pg_temp.err($q$select public.crm_verifyvalue('{"id":1}')$q$, 'Not allowed|Read-only', 'site cannot verify value-log entries');

-- Procurement (6): RFQ tab only; award with the boss's approval document
select pg_temp.as_user(6);
select pg_temp.ok(public.crm_list() -> 'tenders' = '[]'::jsonb, 'proc: no tenders');
select pg_temp.err($q$select public.crm_dashboard()$q$, 'No access: Procurement', 'proc has no Dashboard (lands on RFQs)');
select pg_temp.ok(jsonb_array_length(public.crm_rfqs() -> 'rfqs') = 3 and jsonb_array_length(public.crm_procdata() -> 'suppliers') = 3, 'proc reads RFQs and suppliers');
select pg_temp.ok((public.crm_queue() ? 'candidates') or public.crm_queue() is not null, 'proc opens the review queue');
select public.crm_savesupplier('{"fields":{"name":"Gamma Steel Trading","country":"BN","zone":1},"categories":[{"code":"CS"}],"keys":["name:gamma steel trading|BN"]}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{supplier,name}') = 'Gamma Steel Trading', 'proc adds a supplier');
select pg_temp.err($q$select public.crm_get('{"arza_no":"T901"}')$q$, 'No access', 'proc cannot open a tender');
select pg_temp.err($q$select public.crm_library('{}')$q$, 'No access', 'proc cannot open the BQ Library');
select pg_temp.err($q$select public.crm_rateprops()$q$, 'No access', 'proc cannot see rate proposals');
select pg_temp.err($q$select public.crm_perf()$q$, 'No access', 'proc cannot open QS Performance');
select pg_temp.err($q$select public.crm_setfx('{"fx":{"USD":"1.40"}}')$q$, 'Read-only|Not allowed', 'proc cannot change exchange rates');
select pg_temp.err($q$select public.crm_setjson('{"key":"scoring","value":{"price":"100","lead":"0","payment":"0","reliability":"0"}}')$q$, 'Read-only|Not allowed', 'proc cannot change scoring weights');
select pg_temp.err($q$select public.crm_ratedecide('{"id":1,"decision":"Accepted"}')$q$, 'Read-only|No access', 'proc cannot accept rate proposals');
select pg_temp.err($q$select public.crm_save('{"fields":{"title":"x"}}')$q$, 'Read-only|No access', 'proc cannot add a tender');
-- reopen is QS / admin only
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"reopen"}')$q$, 'Not allowed: Procurement', 'proc cannot reopen an award');
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"savings","total_bnd":"1","median_bnd":"1"}')$q$, 'Not allowed', 'proc cannot record savings');
select pg_temp.as_user(2);
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"reopen","note":"v4 test"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') <> 'Awarded', 'qs reopens the award');
select pg_temp.as_user(6);
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"award","supplier_id":"SUP-0001","award_by":"Boss"}')$q$, 'documented approval', 'proc award needs the approval document');
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"award","supplier_id":"SUP-0001","award_by":"Boss","award_doc":"javascript:alert(1)"}')$q$, 'web link', 'approval document link checked');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"award","supplier_id":"SUP-0001","award_by":"Boss","award_doc":"https://drive.google.com/file/d/approval1"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') = 'Awarded' and (:'r'::jsonb #>> '{rfq,award_doc}') = 'https://drive.google.com/file/d/approval1' and (:'r'::jsonb #>> '{rfq,award_by_role}') = 'proc'
  and (:'r'::jsonb #>> '{_log,0,detail}') ~ 'approval doc https://drive.google.com/file/d/approval1 \(recorded by Procurement\)', 'proc awards with the boss''s approval document (logged)');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"delivery","on_time":true,"quality":"4"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,delivery_quality}') = '4', 'proc records the delivery');
select pg_temp.as_user(2);
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"reopen","note":"v4 test"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,award_doc}') is null, 'reopen clears the approval document');
select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-003","action":"award","supplier_id":"SUP-0001","award_by":"Boss"}') as r \gset
select pg_temp.ok((:'r'::jsonb #>> '{rfq,status}') = 'Awarded', 'qs may still award without a document');

-- Management (3): reads all areas
select pg_temp.as_user(3);
select pg_temp.ok(jsonb_array_length(public.crm_rateprops() -> 'proposals') >= 0 and (public.crm_perf() ->> 'start_date') is not null and jsonb_array_length(public.crm_rfqs() -> 'rfqs') = 3, 'Management reads rates, QS Performance and RFQs');
select pg_temp.err($q$select public.crm_rfqdecide('{"rfq_no":"RFQ-2611-002","action":"must_pass","must_pass":{"complete":true}}')$q$, 'Read-only account \(viewer\)', 'Management cannot change RFQs');

-- project membership (v4.1 uses these): pm and site on T902
insert into public.projects (arza_no) values ('T901'), ('T902'), ('T905') on conflict do nothing;   -- v4.1: members hang on projects
insert into public.project_members (arza_no, user_id, proj_role) values ('T902', '00000000-0000-0000-0000-000000000004', 'pm'), ('T902', '00000000-0000-0000-0000-000000000005', 'engineer');
select pg_temp.as_user(4);
select pg_temp.ok(public.crm_project_ok('T902', 'write') and not public.crm_project_ok('T901', 'write') and public.crm_project_ok('T901', 'read') and public.crm_project_ok('T902', 'money'), 'pm: reads all projects, writes assigned, sees amounts');
select pg_temp.ok((public.crm_needproject('T902', 'write')).role = 'pm', 'pm may change an assigned project');
select pg_temp.err($q$select public.crm_needproject('T901', 'write')$q$, 'only the team on project T901', 'pm cannot change a project he is not on');
select pg_temp.as_user(5);
select pg_temp.ok(public.crm_project_ok('T902', 'read') and public.crm_project_ok('T902', 'write') and not public.crm_project_ok('T901', 'read') and not public.crm_project_ok('T902', 'money'), 'site: own project only, never money');
select pg_temp.err($q$select public.crm_needproject('T901', 'read')$q$, 'not on project T901', 'site cannot open another project');
select pg_temp.err($q$select public.crm_needproject('T902', 'money')$q$, 'Not allowed: Project engineer', 'site never gets project amounts');
select pg_temp.as_user(3);
select pg_temp.ok(public.crm_project_ok('T901', 'read') and public.crm_project_ok('T901', 'money') and not public.crm_project_ok('T902', 'write'), 'Management reads every project, changes none');
select pg_temp.as_user(6);
select pg_temp.ok(not public.crm_project_ok('T902', 'read'), 'proc has no projects');
select pg_temp.as_user(2);
select pg_temp.ok(public.crm_project_ok('T901', 'write') and (public.crm_needproject('T905', 'write')).role = 'qs', 'qs changes any project');

-- row-level security per area, as the app's database role (direct REST reads)
select pg_temp.as_user(4);
set role authenticated;
select pg_temp.ok((select count(*) from public.tenders) = 8 and (select count(*) from public.bq_items) >= 0, 'RLS pm: reads tenders');
select pg_temp.ok((select count(*) from public.suppliers) = 0 and (select count(*) from public.rfqs) = 0 and (select count(*) from public.quotes) = 0, 'RLS pm: no suppliers, RFQs or quotes');
select pg_temp.ok((select count(*) from public.rate_proposals) = 0 and (select count(*) from public.value_log) = 0, 'RLS pm: no rate proposals, no value log');
select pg_temp.ok((select count(*) from public.activity_log) > 0 and not exists (select 1 from public.activity_log where coalesce(arza_no, '') !~ '^[TP]\d+$'), 'RLS pm: tender log lines only');
select pg_temp.ok((select count(*) from public.project_members) = 2, 'RLS pm: sees the project teams');
reset role;
select pg_temp.as_user(5);
set role authenticated;
select pg_temp.ok((select count(*) from public.tenders) = 0 and (select count(*) from public.bq_items) = 0 and (select count(*) from public.revisions) = 0, 'RLS site: no tenders or BQ');
select pg_temp.ok((select count(*) from public.suppliers) = 0 and (select count(*) from public.value_log) = 0 and (select count(*) from public.activity_log) = 0, 'RLS site: no suppliers, value log or activity log');
select pg_temp.ok((select count(*) from public.project_members) = 1 and (select count(*) from public.lists) > 0, 'RLS site: own team row, shared lists');
reset role;
select pg_temp.as_user(6);
set role authenticated;
select pg_temp.ok((select count(*) from public.suppliers) = 4 and (select count(*) from public.rfqs) = 3 and (select count(*) from public.quotes) >= 2, 'RLS proc: reads suppliers, RFQs, quotes');
select pg_temp.ok((select count(*) from public.tenders) = 0 and (select count(*) from public.rate_proposals) = 0 and (select count(*) from public.value_log) = 0 and (select count(*) from public.activity_log) = 0, 'RLS proc: no tenders, rate proposals, value log, log');
reset role;
select pg_temp.as_user(3);
set role authenticated;
select pg_temp.ok((select count(*) from public.tenders) = 8 and (select count(*) from public.suppliers) = 4 and (select count(*) from public.value_log) = 1, 'RLS Management: reads everything');
select pg_temp.ok(public.crm_area_ok('perf', 'verify') and not public.crm_area_ok('tender', 'write'), 'crm_area_ok callable by signed-in users');
select pg_temp.err($q$select public.crm_needs('tender', 'read')$q$, 'permission denied', 'crm_needs is internal');
reset role;
select set_config('request.uid', '', false);
\echo 'test/db/t_roles.sql: all checks passed'
