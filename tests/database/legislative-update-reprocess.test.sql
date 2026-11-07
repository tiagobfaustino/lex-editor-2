\set ON_ERROR_STOP on

-- Upgrading old in-flight work preserves its existing events and claim.
do $upgrade$
declare v_request_id uuid; v_update_id uuid; v_digest text;
begin
  select update_id, event_digest into v_update_id, v_digest from public.test_reprocess_upgrade;
  if (select md5(jsonb_agg(jsonb_build_object(
    'eventId', event_id, 'type', event_type, 'actor', actor_user_id,
    'detail', detail_code, 'at', occurred_at) order by event_id)::text)
    from private.legislative_update_events where update_id = v_update_id) <> v_digest then
    raise exception 'migration rewrote existing audit events';
  end if;
  select reprocess_request_id into v_request_id from public.updates_legislativos where id = v_update_id;
  perform private.request_legislative_update_reprocess(v_update_id,
    '44444444-4444-4444-8444-444444444444');
  if private.claim_legislative_update_reprocess_requests(20) <> '[]'::jsonb then
    raise exception 'migration re-executed an existing claim';
  end if;
  if private.complete_legislative_update_reprocess(v_update_id, v_request_id, 'completed', null) <>
    '{"recorded":true}'::jsonb then raise exception 'adopted claim could not complete'; end if;
end
$upgrade$;

-- Every request has one requested/claimed/terminal chain on the update correlation.
create table public.test_reprocess_state (name text primary key, value jsonb not null);
insert into public.test_reprocess_state values ('ids', (
  select jsonb_build_object('updateId', id, 'lawId', lei_id, 'baseVersionId', base_versao_id) from public.updates_legislativos
  where detection_key = repeat('2', 64)
));
grant select, insert on public.test_reprocess_state to update_worker_test, update_editor_test;
grant select on public.test_reprocess_state to audit_reader_test;

set session authorization update_editor_test;
insert into public.test_reprocess_state
select 'first_request', private.request_legislative_update_reprocess(
  (value ->> 'updateId')::uuid, '44444444-4444-4444-8444-444444444444',
  'dddddddd-1111-4111-8111-111111111111') from public.test_reprocess_state where name = 'ids';
insert into public.test_reprocess_state
select 'first_retry', private.request_legislative_update_reprocess(
  (value ->> 'updateId')::uuid, '44444444-4444-4444-8444-444444444444',
  'dddddddd-1111-4111-8111-111111111111') from public.test_reprocess_state where name = 'ids';
do $active_conflict$
begin
  begin
    perform private.request_legislative_update_reprocess(
      (select (value ->> 'updateId')::uuid from public.test_reprocess_state where name = 'ids'),
      '44444444-4444-4444-8444-444444444444', 'dddddddd-2222-4222-8222-222222222222');
    raise exception 'in-flight attempt was replaced';
  exception when object_not_in_prerequisite_state then null; end;
end
$active_conflict$;
reset session authorization;

set session authorization update_worker_test;
do $unclaimed$
begin
  if private.complete_legislative_update_reprocess(
    (select (value ->> 'updateId')::uuid from public.test_reprocess_state where name = 'ids'),
    'dddddddd-1111-4111-8111-111111111111', 'failed', 'SOURCE_TIMEOUT') <> '{"recorded":false}'::jsonb then
    raise exception 'unclaimed request was completed';
  end if;
end
$unclaimed$;
insert into public.test_reprocess_state values ('first_claim', private.claim_legislative_update_reprocess_requests(20));
insert into public.test_reprocess_state
select 'first_job', private.materialize_legislative_update_reprocess_job(
  (value ->> 'updateId')::uuid, (value ->> 'lawId')::uuid,
  'dddddddd-1111-4111-8111-111111111111') from public.test_reprocess_state where name = 'ids';
-- Failed pipeline may itself record another error and clear the old timestamp fields.
-- The request registry still proves which worker claim is being completed.
select private.record_legislative_update_error(jsonb_build_object(
  'lawId', '33333333-3333-4333-8333-333333333333',
  'baseVersionId', (select value ->> 'baseVersionId' from public.test_reprocess_state where name = 'ids'),
  'baseNormativeSha256', repeat('a', 64), 'failureKey', repeat('2', 64),
  'sourceUrl', 'https://example.invalid/lei', 'errorCode', 'SOURCE_TIMEOUT',
  'occurredAt', '2026-10-08T12:00:00.000Z'));
insert into public.test_reprocess_state
select 'first_terminal', private.complete_legislative_update_reprocess(
  (value ->> 'updateId')::uuid, 'dddddddd-1111-4111-8111-111111111111',
  'failed', 'SOURCE_TIMEOUT') from public.test_reprocess_state where name = 'ids';
reset session authorization;

set session authorization update_editor_test;
insert into public.test_reprocess_state
select 'finished_retry', private.request_legislative_update_reprocess(
  (value ->> 'updateId')::uuid, '44444444-4444-4444-8444-444444444444',
  'dddddddd-1111-4111-8111-111111111111') from public.test_reprocess_state where name = 'ids';
reset session authorization;
set session authorization update_worker_test;
do $finished_retry$
begin
  if private.claim_legislative_update_reprocess_requests(20) <> '[]'::jsonb then
    raise exception 'retry after terminal created a new execution';
  end if;
end
$finished_retry$;
reset session authorization;
set session authorization update_editor_test;
insert into public.test_reprocess_state
select 'second_request', private.request_legislative_update_reprocess(
  (value ->> 'updateId')::uuid, '44444444-4444-4444-8444-444444444444',
  'dddddddd-2222-4222-8222-222222222222') from public.test_reprocess_state where name = 'ids';
