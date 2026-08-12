\set ON_ERROR_STOP on

create role update_worker_test login;
create role update_editor_test login;
create role update_unauthorized_test login;
grant lex_update_worker to update_worker_test;
grant lex_update_editor to update_editor_test;

create table public.test_update_payloads (name text primary key, value jsonb not null);
insert into public.test_update_payloads (name, value)
select candidate.name, pg_catalog.jsonb_build_object(
  'lawId', law.id,
  'baseVersionId', law.versao_publicada_id,
  'baseNormativeSha256', pg_catalog.repeat('a', 64),
  'candidateNormativeSha256', pg_catalog.repeat(candidate.hash_character, 64),
  'detectionKey', pg_catalog.repeat(candidate.key_character, 64),
  'sourceUrl', law.fonte_url,
  'sourceArtifacts', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'sourceType', 'planalto_html', 'sourceRole', 'primary_current',
    'sourceVariant', 'compiled', 'sourceUrl', law.fonte_url,
    'artifactSha256', pg_catalog.repeat(candidate.hash_character, 64)
  )),
  'candidateArtifactId', candidate.artifact_id,
  'diff', pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'entries', '[]'::jsonb, 'missingPublished', '[]'::jsonb,
    'summary', pg_catalog.jsonb_build_object(
      'unchanged', 0, 'amended', candidate.amended, 'included', 0,
      'revoked', 0, 'renumbered', 0, 'missingPublished', 0
    ),
    'requiresHumanReview', true
  ),
  'overallConfidence', 'high', 'requiresHumanReview', true,
  'detectedAt', candidate.detected_at
)
from public.leis law
cross join (values
  ('first', 'b', 'c', '88888888-8888-4888-8888-888888888881'::uuid, 1, '2026-08-11T15:00:00.000Z'),
  ('second', 'd', 'e', '88888888-8888-4888-8888-888888888882'::uuid, 2, '2026-08-12T15:00:00.000Z'),
  ('third', 'f', '1', '88888888-8888-4888-8888-888888888883'::uuid, 3, '2026-08-13T15:00:00.000Z')
) candidate(name, hash_character, key_character, artifact_id, amended, detected_at)
where law.id = '33333333-3333-4333-8333-333333333333';
grant select on public.test_update_payloads to update_worker_test;
select versao_publicada_id as base_version_id
  from public.leis where id = '33333333-3333-4333-8333-333333333333' \gset

set session authorization update_worker_test;
select (private.enqueue_legislative_update(value) ->> 'updateId') as update_id
  from public.test_update_payloads where name = 'first' \gset first_
select private.enqueue_legislative_update(value)
  from public.test_update_payloads where name = 'first';
select (private.enqueue_legislative_update(value) ->> 'updateId') as update_id
  from public.test_update_payloads where name = 'second' \gset second_
reset session authorization;

set session authorization update_editor_test;
select private.list_legislative_updates(null, 100, null);
select private.get_legislative_update(:'second_update_id'::uuid);
select private.decide_legislative_update(
  :'second_update_id'::uuid, '44444444-4444-4444-8444-444444444444', 'rejected',
  'A fonte compilada divergiu da fonte auxiliar oficial.', null
);
reset session authorization;

-- A mesma candidata rejeitada não reaparece como nova pendência.
set session authorization update_worker_test;
select private.enqueue_legislative_update(value)
  from public.test_update_payloads where name = 'second';
select (private.enqueue_legislative_update(value) ->> 'updateId') as update_id
  from public.test_update_payloads where name = 'third' \gset third_
reset session authorization;

set session authorization update_editor_test;
select private.decide_legislative_update(
  :'third_update_id'::uuid, '44444444-4444-4444-8444-444444444444', 'approved', null,
  '99999999-9999-4999-8999-999999999999'
);
select private.count_legislative_updates();
reset session authorization;

set session authorization update_worker_test;
select private.record_legislative_update_error(pg_catalog.jsonb_build_object(
  'lawId', '33333333-3333-4333-8333-333333333333',
  'baseVersionId', :'base_version_id',
  'baseNormativeSha256', repeat('a', 64),
  'failureKey', repeat('2', 64),
  'sourceUrl', 'https://example.invalid/lei',
  'errorCode', 'SOURCE_TIMEOUT',
  'occurredAt', '2026-08-14T15:00:00.000Z'
));
reset session authorization;

do $assertions$
declare
  v_first public.updates_legislativos%rowtype;
  v_second public.updates_legislativos%rowtype;
  v_third public.updates_legislativos%rowtype;
begin
  select * into v_first from public.updates_legislativos where detection_key = repeat('c', 64);
  select * into v_second from public.updates_legislativos where detection_key = repeat('e', 64);
  select * into v_third from public.updates_legislativos where detection_key = repeat('1', 64);
  if v_first.detection_count <> 2 or v_first.update_review_status <> 'superseded' then
    raise exception 'identical detection was duplicated or not superseded correctly';
  end if;
  if v_second.detection_count <> 2 or v_second.update_review_status <> 'superseded' then
    raise exception 'rejected identical candidate was recreated';
  end if;
  if v_third.update_review_status <> 'approved'
    or v_third.publication_id <> '99999999-9999-4999-8999-999999999999'
  then
    raise exception 'approval was not bound to Feature 007 publication';
  end if;
  if (select count(*) from public.updates_legislativos) <> 4 then
    raise exception 'queue deduplication count is incorrect';
  end if;
  if not exists (
    select 1 from public.updates_legislativos
    where update_review_status = 'error' and error_code = 'SOURCE_TIMEOUT'
      and candidate_normative_sha256 is null and diff is null
  ) then
    raise exception 'technical failure pretended to be a validated candidate';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'private.enqueue_legislative_update(jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'private.decide_legislative_update(uuid,uuid,text,text,uuid)', 'EXECUTE'
  ) then
    raise exception 'authenticated role reached the private update queue';
  end if;
  if pg_catalog.has_table_privilege('lex_update_worker', 'public.leis', 'UPDATE')
    or pg_catalog.has_table_privilege('lex_update_worker', 'public.versoes_lei', 'INSERT')
    or pg_catalog.has_table_privilege('lex_update_worker', 'public.dispositivos', 'INSERT')
    or pg_catalog.has_table_privilege('lex_update_worker', 'public.block_ids', 'DELETE')
    or pg_catalog.has_table_privilege('lex_update_worker', 'public.updates_legislativos', 'INSERT')
  then
    raise exception 'worker received direct table mutation authority';
  end if;
  if pg_catalog.has_function_privilege(
    'lex_update_worker', 'private.prepare_publication_attempt(jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_update_worker', 'private.publish_validated_release(jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_update_worker',
    'private.record_publication_approval(uuid,uuid,uuid,text,timestamptz)', 'EXECUTE'
  ) or pg_catalog.pg_has_role('lex_update_worker', 'lex_update_editor', 'USAGE')
  then
    raise exception 'worker reached publication or editorial authority';
  end if;
  if not exists (
    select 1 from private.legislative_update_events
    where update_id = v_third.id and event_type = 'approved'
  ) then
    raise exception 'append-only editorial audit event is missing';
  end if;
end
$assertions$;
