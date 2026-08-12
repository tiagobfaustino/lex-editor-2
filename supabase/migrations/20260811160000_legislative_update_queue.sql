-- Feature 008: fila de atualização legislativa com autoridades separadas.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_update_owner') then
    create role lex_update_owner nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_update_worker') then
    create role lex_update_worker nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_update_editor') then
    create role lex_update_editor nologin noinherit;
  end if;
end
$roles$;

grant lex_update_owner, lex_update_worker, lex_update_editor to postgres;
grant usage on schema private to lex_update_owner, lex_update_worker, lex_update_editor;

create table public.updates_legislativos (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  lei_id uuid not null references public.leis(id) on delete cascade,
  base_versao_id uuid not null,
  base_normative_sha256 text not null check (base_normative_sha256 ~ '^[0-9a-f]{64}$'),
  candidate_normative_sha256 text check (
    candidate_normative_sha256 is null or candidate_normative_sha256 ~ '^[0-9a-f]{64}$'
  ),
  detection_key text not null check (detection_key ~ '^[0-9a-f]{64}$'),
  source_artifacts jsonb not null default '[]'::jsonb
    check (jsonb_typeof(source_artifacts) = 'array'),
  candidate_artifact_id uuid,
  source_url text not null,
  diff jsonb check (diff is null or jsonb_typeof(diff) = 'object'),
  diff_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(diff_summary) = 'object'),
  overall_confidence text not null check (overall_confidence in ('high', 'medium', 'low')),
  requires_human_review boolean not null default true,
  update_review_status text not null default 'pending' check (
    update_review_status in ('pending', 'approved', 'rejected', 'superseded', 'error')
  ),
  detection_count integer not null default 1 check (detection_count > 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  detected_at timestamptz not null default pg_catalog.now(),
  last_detected_at timestamptz not null default pg_catalog.now(),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  rejected_by uuid references auth.users(id),
  rejection_reason text,
  error_code text,
  superseded_by_update_id uuid references public.updates_legislativos(id),
  publication_id uuid,
  reprocess_requested_at timestamptz,
  reprocess_claimed_at timestamptz,
  unique (lei_id, detection_key),
  foreign key (base_versao_id, lei_id) references public.versoes_lei(id, lei_id),
  check (
    update_review_status <> 'approved'
    or (approved_by is not null and approved_at is not null and publication_id is not null)
  ),
  check (
    update_review_status <> 'rejected'
    or (rejected_by is not null and pg_catalog.length(pg_catalog.btrim(rejection_reason)) >= 10)
  ),
  check (
    update_review_status <> 'error'
    or (error_code is not null and candidate_normative_sha256 is null and diff is null)
  )
);

create index updates_legislativos_fila_idx
  on public.updates_legislativos (update_review_status, detected_at desc);
create index updates_legislativos_lei_base_idx
  on public.updates_legislativos (lei_id, base_versao_id, last_detected_at desc);

create table private.legislative_source_health (
  lei_id uuid primary key references public.leis(id) on delete cascade,
  next_check_at timestamptz not null,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  next_retry_at timestamptz,
  suspended_until timestamptz,
  last_error_code text,
  checked_at timestamptz not null default pg_catalog.now()
);

create table private.legislative_update_events (
  event_id bigint generated always as identity primary key,
  update_id uuid not null references public.updates_legislativos(id),
  event_type text not null check (event_type in (
    'created', 'detected_again', 'superseded', 'approved', 'rejected',
    'error_recorded', 'reprocess_requested', 'reprocess_claimed'
  )),
  actor_user_id uuid references auth.users(id),
  detail_code text,
  occurred_at timestamptz not null default pg_catalog.now()
);

alter table public.updates_legislativos enable row level security;
alter table public.updates_legislativos owner to lex_update_owner;
alter table private.legislative_source_health owner to lex_update_owner;
alter table private.legislative_update_events owner to lex_update_owner;

revoke all on public.updates_legislativos from public, anon, authenticated;
revoke all on private.legislative_source_health, private.legislative_update_events
  from public, anon, authenticated, lex_update_worker, lex_update_editor;

-- O owner pode ler a base publicada, mas deliberadamente não recebe UPDATE,
-- INSERT ou DELETE nas tabelas normativas.
grant select on public.leis, public.versoes_lei, public.usuarios_perfil to lex_update_owner;

