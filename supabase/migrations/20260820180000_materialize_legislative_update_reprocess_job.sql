-- Feature 013: bridge read-only entre um claim de atualização e a configuração
-- ativa do catálogo. Não cria source_check_job e não altera a saúde da fonte.

create or replace function private.get_legislative_update_reprocess_context(
  p_update_id uuid,
  p_law_id uuid
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
    'claimedAt', update.reprocess_claimed_at
  ) into v_context
  from public.updates_legislativos update
  join public.leis law on law.id = update.lei_id
  where update.id = p_update_id
    and update.lei_id = p_law_id
    and update.update_review_status in ('rejected', 'error')
    and update.reprocess_claimed_at is not null
    and law.versao_publicada_id = update.base_versao_id;
  if v_context is null then
    raise exception using errcode = '55000', message = 'reprocess claim is unavailable or stale';
  end if;
  return v_context;
end
$function$;

alter function private.get_legislative_update_reprocess_context(uuid, uuid)
  owner to lex_update_owner;
revoke all on function private.get_legislative_update_reprocess_context(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.get_legislative_update_reprocess_context(uuid, uuid)
  to lex_source_catalog_owner;

create or replace function private.materialize_legislative_update_reprocess_job(
  p_update_id uuid,
  p_law_id uuid
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
  v_context := private.get_legislative_update_reprocess_context(p_update_id, p_law_id);

  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'sourceCheckJobId', p_update_id,
    'bindingId', binding.binding_id,
    'bindingRevisionId', revision.binding_revision_id,
    'providerRevisionId', provider_revision.provider_revision_id,
    'lawId', p_law_id,
    'baseVersionId', v_context ->> 'baseVersionId',
    'sourceCheckTrigger', 'manual',
    'sourceCheckJobState', 'running',
    'idempotencyKey', 'reprocess:' || p_update_id::text,
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

alter function private.materialize_legislative_update_reprocess_job(uuid, uuid)
  owner to lex_source_catalog_owner;
revoke all on function private.materialize_legislative_update_reprocess_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.materialize_legislative_update_reprocess_job(uuid, uuid)
  to lex_update_worker;
