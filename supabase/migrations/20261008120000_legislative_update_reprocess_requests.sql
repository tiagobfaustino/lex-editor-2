-- Feature 013 correction: idempotency belongs to the request, not the update.
-- Existing append-only events retain their bytes; new events identify their request.
create table private.legislative_update_reprocess_requests (
  request_id uuid primary key,
  update_id uuid not null references public.updates_legislativos(id),
  actor_user_id uuid references auth.users(id),
  retry_count integer not null,
  requested_at timestamptz not null,
  claimed_at timestamptz,
  outcome text check (outcome in ('completed', 'failed'))
);
alter table private.legislative_update_reprocess_requests owner to lex_update_owner;
alter table private.legislative_update_reprocess_requests enable row level security;
revoke all on private.legislative_update_reprocess_requests
  from public, anon, authenticated, lex_update_worker, lex_update_editor;

alter table public.updates_legislativos add column reprocess_request_id uuid;
alter table private.legislative_update_events add column reprocess_request_id uuid
  references private.legislative_update_reprocess_requests(request_id);

-- Adopt queued/in-flight work without rewriting its previous audit events.
update public.updates_legislativos set reprocess_request_id = pg_catalog.gen_random_uuid()
  where reprocess_requested_at is not null or reprocess_claimed_at is not null;
insert into private.legislative_update_reprocess_requests
  (request_id, update_id, actor_user_id, retry_count, requested_at, claimed_at)
select reprocess_request_id, id,
  (select event.actor_user_id from private.legislative_update_events event
    where event.update_id = update.id and event.event_type = 'reprocess_requested'
    order by event.event_id desc limit 1), retry_count,
  coalesce(reprocess_requested_at, reprocess_claimed_at), reprocess_claimed_at
from public.updates_legislativos update where reprocess_request_id is not null;

drop index private.legislative_update_reprocess_terminal_once_idx;
create unique index legislative_update_reprocess_terminal_once_idx
  on private.legislative_update_events (reprocess_request_id)
  where event_type in ('reprocess_completed', 'reprocess_failed');