reset session authorization;
set session authorization update_worker_test;
insert into public.test_reprocess_state values ('second_claim', private.claim_legislative_update_reprocess_requests(20));
do $stale$
begin
  if private.complete_legislative_update_reprocess(
    (select (value ->> 'updateId')::uuid from public.test_reprocess_state where name = 'ids'),
    'dddddddd-1111-4111-8111-111111111111', 'completed', null) <> '{"recorded":false}'::jsonb then
    raise exception 'late completion cleared the new claim';
  end if;
  begin
    perform private.materialize_legislative_update_reprocess_job(
      (select (value ->> 'updateId')::uuid from public.test_reprocess_state where name = 'ids'),
      '33333333-3333-4333-8333-333333333333', 'dddddddd-1111-4111-8111-111111111111');
    raise exception 'stale request materialized the new job';
  exception when object_not_in_prerequisite_state then null; end;
end
$stale$;
insert into public.test_reprocess_state
select 'second_job', private.materialize_legislative_update_reprocess_job(
  (value ->> 'updateId')::uuid, (value ->> 'lawId')::uuid,
  'dddddddd-2222-4222-8222-222222222222') from public.test_reprocess_state where name = 'ids';
insert into public.test_reprocess_state
select 'second_terminal', private.complete_legislative_update_reprocess(
  (value ->> 'updateId')::uuid, 'dddddddd-2222-4222-8222-222222222222',
  'completed', null) from public.test_reprocess_state where name = 'ids';
do $duplicate_terminal$
begin
  if private.complete_legislative_update_reprocess(
    (select (value ->> 'updateId')::uuid from public.test_reprocess_state where name = 'ids'),
    'dddddddd-2222-4222-8222-222222222222', 'failed', 'SOURCE_TIMEOUT') <> '{"recorded":false}'::jsonb then
    raise exception 'duplicate terminal was recorded';
  end if;
end
$duplicate_terminal$;
reset session authorization;

do $proof$
declare v_update_id uuid;
begin
  select (value ->> 'updateId')::uuid into v_update_id from public.test_reprocess_state where name = 'ids';
  if (select value from public.test_reprocess_state where name = 'first_request') <>
    (select value from public.test_reprocess_state where name = 'first_retry')
    or (select value from public.test_reprocess_state where name = 'first_request') <>
    (select value from public.test_reprocess_state where name = 'finished_retry') then
    raise exception 'same request retry changed its decision';
  end if;
  if exists (select 1 from public.test_reprocess_state where name in ('first_terminal', 'second_terminal')
    and value <> '{"recorded":true}'::jsonb) then raise exception 'new attempt lost its terminal'; end if;
  if exists (select 1 from public.test_reprocess_state where name in ('first_claim', 'second_claim')
    and jsonb_array_length(value) <> 1) then raise exception 'request claim duplicated or missing'; end if;
  if (select value -> 0 ->> 'requestId' from public.test_reprocess_state where name = 'first_claim') <>
    'dddddddd-1111-4111-8111-111111111111' or
    (select value -> 0 ->> 'requestId' from public.test_reprocess_state where name = 'second_claim') <>
    'dddddddd-2222-4222-8222-222222222222' then raise exception 'claim lost request identity'; end if;
  if (select value ->> 'idempotencyKey' from public.test_reprocess_state where name = 'first_job') =
    (select value ->> 'idempotencyKey' from public.test_reprocess_state where name = 'second_job') then
    raise exception 'distinct requests materialized the same job identity'; end if;
  if (select count(*) from private.legislative_update_events where update_id = v_update_id
    and reprocess_request_id is not null) <> 6 then raise exception 'request event chain is not append-only and singular'; end if;
  if (select count(*) from private.legislative_update_events where update_id = v_update_id
    and event_type = 'reprocess_failed') <> 1 or
    (select count(*) from private.legislative_update_events where update_id = v_update_id
    and event_type = 'reprocess_completed') <> 1 then raise exception 'two attempts were not both audited'; end if;
  if exists (select 1 from public.updates_legislativos where id = v_update_id
    and (reprocess_requested_at is not null or reprocess_claimed_at is not null or publication_id is not null)) then
    raise exception 'terminal left an active claim or published content'; end if;
  if pg_catalog.has_table_privilege('lex_update_worker', 'private.legislative_update_reprocess_requests', 'UPDATE')
    or pg_catalog.has_function_privilege('lex_update_worker', 'private.complete_legislative_update_reprocess(uuid,text,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', 'private.complete_legislative_update_reprocess(uuid,uuid,text,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('lex_update_editor', 'private.complete_legislative_update_reprocess(uuid,uuid,text,text)', 'EXECUTE') then
    raise exception 'unsafe reprocess authority was granted'; end if;
end
$proof$;

set session authorization audit_reader_test;
do $audit_projection$
declare v_update_id uuid;
begin
  select (value ->> 'updateId')::uuid into v_update_id from public.test_reprocess_state where name = 'ids';
  if (select count(*) from private.list_legislative_update_audit_events(
    'aaaaaaaa-0000-4000-8000-000000000001', null, pg_catalog.now(), 200)
    where correlation_id = v_update_id and event_code = 'legislative_update_reprocess_failed'
      and event_level = 'error') <> 1 or
    (select count(*) from private.list_legislative_update_audit_events(
    'aaaaaaaa-0000-4000-8000-000000000001', null, pg_catalog.now(), 200)
    where correlation_id = v_update_id and event_code = 'legislative_update_reprocess_completed'
      and event_level = 'info') <> 1 then
    raise exception 'terminal projection lost an attempt or reported the wrong level';
  end if;
end
$audit_projection$;
reset session authorization;
