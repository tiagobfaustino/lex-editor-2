\set ON_ERROR_STOP on
set session authorization update_worker_test;
select private.append_legislative_candidate_artifact(value) from public.test_candidate_artifact;
select private.append_legislative_candidate_artifact(value) from public.test_candidate_artifact;
do $immutable$
begin
  begin
    perform private.append_legislative_candidate_artifact(jsonb_set(
      (select value from public.test_candidate_artifact), '{candidateNormativeSha256}', to_jsonb(repeat('f', 64))));
    raise exception 'candidate ID accepted different immutable bytes';
  exception when unique_violation then null; end;
  begin
    perform private.append_legislative_candidate_artifact(jsonb_set(jsonb_set(
      (select value from public.test_candidate_artifact), '{candidateArtifactId}',
      '"eeeeeeee-2222-4222-8222-222222222222"'::jsonb), '{snapshots,0,conteudo}', '"forged source"'::jsonb));
    raise exception 'corrupted source snapshot was persisted';
  exception when invalid_parameter_value then null; end;
end
$immutable$;
reset session authorization;

-- The existing enqueue RPC receives only the artifact ID and safe proposal.
create table public.test_candidate_update (update_id uuid, publication_id uuid, manifest text);
insert into public.test_candidate_update
select (private.enqueue_legislative_update(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
  (select value from public.test_update_payloads where name = 'first'),
  '{candidateArtifactId}', artifact.value -> 'candidateArtifactId'),
  '{baseNormativeSha256}', artifact.value -> 'baseNormativeSha256'),
  '{candidateNormativeSha256}', artifact.value -> 'candidateNormativeSha256'),
  '{detectionKey}', to_jsonb(repeat('9', 64)))) ->> 'updateId')::uuid,
  'eeeeeeee-3333-4333-8333-333333333333'::uuid,
  jsonb_build_object('publicationId', 'eeeeeeee-3333-4333-8333-333333333333',
    'law', jsonb_build_object('lawId', artifact.value -> 'lawId'),
    'expectedBase', jsonb_build_object('publishedVersionId', artifact.value -> 'baseVersionId'),
    'target', jsonb_build_object('kind', 'legislative_update'),
    'approvedBy', jsonb_build_object('userId', '44444444-4444-4444-8444-444444444444', 'role', 'editor_juridico'),
    'sourceSnapshots', jsonb_build_array(jsonb_build_object(
      'sourceArtifactSha256', artifact.value -> 'snapshots' -> 0 -> 'sha256',
      'sourceRole', artifact.value -> 'snapshots' -> 0 -> 'referencia' -> 'sourceRole',
      'sourceType', artifact.value -> 'snapshots' -> 0 -> 'referencia' -> 'sourceType',
      'sourceVariant', artifact.value -> 'snapshots' -> 0 -> 'referencia' -> 'sourceVariant'))
  )::text from public.test_candidate_artifact artifact;
grant select on public.test_candidate_update to update_editor_test, publisher_test;

set session authorization update_editor_test;
do $candidate_reads_and_authorization$
declare v_update_id uuid; v_publication_id uuid; v_manifest text;
begin
  select update_id, publication_id, manifest into v_update_id, v_publication_id, v_manifest from public.test_candidate_update;
  if private.get_legislative_update_candidate(v_update_id, '44444444-4444-4444-8444-444444444444')
    <> (select value from public.test_candidate_artifact) then raise exception 'candidate was not preserved exactly'; end if;
  begin
    perform private.get_legislative_update_candidate(v_update_id, '55555555-5555-4555-8555-555555555555');
    raise exception 'unauthorized profile read candidate artifacts';
  exception when insufficient_privilege then null; end;
  begin
    perform private.decide_legislative_update(v_update_id, '44444444-4444-4444-8444-444444444444',
      'approved', null, v_publication_id);
    raise exception 'legacy approval bypassed persisted candidate authorization';
  exception when insufficient_privilege then null; end;
  begin
    perform private.approve_legislative_update_candidate(v_update_id, '44444444-4444-4444-8444-444444444444',
      v_publication_id, 'eeeeeeee-1111-4111-8111-111111111111', v_manifest);
    raise exception 'candidate approved without publisher approval';
  exception when insufficient_privilege then null; end;
end
$candidate_reads_and_authorization$;
reset session authorization;
insert into auth.users(id) values ('eeeeeeee-5555-4555-8555-555555555555');
insert into public.usuarios_perfil(user_id, account_status, papel)
  values ('eeeeeeee-5555-4555-8555-555555555555', 'active', 'curador');
create table public.test_candidate_authorization (
  label text, publication_id uuid, actor_user_id uuid, manifest text
);
insert into public.test_candidate_authorization
select 'wrong_source', 'eeeeeeee-6666-4666-8666-666666666666'::uuid,
  '44444444-4444-4444-8444-444444444444'::uuid,
  jsonb_set(jsonb_set(manifest::jsonb, '{publicationId}',
    '"eeeeeeee-6666-4666-8666-666666666666"'::jsonb),
    '{sourceSnapshots,0,sourceArtifactSha256}', to_jsonb(repeat('f', 64)))::text
  from public.test_candidate_update;