create or replace function private.assert_update_worker_identity()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_update_worker', 'USAGE') then
    raise exception using errcode = '42501', message = 'update worker identity required';
  end if;
end
$function$;

create or replace function private.assert_update_editor_identity()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_update_editor', 'USAGE') then
    raise exception using errcode = '42501', message = 'update editor identity required';
  end if;
end
$function$;

alter function private.assert_update_worker_identity() owner to lex_update_owner;
alter function private.assert_update_editor_identity() owner to lex_update_owner;
revoke all on function private.assert_update_worker_identity() from public, anon, authenticated;
revoke all on function private.assert_update_editor_identity() from public, anon, authenticated;

create or replace function private.enqueue_legislative_update(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_law_id uuid := (p_payload ->> 'lawId')::uuid;
  v_base_id uuid := (p_payload ->> 'baseVersionId')::uuid;
  v_detection_key text := p_payload ->> 'detectionKey';
  v_candidate_hash text := p_payload ->> 'candidateNormativeSha256';
  v_existing public.updates_legislativos%rowtype;
  v_created public.updates_legislativos%rowtype;
  v_superseded uuid[];
begin
  perform private.assert_update_worker_identity();
  if v_detection_key !~ '^[0-9a-f]{64}$' or v_candidate_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid update hashes';
  end if;
  if pg_catalog.jsonb_typeof(p_payload -> 'sourceArtifacts') <> 'array'
    or pg_catalog.jsonb_array_length(p_payload -> 'sourceArtifacts') < 1
    or pg_catalog.jsonb_typeof(p_payload -> 'diff') <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid update evidence';
  end if;
  perform 1 from public.versoes_lei
    where id = v_base_id and lei_id = v_law_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'published base not found';
  end if;

  select * into v_existing
  from public.updates_legislativos
  where lei_id = v_law_id and detection_key = v_detection_key
  for update;
  if found then
    update public.updates_legislativos
      set detection_count = detection_count + 1,
          last_detected_at = (p_payload ->> 'detectedAt')::timestamptz
      where id = v_existing.id
      returning * into v_existing;
    insert into private.legislative_update_events (update_id, event_type)
      values (v_existing.id, 'detected_again');
    return pg_catalog.jsonb_build_object(
      'updateId', v_existing.id,
      'created', false,
      'updateReviewStatus', v_existing.update_review_status,
      'supersededUpdateIds', '[]'::jsonb
    );
  end if;

  insert into public.updates_legislativos (
    lei_id, base_versao_id, base_normative_sha256, candidate_normative_sha256,
    detection_key, source_artifacts, candidate_artifact_id, source_url, diff,
    diff_summary, overall_confidence, requires_human_review, detected_at, last_detected_at
  ) values (
    v_law_id, v_base_id, p_payload ->> 'baseNormativeSha256', v_candidate_hash,
    v_detection_key, p_payload -> 'sourceArtifacts',
    (p_payload ->> 'candidateArtifactId')::uuid, p_payload ->> 'sourceUrl',
    p_payload -> 'diff', p_payload #> '{diff,summary}',
    p_payload ->> 'overallConfidence',
    (p_payload ->> 'requiresHumanReview')::boolean,
    (p_payload ->> 'detectedAt')::timestamptz,
    (p_payload ->> 'detectedAt')::timestamptz
  ) returning * into v_created;

  with changed as (
    update public.updates_legislativos
      set update_review_status = 'superseded',
          superseded_by_update_id = v_created.id
      where lei_id = v_law_id
        and base_versao_id = v_base_id
        and id <> v_created.id
        and update_review_status in ('pending', 'rejected', 'error')
      returning id
  ) select coalesce(pg_catalog.array_agg(id), '{}'::uuid[]) into v_superseded from changed;

  insert into private.legislative_update_events (update_id, event_type)
    values (v_created.id, 'created');
  insert into private.legislative_update_events (update_id, event_type, detail_code)
    select id, 'superseded', v_created.id::text
    from public.updates_legislativos where id = any(v_superseded);

  return pg_catalog.jsonb_build_object(
    'updateId', v_created.id,
    'created', true,
    'updateReviewStatus', v_created.update_review_status,
    'supersededUpdateIds', pg_catalog.to_jsonb(v_superseded)
  );
end
$function$;

alter function private.enqueue_legislative_update(jsonb) owner to lex_update_owner;
revoke all on function private.enqueue_legislative_update(jsonb) from public, anon, authenticated;
grant execute on function private.enqueue_legislative_update(jsonb) to lex_update_worker;

create or replace function private.record_legislative_update_error(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_update public.updates_legislativos%rowtype;
begin
  perform private.assert_update_worker_identity();
  select * into v_update
  from public.updates_legislativos
  where lei_id = (p_payload ->> 'lawId')::uuid
    and detection_key = p_payload ->> 'failureKey'
  for update;
  if found then
    update public.updates_legislativos
      set update_review_status = 'error',
          error_code = p_payload ->> 'errorCode',
          candidate_normative_sha256 = null,
          source_artifacts = '[]'::jsonb,
          candidate_artifact_id = null,
          diff = null,
          diff_summary = '{}'::jsonb,
          reprocess_requested_at = null,
          reprocess_claimed_at = null,
          detection_count = detection_count + 1,
          retry_count = retry_count + 1,
          last_detected_at = (p_payload ->> 'occurredAt')::timestamptz
      where id = v_update.id returning * into v_update;
  else
    insert into public.updates_legislativos (
      lei_id, base_versao_id, base_normative_sha256, candidate_normative_sha256,
      detection_key, source_url, diff, diff_summary, overall_confidence,
      requires_human_review, update_review_status, error_code, detected_at, last_detected_at
    ) values (
      (p_payload ->> 'lawId')::uuid, (p_payload ->> 'baseVersionId')::uuid,
      p_payload ->> 'baseNormativeSha256', null, p_payload ->> 'failureKey',
      p_payload ->> 'sourceUrl', null, '{}'::jsonb, 'low', true, 'error',
      p_payload ->> 'errorCode', (p_payload ->> 'occurredAt')::timestamptz,
      (p_payload ->> 'occurredAt')::timestamptz
    ) returning * into v_update;
  end if;
  insert into private.legislative_update_events (update_id, event_type, detail_code)
    values (v_update.id, 'error_recorded', v_update.error_code);
  return pg_catalog.jsonb_build_object(
    'updateId', v_update.id,
    'updateReviewStatus', v_update.update_review_status,
    'retryCount', v_update.retry_count
  );
end
$function$;

alter function private.record_legislative_update_error(jsonb) owner to lex_update_owner;
revoke all on function private.record_legislative_update_error(jsonb) from public, anon, authenticated;
grant execute on function private.record_legislative_update_error(jsonb) to lex_update_worker;

create or replace function private.record_legislative_source_health(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform private.assert_update_worker_identity();
  insert into private.legislative_source_health (
    lei_id, next_check_at, consecutive_failures, next_retry_at,
    suspended_until, last_error_code, checked_at
  ) values (
    (p_payload ->> 'lawId')::uuid, (p_payload ->> 'nextCheckAt')::timestamptz,
    (p_payload ->> 'consecutiveFailures')::integer,
    (p_payload ->> 'nextRetryAt')::timestamptz,
    (p_payload ->> 'suspendedUntil')::timestamptz,
    p_payload ->> 'lastErrorCode', pg_catalog.now()
  ) on conflict (lei_id) do update set
    next_check_at = excluded.next_check_at,
    consecutive_failures = excluded.consecutive_failures,
    next_retry_at = excluded.next_retry_at,
    suspended_until = excluded.suspended_until,
    last_error_code = excluded.last_error_code,
    checked_at = excluded.checked_at;
end
$function$;

alter function private.record_legislative_source_health(jsonb) owner to lex_update_owner;
revoke all on function private.record_legislative_source_health(jsonb) from public, anon, authenticated;
grant execute on function private.record_legislative_source_health(jsonb) to lex_update_worker;

create or replace function private.list_legislative_updates(
  p_update_review_status text default null,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_update_editor_identity();
  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'invalid page size';
  end if;
  select coalesce(pg_catalog.jsonb_agg(item.value order by item.detected_at desc), '[]'::jsonb)
    into v_result
  from (
    select u.detected_at, pg_catalog.jsonb_build_object(
      'updateId', u.id, 'lawId', u.lei_id, 'lawSigla', l.sigla,
      'lawTitle', l.titulo, 'sourceUrl', u.source_url,
      'updateReviewStatus', u.update_review_status, 'summary', u.diff_summary,
      'overallConfidence', u.overall_confidence,
      'requiresHumanReview', u.requires_human_review,
      'detectedAt', u.detected_at, 'lastDetectedAt', u.last_detected_at,
      'detectionCount', u.detection_count, 'retryCount', u.retry_count,
      'rejectionReason', u.rejection_reason, 'errorCode', u.error_code,
      'publicationId', u.publication_id,
      'reprocessRequested',
        (u.reprocess_requested_at is not null and u.reprocess_claimed_at is null)
    ) as value
    from public.updates_legislativos u
    join public.leis l on l.id = u.lei_id
    where (p_update_review_status is null or u.update_review_status = p_update_review_status)
      and (p_before is null or u.detected_at < p_before)
    order by u.detected_at desc
    limit p_limit
  ) item;
  return v_result;
end
$function$;

alter function private.list_legislative_updates(text, integer, timestamptz) owner to lex_update_owner;
revoke all on function private.list_legislative_updates(text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function private.list_legislative_updates(text, integer, timestamptz)
  to lex_update_editor;

create or replace function private.get_legislative_update(p_update_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_update_editor_identity();
  select pg_catalog.jsonb_build_object(
    'updateId', u.id, 'lawId', u.lei_id, 'lawSigla', l.sigla,
    'lawTitle', l.titulo, 'sourceUrl', u.source_url,
    'baseVersionId', u.base_versao_id,
    'updateReviewStatus', u.update_review_status,
    'overallConfidence', u.overall_confidence,
    'requiresHumanReview', u.requires_human_review,
    'detectedAt', u.detected_at, 'lastDetectedAt', u.last_detected_at,
    'retryCount', u.retry_count, 'rejectionReason', u.rejection_reason,
    'errorCode', u.error_code, 'publicationId', u.publication_id,
    'reprocessRequested',
      (u.reprocess_requested_at is not null and u.reprocess_claimed_at is null),
    'diff', u.diff
  ) into v_result
  from public.updates_legislativos u
  join public.leis l on l.id = u.lei_id
  where u.id = p_update_id;
  if v_result is null then
    raise exception using errcode = 'P0002', message = 'update not found';
  end if;
  return v_result;
end
$function$;

alter function private.get_legislative_update(uuid) owner to lex_update_owner;
revoke all on function private.get_legislative_update(uuid) from public, anon, authenticated;
grant execute on function private.get_legislative_update(uuid) to lex_update_editor;

create or replace function private.count_legislative_updates()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pending bigint;
  v_approved bigint;
  v_rejected bigint;
  v_superseded bigint;
  v_error bigint;
begin
  perform private.assert_update_editor_identity();
  select
    pg_catalog.count(*) filter (where update_review_status = 'pending'),
    pg_catalog.count(*) filter (where update_review_status = 'approved'),
    pg_catalog.count(*) filter (where update_review_status = 'rejected'),
    pg_catalog.count(*) filter (where update_review_status = 'superseded'),
    pg_catalog.count(*) filter (where update_review_status = 'error')
  into v_pending, v_approved, v_rejected, v_superseded, v_error
  from public.updates_legislativos;
  return pg_catalog.jsonb_build_object(
    'pending', v_pending, 'approved', v_approved, 'rejected', v_rejected,
    'superseded', v_superseded, 'error', v_error,
    'actionable', v_pending + v_error
  );
end
$function$;

alter function private.count_legislative_updates() owner to lex_update_owner;
revoke all on function private.count_legislative_updates() from public, anon, authenticated;
grant execute on function private.count_legislative_updates() to lex_update_editor;

create or replace function private.decide_legislative_update(
  p_update_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_rejection_reason text default null,
  p_publication_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_update public.updates_legislativos%rowtype;
begin
  perform private.assert_update_editor_identity();
  if not exists (
    select 1 from public.usuarios_perfil p
    where p.user_id = p_actor_user_id and p.account_status = 'active' and p.papel = 'curador'
  ) then
    raise exception using errcode = '42501', message = 'active legal editor required';
  end if;
  select * into v_update from public.updates_legislativos
    where id = p_update_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'update not found';
  end if;
  if v_update.update_review_status <> 'pending' then
    raise exception using errcode = '55000', message = 'update is not pending';
  end if;
  if p_decision = 'approved' and p_publication_id is not null then
    update public.updates_legislativos set
      update_review_status = 'approved', approved_by = p_actor_user_id,
      approved_at = pg_catalog.now(), publication_id = p_publication_id
      where id = p_update_id returning * into v_update;
    insert into private.legislative_update_events (update_id, event_type, actor_user_id)
      values (p_update_id, 'approved', p_actor_user_id);
  elsif p_decision = 'rejected'
    and pg_catalog.length(pg_catalog.btrim(p_rejection_reason)) >= 10
  then
    update public.updates_legislativos set
      update_review_status = 'rejected', rejected_by = p_actor_user_id,
      rejection_reason = p_rejection_reason
      where id = p_update_id returning * into v_update;
    insert into private.legislative_update_events (update_id, event_type, actor_user_id)
      values (p_update_id, 'rejected', p_actor_user_id);
  else
    raise exception using errcode = '22023', message = 'invalid update decision';
  end if;
  return pg_catalog.jsonb_build_object(
    'updateId', v_update.id,
    'updateReviewStatus', v_update.update_review_status,
    'publicationId', v_update.publication_id,
    'retryCount', v_update.retry_count,
    'reprocessRequested', false
  );
end
$function$;

alter function private.decide_legislative_update(uuid, uuid, text, text, uuid)
  owner to lex_update_owner;
revoke all on function private.decide_legislative_update(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function private.decide_legislative_update(uuid, uuid, text, text, uuid)
  to lex_update_editor;

create or replace function private.request_legislative_update_reprocess(
  p_update_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_update public.updates_legislativos%rowtype;
begin
  perform private.assert_update_editor_identity();
  if not exists (
    select 1 from public.usuarios_perfil p
    where p.user_id = p_actor_user_id and p.account_status = 'active' and p.papel = 'curador'
  ) then
    raise exception using errcode = '42501', message = 'active legal editor required';
  end if;
  update public.updates_legislativos set
    retry_count = retry_count + 1,
    reprocess_requested_at = pg_catalog.now(), reprocess_claimed_at = null
    where id = p_update_id and update_review_status in ('rejected', 'error')
    returning * into v_update;
  if not found then
    raise exception using errcode = '55000', message = 'update cannot be reprocessed';
  end if;
  insert into private.legislative_update_events (update_id, event_type, actor_user_id)
    values (p_update_id, 'reprocess_requested', p_actor_user_id);
  return pg_catalog.jsonb_build_object(
    'updateId', v_update.id,
    'updateReviewStatus', v_update.update_review_status,
    'publicationId', v_update.publication_id,
    'retryCount', v_update.retry_count,
    'reprocessRequested', true
  );
end
$function$;

alter function private.request_legislative_update_reprocess(uuid, uuid) owner to lex_update_owner;
revoke all on function private.request_legislative_update_reprocess(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.request_legislative_update_reprocess(uuid, uuid)
  to lex_update_editor;

create or replace function private.claim_legislative_update_reprocess_requests(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  perform private.assert_update_worker_identity();
  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'invalid claim size';
  end if;
  with claimed as (
    select id from public.updates_legislativos
    where reprocess_requested_at is not null and reprocess_claimed_at is null
    order by reprocess_requested_at for update skip locked limit p_limit
  ), updated as (
    update public.updates_legislativos u set reprocess_claimed_at = pg_catalog.now()
    from claimed where u.id = claimed.id returning u.id, u.lei_id
  ), events as (
    insert into private.legislative_update_events (update_id, event_type)
    select id, 'reprocess_claimed' from updated returning update_id
  )
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('updateId', id, 'lawId', lei_id)),
    '[]'::jsonb
  ) into v_result from updated;
  return v_result;
end
$function$;

alter function private.claim_legislative_update_reprocess_requests(integer) owner to lex_update_owner;
revoke all on function private.claim_legislative_update_reprocess_requests(integer)
  from public, anon, authenticated;
grant execute on function private.claim_legislative_update_reprocess_requests(integer)
  to lex_update_worker;

-- Defesa explícita: nem o worker nem o endpoint editorial recebem escrita
-- normativa, mesmo que alguém tente contornar as funções acima.
revoke insert, update, delete, truncate
  on public.leis, public.versoes_lei, public.artefatos_fonte,
     public.dispositivos, public.block_ids, public.block_id_redirects
  from lex_update_worker, lex_update_editor;
