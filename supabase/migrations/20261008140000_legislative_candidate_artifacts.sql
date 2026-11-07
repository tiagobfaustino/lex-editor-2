-- Restricted, immutable candidate materialization for the worker/editor boundary.
create table private.legislative_candidate_artifacts (
  candidate_artifact_id uuid primary key,
  law_id uuid not null references public.leis(id),
  base_version_id uuid not null,
  candidate_normative_sha256 text not null check (candidate_normative_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  foreign key (base_version_id, law_id) references public.versoes_lei(id, lei_id)
);
alter table private.legislative_candidate_artifacts owner to lex_update_owner;
alter table private.legislative_candidate_artifacts enable row level security;
revoke all on private.legislative_candidate_artifacts from public, anon, authenticated, lex_update_worker, lex_update_editor;

create or replace function private.deny_legislative_candidate_mutation()
returns trigger language plpgsql set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'candidate artifact is immutable';
end
$function$;
alter function private.deny_legislative_candidate_mutation() owner to lex_update_owner;
revoke all on function private.deny_legislative_candidate_mutation() from public, anon, authenticated;
create trigger legislative_candidate_immutable before update or delete
  on private.legislative_candidate_artifacts for each row
  execute function private.deny_legislative_candidate_mutation();

create or replace function private.append_legislative_candidate_artifact(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_id uuid;
  v_law_id uuid;
  v_base_id uuid;
  v_existing jsonb;
  v_snapshot jsonb;
  v_primary_count integer := 0;
  v_hashes text[] := array[]::text[];
begin
  perform private.assert_update_worker_identity();
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
    or p_payload ->> 'schemaVersion' <> '1'
    or (select count(*) from pg_catalog.jsonb_object_keys(p_payload)) <> 8
    or not p_payload ?& array['schemaVersion', 'candidateArtifactId', 'lawId', 'baseVersionId',
      'baseNormativeSha256', 'candidateNormativeSha256', 'ast', 'snapshots']
    or p_payload ->> 'baseNormativeSha256' !~ '^[0-9a-f]{64}$'
    or p_payload ->> 'candidateNormativeSha256' !~ '^[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(p_payload -> 'ast') <> 'object'
    or p_payload -> 'ast' ->> 'astPhase' <> 'identified'
    or pg_catalog.jsonb_typeof(p_payload -> 'snapshots') <> 'array'
    or pg_catalog.jsonb_array_length(p_payload -> 'snapshots') not between 1 and 10
    or pg_catalog.octet_length(p_payload::text) > 67108864 then
    raise exception using errcode = '22023', message = 'invalid candidate artifact';
  end if;
  v_id := (p_payload ->> 'candidateArtifactId')::uuid;
  v_law_id := (p_payload ->> 'lawId')::uuid;
  v_base_id := (p_payload ->> 'baseVersionId')::uuid;
  if v_id is null or v_law_id is null or v_base_id is null then
    raise exception using errcode = '22023', message = 'invalid candidate identity';
  end if;
  if not exists (select 1 from public.leis where id = v_law_id and versao_publicada_id = v_base_id) then
    raise exception using errcode = '55000', message = 'candidate baseline is stale';
  end if;
  for v_snapshot in select value from pg_catalog.jsonb_array_elements(p_payload -> 'snapshots') loop
    if pg_catalog.jsonb_typeof(v_snapshot) <> 'object'
      or not v_snapshot ?& array['sha256', 'conteudo', 'referencia']
      or (select count(*) from pg_catalog.jsonb_object_keys(v_snapshot)) <> 3
      or pg_catalog.jsonb_typeof(v_snapshot -> 'conteudo') <> 'string'
      or pg_catalog.octet_length(v_snapshot ->> 'conteudo') not between 1 and 20971520
      or pg_catalog.jsonb_typeof(v_snapshot -> 'referencia') <> 'object'
      or v_snapshot ->> 'sha256' !~ '^[0-9a-f]{64}$'
      or v_snapshot ->> 'sha256' is distinct from v_snapshot -> 'referencia' ->> 'sourceArtifactSha256'
      or v_snapshot ->> 'sha256' = any(v_hashes)
      or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_snapshot ->> 'conteudo', 'UTF8')), 'hex')
        is distinct from v_snapshot ->> 'sha256' then
      raise exception using errcode = '22023', message = 'candidate snapshot digest mismatch';
    end if;
    v_hashes := pg_catalog.array_append(v_hashes, v_snapshot ->> 'sha256');
    if v_snapshot -> 'referencia' ->> 'sourceRole' = 'primary_current' then
      v_primary_count := v_primary_count + 1;
    end if;
  end loop;
  if v_primary_count <> 1 then
    raise exception using errcode = '22023', message = 'candidate requires one primary source';
  end if;
  insert into private.legislative_candidate_artifacts
    (candidate_artifact_id, law_id, base_version_id, candidate_normative_sha256, payload)
    values (v_id, v_law_id, v_base_id, p_payload ->> 'candidateNormativeSha256', p_payload)
    on conflict (candidate_artifact_id) do nothing;
  select payload into v_existing from private.legislative_candidate_artifacts where candidate_artifact_id = v_id;
  if v_existing is distinct from p_payload then
    raise exception using errcode = '23505', message = 'immutable candidate artifact conflict';
  end if;
  return pg_catalog.jsonb_build_object('candidateArtifactId', v_id);