insert into public.test_candidate_authorization
select 'another_actor', 'eeeeeeee-7777-4777-8777-777777777777'::uuid,
  'eeeeeeee-5555-4555-8555-555555555555'::uuid,
  jsonb_set(manifest::jsonb, '{publicationId}',
    '"eeeeeeee-7777-4777-8777-777777777777"'::jsonb)::text
  from public.test_candidate_update;
grant select on public.test_candidate_authorization to publisher_test, update_editor_test;
set session authorization publisher_test;
select private.record_publication_approval(publication_id, publication_id, actor_user_id,
  encode(sha256(convert_to(manifest, 'UTF8')), 'hex'), now()) from public.test_candidate_authorization;
reset session authorization;
set session authorization update_editor_test;
do $approved_wrong_candidate$
declare v_case record;
begin
  for v_case in select * from public.test_candidate_authorization loop
    begin
      perform private.approve_legislative_update_candidate(
        (select update_id from public.test_candidate_update),
        '44444444-4444-4444-8444-444444444444', v_case.publication_id,
        'eeeeeeee-1111-4111-8111-111111111111', v_case.manifest);
      raise exception 'publisher approval bypassed candidate constraint: %', v_case.label;
    exception when insufficient_privilege then null; end;
  end loop;
end
$approved_wrong_candidate$;
reset session authorization;
set session authorization publisher_test;
select private.record_publication_approval('eeeeeeee-4444-4444-8444-444444444444',
  publication_id, '44444444-4444-4444-8444-444444444444',
  encode(sha256(convert_to(manifest, 'UTF8')), 'hex'), now()) from public.test_candidate_update;
reset session authorization;
set session authorization update_editor_test;
do $approval_binding$
declare v_update_id uuid; v_publication_id uuid; v_manifest text; v_result jsonb;
begin
  select update_id, publication_id, manifest into v_update_id, v_publication_id, v_manifest from public.test_candidate_update;
  begin
    perform private.approve_legislative_update_candidate(v_update_id, '44444444-4444-4444-8444-444444444444',
      v_publication_id, 'eeeeeeee-1111-4111-8111-111111111111',
      jsonb_set(v_manifest::jsonb, '{expectedBase,publishedVersionId}',
        '"eeeeeeee-9999-4999-8999-999999999999"'::jsonb)::text);
    raise exception 'approval accepted another candidate baseline/digest';
  exception when insufficient_privilege then null; end;
  begin
    perform private.approve_legislative_update_candidate(v_update_id, '44444444-4444-4444-8444-444444444444',
      v_publication_id, 'eeeeeeee-2222-4222-8222-222222222222', v_manifest);
    raise exception 'approval accepted another artifact';
  exception when insufficient_privilege then null; end;
  v_result := private.approve_legislative_update_candidate(v_update_id, '44444444-4444-4444-8444-444444444444',
    v_publication_id, 'eeeeeeee-1111-4111-8111-111111111111', v_manifest);
  if v_result ->> 'updateReviewStatus' <> 'approved' or v_result ->> 'publicationId' <> v_publication_id::text then
    raise exception 'guarded candidate approval did not bind the publication'; end if;
  if private.approve_legislative_update_candidate(v_update_id, '44444444-4444-4444-8444-444444444444',
    v_publication_id, 'eeeeeeee-1111-4111-8111-111111111111', v_manifest) <> v_result then
    raise exception 'guarded approval retry was not idempotent'; end if;
end
$approval_binding$;
reset session authorization;

do $permissions$
begin
  begin
    update public.leis set versao_publicada_id = null where id = '33333333-3333-4333-8333-333333333333';
    perform private.get_legislative_update_candidate((select update_id from public.test_candidate_update),
      '44444444-4444-4444-8444-444444444444');
    raise exception 'candidate read accepted an obsolete published baseline';
  exception when object_not_in_prerequisite_state then null; end;
  if (select count(*) from private.legislative_candidate_artifacts) <> 1 then
    raise exception 'candidate retry duplicated immutable storage'; end if;
  if pg_catalog.has_table_privilege('lex_update_worker', 'private.legislative_candidate_artifacts', 'INSERT')
    or pg_catalog.has_table_privilege('lex_update_editor', 'private.legislative_candidate_artifacts', 'SELECT')
    or pg_catalog.has_function_privilege('lex_update_worker', 'private.get_legislative_update_candidate(uuid,uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('lex_update_worker', 'private.approve_legislative_update_candidate(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('lex_update_editor', 'private.decide_legislative_update_internal(uuid,uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'candidate storage widened worker/editor authority'; end if;
  begin
    update private.legislative_candidate_artifacts set payload = '{}'::jsonb;
    raise exception 'stored candidate was mutable';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    delete from private.legislative_candidate_artifacts;
    raise exception 'stored candidate was deletable';
  exception when object_not_in_prerequisite_state then null; end;
  if (select count(*) from private.legislative_update_events
    where update_id = (select update_id from public.test_candidate_update) and event_type = 'approved') <> 1 then
    raise exception 'approval retry duplicated terminal decision'; end if;
end
$permissions$;
