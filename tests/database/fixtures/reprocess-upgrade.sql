-- Seed old terminal and in-flight work before the corrective migration.
create table public.test_reprocess_upgrade (update_id uuid, event_digest text);
set session authorization update_worker_test;
select (private.record_legislative_update_error(jsonb_build_object(
  'lawId', '33333333-3333-4333-8333-333333333333',
  'baseVersionId', (select value -> 'baseVersionId' from public.test_update_payloads where name = 'first'),
  'baseNormativeSha256', repeat('a', 64), 'failureKey', repeat('3', 64),
  'sourceUrl', 'https://example.invalid/lei', 'errorCode', 'SOURCE_TIMEOUT',
  'occurredAt', '2026-10-08T12:00:00.000Z')) ->> 'updateId') as update_id \gset upgrade_
reset session authorization;
set session authorization update_editor_test;
select private.request_legislative_update_reprocess(:'upgrade_update_id'::uuid,
  '44444444-4444-4444-8444-444444444444');
reset session authorization;
set session authorization update_worker_test;
select private.claim_legislative_update_reprocess_requests(20);
select private.complete_legislative_update_reprocess(:'upgrade_update_id'::uuid, 'failed', 'SOURCE_TIMEOUT');
reset session authorization;
set session authorization update_editor_test;
select private.request_legislative_update_reprocess(:'upgrade_update_id'::uuid,
  '44444444-4444-4444-8444-444444444444');
reset session authorization;
set session authorization update_worker_test;
select private.claim_legislative_update_reprocess_requests(20);
reset session authorization;
insert into public.test_reprocess_upgrade
select :'upgrade_update_id'::uuid, md5(jsonb_agg(jsonb_build_object(
  'eventId', event_id, 'type', event_type, 'actor', actor_user_id,
  'detail', detail_code, 'at', occurred_at) order by event_id)::text)
from private.legislative_update_events where update_id = :'upgrade_update_id'::uuid;