end
$function$;
alter function private.append_legislative_candidate_artifact(jsonb) owner to lex_update_owner;
revoke all on function private.append_legislative_candidate_artifact(jsonb) from public, anon, authenticated;
grant execute on function private.append_legislative_candidate_artifact(jsonb) to lex_update_worker;

create or replace function private.get_legislative_update_candidate(p_update_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_candidate jsonb;
begin
  perform private.assert_update_editor_identity();
  if not exists (select 1 from public.usuarios_perfil where user_id = p_actor_user_id
    and account_status = 'active' and papel in ('curador', 'administrador')) then
    raise exception using errcode = '42501', message = 'active legal editor required';
  end if;
  select artifact.payload into v_candidate from public.updates_legislativos update
    join private.legislative_candidate_artifacts artifact on artifact.candidate_artifact_id = update.candidate_artifact_id
    join public.leis law on law.id = update.lei_id
    where update.id = p_update_id and artifact.law_id = update.lei_id
      and artifact.base_version_id = update.base_versao_id and law.versao_publicada_id = update.base_versao_id
      and artifact.candidate_normative_sha256 = update.candidate_normative_sha256
      and artifact.payload ->> 'baseNormativeSha256' = update.base_normative_sha256
      and update.update_review_status in ('pending', 'rejected', 'approved');
  if v_candidate is null then
    raise exception using errcode = '55000', message = 'candidate artifact unavailable or stale';
  end if;
  return v_candidate;
end
$function$;
alter function private.get_legislative_update_candidate(uuid, uuid) owner to lex_update_owner;
revoke all on function private.get_legislative_update_candidate(uuid, uuid) from public, anon, authenticated;
grant execute on function private.get_legislative_update_candidate(uuid, uuid) to lex_update_editor;

-- Hide the old unrestricted approval path. Rejection keeps its existing API.
alter function private.decide_legislative_update(uuid, uuid, text, text, uuid)
  rename to decide_legislative_update_internal;
revoke all on function private.decide_legislative_update_internal(uuid, uuid, text, text, uuid)
  from public, anon, authenticated, lex_update_editor;
create or replace function private.decide_legislative_update(
  p_update_id uuid, p_actor_user_id uuid, p_decision text,
  p_rejection_reason text default null, p_publication_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.assert_update_editor_identity();
  if p_decision is distinct from 'rejected' then
    raise exception using errcode = '42501', message = 'candidate approval capability required';
  end if;
  return private.decide_legislative_update_internal(
    p_update_id, p_actor_user_id, p_decision, p_rejection_reason, p_publication_id);
end
$function$;
alter function private.decide_legislative_update(uuid, uuid, text, text, uuid) owner to lex_update_owner;
revoke all on function private.decide_legislative_update(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function private.decide_legislative_update(uuid, uuid, text, text, uuid) to lex_update_editor;

-- Only the update owner can inspect the recorded publisher authorization.
grant select on private.publication_approvals to lex_update_owner;
create or replace function private.approve_legislative_update_candidate(
  p_update_id uuid, p_actor_user_id uuid, p_publication_id uuid,
  p_candidate_artifact_id uuid, p_manifest_canonical text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_candidate jsonb;
  v_manifest jsonb;
  v_digest text;
  v_update public.updates_legislativos%rowtype;
begin
  perform private.assert_update_editor_identity();
  select * into v_update from public.updates_legislativos where id = p_update_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'update not found'; end if;
  v_candidate := private.get_legislative_update_candidate(p_update_id, p_actor_user_id);
  if p_manifest_canonical is null or pg_catalog.octet_length(p_manifest_canonical) > 262144 then
    raise exception using errcode = '22023', message = 'invalid candidate manifest';
  end if;
  v_manifest := p_manifest_canonical::jsonb;
  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_manifest_canonical, 'UTF8')), 'hex');
  if p_candidate_artifact_id is distinct from v_update.candidate_artifact_id
    or v_manifest ->> 'publicationId' is distinct from p_publication_id::text
    or v_manifest -> 'law' ->> 'lawId' is distinct from v_update.lei_id::text
    or v_manifest -> 'expectedBase' ->> 'publishedVersionId' is distinct from v_update.base_versao_id::text
    or v_manifest -> 'approvedBy' ->> 'userId' is distinct from p_actor_user_id::text
    or v_manifest -> 'approvedBy' ->> 'role' is distinct from 'editor_juridico'
    or v_manifest -> 'target' ->> 'kind' is distinct from 'legislative_update'
    or pg_catalog.jsonb_typeof(v_manifest -> 'sourceSnapshots') is distinct from 'array'
    or (select count(*) from pg_catalog.jsonb_array_elements(v_manifest -> 'sourceSnapshots')) <>
       (select count(*) from pg_catalog.jsonb_array_elements(v_candidate -> 'snapshots'))
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(v_candidate -> 'snapshots') snapshot
      where not exists (select 1 from pg_catalog.jsonb_array_elements(v_manifest -> 'sourceSnapshots') source
        where source ->> 'sourceArtifactSha256' = snapshot ->> 'sha256'
          and source ->> 'sourceRole' = snapshot -> 'referencia' ->> 'sourceRole'
          and source ->> 'sourceType' = snapshot -> 'referencia' ->> 'sourceType'
          and source ->> 'sourceVariant' = snapshot -> 'referencia' ->> 'sourceVariant')
    ) or not exists (select 1 from private.publication_approvals approval
      where approval.publication_id = p_publication_id and approval.user_id = p_actor_user_id
        and approval.manifest_digest = v_digest and approval.approval_role = 'editor_juridico') then
    raise exception using errcode = '42501', message = 'candidate approval does not match publisher authorization';
  end if;
  if v_update.update_review_status = 'approved' and v_update.publication_id = p_publication_id
    and v_update.approved_by = p_actor_user_id then
    return pg_catalog.jsonb_build_object('updateId', v_update.id, 'updateReviewStatus', 'approved',
      'publicationId', v_update.publication_id, 'retryCount', v_update.retry_count, 'reprocessRequested', false);
  end if;
  return private.decide_legislative_update_internal(p_update_id, p_actor_user_id, 'approved', null, p_publication_id);
end
$function$;
alter function private.approve_legislative_update_candidate(uuid, uuid, uuid, uuid, text) owner to lex_update_owner;
revoke all on function private.approve_legislative_update_candidate(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function private.approve_legislative_update_candidate(uuid, uuid, uuid, uuid, text) to lex_update_editor;
