-- v4.1.0 Projects register: auto-create on Won, P-series, statuses (automatic and by hand), header, money, team, visibility per role.
-- Runs after t_roles.sql on the same database (users 1 admin, 2 qs, 3 viewer, 4 pm, 5 site, 6 proc; pm and site on T902). Synthetic data only.
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
create or replace function pg_temp.d(n int) returns text language sql as $$ select (public.crm_today() + n)::text $$;
create or replace function pg_temp.pj(no text) returns jsonb language sql as $$ select public.crm_project(jsonb_build_object('arza_no', no)) -> 'project' $$;

-- matrix
select pg_temp.ok(public.crm_can('pm', 'project', 'manage') and not public.crm_can('pm', 'project', 'create') and public.crm_can('qs', 'project', 'create')
  and not public.crm_can('site', 'project', 'manage') and not public.crm_can('viewer', 'project', 'manage') and public.crm_can('admin', 'project', 'create'), 'matrix: create = qs/admin, manage = qs/pm/admin');
select pg_temp.ok(public.crm_next_pno() = 'P01' and public.crm_actor() = 'system', 'next P-number and actor helpers');

-- a won tender becomes a project (crm_result and crm_save)
select pg_temp.as_user(2);
select public.crm_result('{"arza_no":"T903","result":{"status":"Won","result_date":"2026-11-01"}}') as r \gset
select pg_temp.ok(exists (select 1 from public.projects where arza_no = 'T903' and status = 'For implementation' and ptype = 'Project' and loa_date = '2026-11-01'), 'Won result creates the project (For implementation, LOA = result date)');
select pg_temp.ok((:'r'::jsonb -> '_log') @> '[{"action":"project"}]', 'project creation is logged');
select public.crm_result('{"arza_no":"T903","result":{"status":"Won"}}');
select pg_temp.ok((select count(*) from public.project_status_log where arza_no = 'T903') = 1, 'setting Won again does not make a second project');
select public.crm_save('{"arza_no":"T904","fields":{"status":"Won"}}');
select pg_temp.ok(exists (select 1 from public.projects where arza_no = 'T904'), 'status Won saved on the tender creates the project too');
select public.crm_save('{"arza_no":"T904","fields":{"status":"Submitted"}}');
select pg_temp.ok(exists (select 1 from public.projects where arza_no = 'T904'), 'setting the tender back from Won keeps the project');
select public.crm_ensure_project('T904');
select pg_temp.ok((select count(*) from public.projects where arza_no = 'T904') = 1, 'crm_ensure_project is idempotent');