create or replace function private.request_legislative_update_reprocess(
  p_update_id uuid, p_actor_user_id uuid, p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_update public.updates_legislativos%rowtype;
  v_request private.legislative_update_reprocess_requests%rowtype;
begin
  perform private.assert_update_editor_identity();
  if not exists (
    select 1 from public.usuarios_perfil p where p.user_id = p_actor_user_id
      and p.account_status = 'active' and p.papel in ('curador', 'administrador')
  ) then
    raise exception using errcode = '42501', message = 'active legal editor required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'reprocess request identity required';
  end if;
  select * into v_update from public.updates_legislativos where id = p_update_id for update;
  if not found then
    raise exception using errcode = '55000', message = 'update cannot be reprocessed';
  end if;
  select * into v_request from private.legislative_update_reprocess_requests
    where request_id = p_request_id;
  if found then
    if v_request.update_id <> p_update_id or v_request.actor_user_id is distinct from p_actor_user_id then
      raise exception using errcode = '22023', message = 'reprocess request identity conflict';
    end if;
  else
    if v_update.update_review_status not in ('rejected', 'error') then
      raise exception using errcode = '55000', message = 'update cannot be reprocessed';
    end if;
    if exists (select 1 from private.legislative_update_reprocess_requests
      where request_id = v_update.reprocess_request_id and outcome is null) then
      raise exception using errcode = '55000', message = 'reprocess request already in progress';
    end if;
    update public.updates_legislativos set retry_count = retry_count + 1,
      reprocess_request_id = p_request_id, reprocess_requested_at = pg_catalog.now(),
      reprocess_claimed_at = null where id = p_update_id returning * into v_update;
    insert into private.legislative_update_reprocess_requests
      (request_id, update_id, actor_user_id, retry_count, requested_at)
      values (p_request_id, p_update_id, p_actor_user_id, v_update.retry_count,
        v_update.reprocess_requested_at) returning * into v_request;
    insert into private.legislative_update_events
      (update_id, event_type, actor_user_id, reprocess_request_id)
      values (p_update_id, 'reprocess_requested', p_actor_user_id, p_request_id);
  end if;
  return pg_catalog.jsonb_build_object('updateId', v_update.id,
    'updateReviewStatus', v_update.update_review_status, 'publicationId', v_update.publication_id,
    'retryCount', v_request.retry_count, 'reprocessRequested', true);
end
$function$;
alter function private.request_legislative_update_reprocess(uuid, uuid, uuid) owner to lex_update_owner;
revoke all on function private.request_legislative_update_reprocess(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.request_legislative_update_reprocess(uuid, uuid, uuid) to lex_update_editor;

-- Compatibility callers reuse pending/in-flight work; an explicit request ID
-- additionally makes a retry safe after the response or terminal was lost.
create or replace function private.request_legislative_update_reprocess(p_update_id uuid, p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_request_id uuid;
begin
  perform private.assert_update_editor_identity();
  perform 1 from public.updates_legislativos where id = p_update_id for update;
  select request.request_id into v_request_id
    from private.legislative_update_reprocess_requests request
    join public.updates_legislativos update on update.reprocess_request_id = request.request_id
    where update.id = p_update_id and request.outcome is null;
  return private.request_legislative_update_reprocess(
    p_update_id, p_actor_user_id, coalesce(v_request_id, pg_catalog.gen_random_uuid()));
end
$function$;

create or replace function private.claim_legislative_update_reprocess_requests(p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_result jsonb;
begin
  perform private.assert_update_worker_identity();
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'invalid claim size';
  end if;
  with claimed as (
    select update.id from public.updates_legislativos update
    join private.legislative_update_reprocess_requests request
      on request.request_id = update.reprocess_request_id
    where request.outcome is null and request.claimed_at is null
    order by request.requested_at, update.id for update of update skip locked limit p_limit
  ), updated as (
    update public.updates_legislativos update set reprocess_claimed_at = pg_catalog.now()
    from claimed where update.id = claimed.id
    returning update.id, update.lei_id, update.reprocess_request_id
  ), requests as (
    update private.legislative_update_reprocess_requests request set claimed_at = pg_catalog.now()
    from updated where request.request_id = updated.reprocess_request_id returning request.request_id
  ), events as (
    insert into private.legislative_update_events (update_id, event_type, reprocess_request_id)
    select id, 'reprocess_claimed', reprocess_request_id from updated returning update_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'updateId', id, 'lawId', lei_id, 'requestId', reprocess_request_id)), '[]'::jsonb)
    into v_result from updated;
  return v_result;
end
$function$;

create or replace function private.complete_legislative_update_reprocess(
  p_update_id uuid, p_request_id uuid, p_outcome text, p_detail_code text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
begin
  perform private.assert_update_worker_identity();
  if p_outcome is null or p_outcome not in ('completed', 'failed')
    or (p_detail_code is not null and p_detail_code !~ '^[A-Z][A-Z0-9_]{2,79}$') then
    raise exception using errcode = '22023', message = 'invalid reprocess result';
  end if;
  perform 1 from public.updates_legislativos where id = p_update_id
    and reprocess_request_id = p_request_id for update;
  if not found then return pg_catalog.jsonb_build_object('recorded', false); end if;
  update private.legislative_update_reprocess_requests set outcome = p_outcome
    where request_id = p_request_id and update_id = p_update_id
      and claimed_at is not null and outcome is null;
  if not found then return pg_catalog.jsonb_build_object('recorded', false); end if;
  insert into private.legislative_update_events (update_id, event_type, detail_code, reprocess_request_id)
    values (p_update_id, 'reprocess_' || p_outcome, p_detail_code, p_request_id);
  update public.updates_legislativos set reprocess_requested_at = null, reprocess_claimed_at = null
    where id = p_update_id;
  return pg_catalog.jsonb_build_object('recorded', true);
end
$function$;
alter function private.complete_legislative_update_reprocess(uuid, uuid, text, text) owner to lex_update_owner;
revoke all on function private.complete_legislative_update_reprocess(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.complete_legislative_update_reprocess(uuid, uuid, text, text) to lex_update_worker;
-- A completion without the claimed identity cannot safely distinguish attempts.
revoke all on function private.complete_legislative_update_reprocess(uuid, text, text) from lex_update_worker;

-- Feature 013: bridge read-only entre um claim de atualização e a configuração
-- ativa do catálogo. Não cria source_check_job e não altera a saúde da fonte.

create or replace function private.get_legislative_update_reprocess_context(
  p_update_id uuid,
  p_law_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  perform private.assert_update_worker_identity();
  select pg_catalog.jsonb_build_object(
    'baseVersionId', update.base_versao_id,
    'claimedAt', request.claimed_at
  ) into v_context
  from public.updates_legislativos update
  join private.legislative_update_reprocess_requests request
    on request.request_id = update.reprocess_request_id
  join public.leis law on law.id = update.lei_id
  where update.id = p_update_id
    and update.lei_id = p_law_id
    and update.update_review_status in ('rejected', 'error')
    and request.request_id = p_request_id
    and request.claimed_at is not null and request.outcome is null
    and law.versao_publicada_id = update.base_versao_id;
  if v_context is null then
    raise exception using errcode = '55000', message = 'reprocess claim is unavailable or stale';
  end if;
  return v_context;
end
$function$;

alter function private.get_legislative_update_reprocess_context(uuid, uuid, uuid)
  owner to lex_update_owner;
revoke all on function private.get_legislative_update_reprocess_context(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.get_legislative_update_reprocess_context(uuid, uuid, uuid)
  to lex_source_catalog_owner;

create or replace function private.materialize_legislative_update_reprocess_job(
  p_update_id uuid,
  p_law_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_job jsonb;
begin
  -- The nested function is owned by the update boundary and checks the worker
  -- identity, keeping direct reads of the update queue out of this boundary.
  v_context := private.get_legislative_update_reprocess_context(p_update_id, p_law_id, p_request_id);

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'sourceCheckJobId', p_request_id,
    'bindingId', binding.binding_id,
    'bindingRevisionId', revision.binding_revision_id,
    'providerRevisionId', provider_revision.provider_revision_id,
    'lawId', p_law_id,
    'baseVersionId', v_context ->> 'baseVersionId',
    'sourceCheckTrigger', 'manual',
    'sourceCheckJobState', 'running',
    'idempotencyKey', 'reprocess:' || p_request_id::text,
    'requestedAt', v_context ->> 'claimedAt',
    'claimedAt', v_context ->> 'claimedAt',
    'providerRevision', pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'providerRevisionId', provider_revision.provider_revision_id,
      'providerId', provider_revision.provider_id,
      'revisionNumber', provider_revision.revision_number,
      'providerKey', provider_revision.provider_key,
      'providerName', provider_revision.provider_name,
      'sourceType', provider_revision.source_type,
      'adapterId', provider_revision.adapter_id,
      'adapterContractVersion', provider_revision.adapter_contract_version,
      'origin', pg_catalog.jsonb_build_object(
        'scheme', provider_revision.origin_scheme,
        'host', provider_revision.origin_host,
        'port', provider_revision.origin_port,
        'pathPrefix', provider_revision.origin_path_prefix
      ),
      'detectionParameters', provider_revision.detection_parameters,
      'configDigest', provider_revision.config_digest,
      'createdByUserId', provider_revision.created_by_user_id,
      'createdAt', provider_revision.created_at
    ),
    'bindingRevision', pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'bindingRevisionId', revision.binding_revision_id,
      'bindingId', revision.binding_id,
      'lawId', revision.law_id,
      'providerRevisionId', revision.provider_revision_id,
      'revisionNumber', revision.revision_number,
      'artifacts', (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'order', artifact.artifact_order,
          'sourceRole', artifact.source_role,
          'sourceVariant', artifact.source_variant,
          'sourceUrl', artifact.source_url
        ) order by artifact.artifact_order)
        from private.law_source_binding_artifacts artifact
        where artifact.binding_revision_id = revision.binding_revision_id
      ),
      'monitoringIntervalMs', revision.monitoring_interval_ms,
      'configDigest', revision.config_digest,
      'createdByUserId', revision.created_by_user_id,
      'createdAt', revision.created_at
    ),
    'health', pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'bindingId', health.binding_id,
      'bindingRevisionId', health.binding_revision_id,
      'sourceHealthState', health.source_health_state,
      'nextCheckAt', health.next_check_at,
      'consecutiveFailures', health.consecutive_failures,
      'nextRetryAt', health.next_retry_at,
      'suspendedUntil', health.suspended_until,
      'lastErrorCode', health.last_error_code,
      'lastCheckedAt', health.last_checked_at,
      'updatedAt', health.updated_at
    )
  ) into v_job
  from private.law_source_bindings binding
  join private.law_source_binding_revisions revision
    on revision.binding_revision_id = binding.active_binding_revision_id
  join private.source_providers provider
    on provider.active_provider_revision_id = revision.provider_revision_id
  join private.source_provider_revisions provider_revision
    on provider_revision.provider_revision_id = revision.provider_revision_id
  join private.source_binding_health health
    on health.binding_id = binding.binding_id
  where binding.law_id = p_law_id
    and binding.source_activation_state = 'active'
    and provider.source_activation_state = 'active'
    and health.binding_revision_id = revision.binding_revision_id;
  if v_job is null then
    raise exception using errcode = '55000', message = 'active source configuration unavailable';
  end if;
  return v_job;
end
$function$;

alter function private.materialize_legislative_update_reprocess_job(uuid, uuid, uuid)
  owner to lex_source_catalog_owner;
revoke all on function private.materialize_legislative_update_reprocess_job(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.materialize_legislative_update_reprocess_job(uuid, uuid, uuid)
  to lex_update_worker;

revoke all on function private.materialize_legislative_update_reprocess_job(uuid, uuid) from lex_update_worker;
revoke all on function private.get_legislative_update_reprocess_context(uuid, uuid) from lex_source_catalog_owner;