-- add by hand: P-series
select pg_temp.err($q$select public.crm_addproject('{"ptype":"Project","fields":{"title":"x","client":"MOE"}}')$q$, 'Enter the project title', 'title required');
select pg_temp.err($q$select public.crm_addproject('{"ptype":"Job","fields":{"title":"MOE Block D renovation","client":"MOE"}}')$q$, 'Project or Term contract', 'type checked');
select pg_temp.err($q$select public.crm_addproject('{"ptype":"Project","fields":{"title":"MOE Block D renovation","client":"MOE","commencement_date":"2026-12-01","completion_due":"2026-11-01"}}')$q$, 'before the commencement', 'dates checked');
select public.crm_addproject('{"ptype":"Project","contract_sum":"1,250,000.50","fields":{"title":"MOE Block D renovation","client":"MOE","client_group":"MOE","contract_no":"MOE/LTK/79/2024","loa_date":"2026-10-01","commencement_date":"2030-01-01","completion_due":"2030-12-31","dlp_months":"12"}}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'arza_no') = 'P01' and (:'r'::jsonb ->> 'status') = 'For implementation' and (:'r'::jsonb ->> 'origin') = 'Existing contract'
  and (:'r'::jsonb #>> '{money,contract_sum}')::numeric = 1250000.50, 'existing project gets P01, For implementation, contract sum');
select pg_temp.ok((select status = 'Won' and tender_type is null and result_source ~ 'direct award' from public.tenders where arza_no = 'P01'), 'P01 is a Won tender record (existing contract / direct award)');
select public.crm_addproject('{"ptype":"Term contract","fields":{"title":"MOE housing estates maintenance (3 years)","client":"MOE","contract_no":"JPPE-OGOS-2022","commencement_date":"2025-01-01","completion_due":"2027-12-31"}}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'arza_no') = 'P02' and (:'r'::jsonb ->> 'ptype') = 'Term contract' and (:'r'::jsonb ->> 'status') = 'Ongoing'
  and (select tender_type from public.tenders where arza_no = 'P02') = 'Term contract', 'term contract gets P02; commencement passed -> Ongoing at once');
select pg_temp.ok(exists (select 1 from public.project_status_log where arza_no = 'P02' and to_status = 'Ongoing' and note ~ 'Automatic'), 'the automatic change is in the status history');
select pg_temp.err($q$select public.crm_addproject('{"ptype":"Project","fields":{"title":"Copy of block D","client":"MOE","contract_no":"moe/ltk/79/2024"}}')$q$, 'already in the system', 'duplicate contract no. refused');
select pg_temp.as_user(4);
select pg_temp.err($q$select public.crm_addproject('{"ptype":"Project","fields":{"title":"PM job","client":"MOE"}}')$q$, 'Not allowed: Project manager', 'pm cannot add projects');
select pg_temp.ok((select count(*) from public.activity_log where arza_no = 'P01') >= 1 and public.crm_log_ok('pm', 'P01'), 'P-project log lines are visible to pm');

-- visibility
select pg_temp.ok(jsonb_array_length(public.crm_projects() -> 'projects') = (select count(*) from public.projects) and (public.crm_projects() #> '{projects,0,money}') is not null
  and not (public.crm_projects() ->> 'can_create')::boolean, 'pm: every project, with amounts; cannot add');
select pg_temp.as_user(5);
select pg_temp.ok(jsonb_array_length(public.crm_projects() -> 'projects') = 1 and (public.crm_projects() #>> '{projects,0,arza_no}') = 'T902'
  and jsonb_typeof(public.crm_projects() #> '{projects,0,money}') = 'null', 'site: only his project, no amounts');
select pg_temp.ok(jsonb_typeof(pg_temp.pj('T902') -> 'money') = 'null' and not (public.crm_project('{"arza_no":"T902"}') ->> 'can_manage')::boolean
  and public.crm_project('{"arza_no":"T902"}') -> 'users' = '[]'::jsonb, 'site: project page without amounts, no team editing');
select pg_temp.err($q$select public.crm_project('{"arza_no":"P01"}')$q$, 'not on project P01', 'site cannot open another project');
select pg_temp.err($q$select public.crm_saveproject('{"arza_no":"T902","fields":{"notes":"x"}}')$q$, 'Project engineer accounts cannot change the project details', 'site cannot change the header');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"Ongoing"}')$q$, 'cannot change the project status', 'site cannot change the status');
select pg_temp.as_user(6);
select pg_temp.err($q$select public.crm_projects()$q$, 'No access: Procurement', 'proc has no Projects');
select pg_temp.as_user(3);
select pg_temp.ok((pg_temp.pj('P01') #>> '{money,contract_sum}')::numeric = 1250000.50, 'Management sees project amounts');
select pg_temp.err($q$select public.crm_saveproject('{"arza_no":"P01","fields":{"notes":"x"}}')$q$, 'Read-only', 'Management cannot change projects');

-- header (pm on his project only)
select pg_temp.as_user(4);
select public.crm_saveproject(jsonb_build_object('arza_no', 'T902', 'fields', jsonb_build_object('contract_no', 'JKR/DBSBM011/2025', 'commencement_date', pg_temp.d(30),
  'completion_due', pg_temp.d(395), 'eot_days', '14', 'dlp_months', '12', 'client_rep', 'Ir. Client'), 'money', '{"lad_rate":"850","retention_pct":"10","retention_limit_pct":"5"}'::jsonb)) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'contract_no') = 'JKR/DBSBM011/2025' and (:'r'::jsonb ->> 'eot_days')::int = 14 and (:'r'::jsonb ->> 'revised_due') = pg_temp.d(409)
  and (:'r'::jsonb ->> 'days_left')::int = 409 and (:'r'::jsonb #>> '{money,lad_rate}')::numeric = 850, 'pm updates his project header and amounts (revised due = due + EOT)');
select pg_temp.err($q$select public.crm_saveproject('{"arza_no":"T903","fields":{"notes":"x"}}')$q$, 'only the team on project T903', 'pm cannot change a project he is not on');
select pg_temp.err($q$select public.crm_saveproject('{"arza_no":"T902","fields":{"commencement_date":"2027-01-01","completion_due":"2026-01-01"}}')$q$, 'before the commencement', 'completion before commencement refused');
select pg_temp.err($q$select public.crm_saveproject('{"arza_no":"T902","money":{"retention_pct":"150"}}')$q$, 'percentage', 'retention % checked');
select public.crm_saveproject('{"arza_no":"T902","fields":{"title":"Renamed"}}');
select pg_temp.ok((select title from public.tenders where arza_no = 'T902') <> 'Renamed', 'the title of a tender project is not changed from Projects');

-- statuses
select public.crm_saveproject(jsonb_build_object('arza_no', 'T902', 'fields', jsonb_build_object('commencement_date', pg_temp.d(-20))));
select pg_temp.ok((pg_temp.pj('T902') ->> 'status') = 'Ongoing', 'commencement date reached -> Ongoing automatically');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"On hold","note":"site closed"}')$q$, 'reason for the hold', 'hold needs a reason');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"On hold","reason":"Payment"}')$q$, 'short note', 'hold needs a note');
select pg_temp.err(format($q$select public.crm_projectstatus('{"arza_no":"T902","to":"On hold","reason":"Payment","note":"no payment","date":"%s"}')$q$, pg_temp.d(5)), 'future', 'hold date not in the future');
select public.crm_projectstatus(jsonb_build_object('arza_no', 'T902', 'to', 'On hold', 'reason', 'Client instruction', 'note', 'Client stopped works pending redesign', 'date', pg_temp.d(-10))) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'On hold' and (:'r'::jsonb ->> 'hold_reason') = 'Client instruction' and (:'r'::jsonb ->> 'hold_days_total')::int = 10, 'on hold with reason, note and date; hold days counting');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"On hold","reason":"Payment","note":"again on hold"}')$q$, 'already On hold', 'cannot hold twice');
select public.crm_projectstatus('{"arza_no":"T902","to":"Ongoing","note":"Redesign issued"}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'Ongoing' and (:'r'::jsonb ->> 'hold_days')::int = 10 and (:'r'::jsonb ->> 'hold_since') is null, 'resume: 10 hold days logged (EOT evidence)');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"Archived"}')$q$, 'Archived is automatic', 'Archived cannot be set by hand');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"Completed"}')$q$, 'actual completion date', 'completion needs the date');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"final_paid"}')$q$, 'after the project is completed', 'final payment only after completion');
select public.crm_projectstatus(jsonb_build_object('arza_no', 'T902', 'to', 'Completed', 'date', pg_temp.d(-400))) as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'Completed' and (:'r'::jsonb ->> 'dlp_end') = ((public.crm_today() - 400) + interval '12 months')::date::text, 'completed: warranty end = completion + 12 months');
select pg_temp.ok((pg_temp.pj('T902') ->> 'status') = 'Completed', 'warranty ended but no final payment -> stays Completed');
select pg_temp.as_user(5);
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"final_paid"}')$q$, 'cannot change the project status', 'site cannot record payments');
select pg_temp.as_user(4);
select public.crm_projectstatus('{"arza_no":"T902","to":"final_paid","note":"retention released"}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'Archived' and (:'r'::jsonb ->> 'final_paid_on') = public.crm_today()::text, 'final payment + warranty ended -> Archived automatically');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T902","to":"restore"}')$q$, 'Only the admin can restore', 'pm cannot restore');
select pg_temp.as_user(2);
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T903","to":"Cancelled","note":"client withdrew"}')$q$, 'Only the admin can cancel', 'qs cannot cancel');
select pg_temp.as_user(1);
select public.crm_projectstatus('{"arza_no":"T902","to":"restore","note":"retention disputed"}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'Completed' and (:'r'::jsonb ->> 'final_paid_on') is null, 'admin restores an archived project (final payment cleared)');
select pg_temp.err($q$select public.crm_projectstatus('{"arza_no":"T903","to":"Cancelled"}')$q$, 'reason for cancelling', 'cancel needs a reason');
select public.crm_projectstatus('{"arza_no":"T903","to":"Cancelled","note":"Client withdrew the award"}') as r \gset
select pg_temp.ok((:'r'::jsonb ->> 'status') = 'Cancelled', 'admin cancels with a reason');
select pg_temp.ok(jsonb_array_length(public.crm_project('{"arza_no":"T902"}') -> 'log') >= 7, 'status history kept');

-- team
select pg_temp.as_user(4);
select pg_temp.err($q$select public.crm_setteam('{"arza_no":"T902","members":[{"user_id":"00000000-0000-0000-0000-000000000005","proj_role":"engineer"}]}')$q$, 'cannot remove yourself', 'pm cannot remove himself');
select pg_temp.err($q$select public.crm_setteam('{"arza_no":"T902","members":[{"user_id":"00000000-0000-0000-0000-000000000004","proj_role":"pm"},{"user_id":"00000000-0000-0000-0000-000000000006","proj_role":"engineer"}]}')$q$, 'Procurement accounts have no project access', 'Procurement cannot join a team');
select pg_temp.err($q$select public.crm_setteam('{"arza_no":"P01","members":[{"user_id":"00000000-0000-0000-0000-000000000004","proj_role":"pm"}]}')$q$, 'only the team on project P01', 'pm cannot set the team of another project');
select public.crm_setteam('{"arza_no":"T902","members":[{"user_id":"00000000-0000-0000-0000-000000000004","proj_role":"pm"},{"user_id":"00000000-0000-0000-0000-000000000005","proj_role":"engineer"},{"user_id":"00000000-0000-0000-0000-000000000002","proj_role":"qs"}]}') as r \gset
select pg_temp.ok(jsonb_array_length(:'r'::jsonb -> 'members') = 3 and (:'r'::jsonb #>> '{members,0,proj_role}') = 'pm', 'pm sets his team (pm first)');
select pg_temp.as_user(2);
select public.crm_setteam('{"arza_no":"P01","members":[{"user_id":"00000000-0000-0000-0000-000000000005","proj_role":"engineer"}]}');
select pg_temp.ok(jsonb_array_length(public.crm_project('{"arza_no":"P01"}') -> 'users') >= 5 and not (public.crm_project('{"arza_no":"P01"}') -> 'users') @> '[{"role":"proc"}]', 'qs sets any team; the user list leaves out Procurement');
select pg_temp.as_user(5);
select pg_temp.ok(jsonb_array_length(public.crm_projects() -> 'projects') = 2, 'site now sees both his projects');

-- row-level security
set role authenticated;
select pg_temp.ok((select count(*) from public.projects) = 2 and (select count(*) from public.project_money) = 0 and (select count(*) from public.project_status_log where arza_no = 'P01') >= 1, 'RLS site: own projects, no amounts');
reset role;
select pg_temp.as_user(4);
set role authenticated;
select pg_temp.ok((select count(*) from public.projects) >= 7 and (select count(*) from public.project_money) >= 1, 'RLS pm: every project and the amounts');
reset role;
select pg_temp.as_user(6);
set role authenticated;
select pg_temp.ok((select count(*) from public.projects) = 0 and (select count(*) from public.project_status_log) = 0, 'RLS proc: no projects');
reset role;
select set_config('request.uid', '', false);
\echo 'test/db/t_projects.sql: all checks passed'
