\set ON_ERROR_STOP on

create role source_catalog_admin_test login;
create role source_catalog_worker_test login;
create role source_catalog_importer_test login;
create role source_catalog_unauthorized_test login;
grant lex_source_catalog_admin to source_catalog_admin_test;
grant lex_source_catalog_worker to source_catalog_worker_test;
grant lex_source_catalog_importer to source_catalog_importer_test;

insert into auth.users (id)
values ('aaaaaaaa-0000-4000-8000-000000000001');
insert into public.usuarios_perfil (user_id, account_status, papel)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'active', 'administrador');

set session authorization source_catalog_admin_test;

select private.append_source_provider_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  0,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'providerRevisionId', 'aaaaaaaa-1000-4000-8000-000000000001',
    'providerId', 'aaaaaaaa-2000-4000-8000-000000000001',
    'revisionNumber', 1,
    'providerKey', 'planalto-oficial',
    'providerName', 'Portal da Legislacao do Planalto',
    'sourceType', 'planalto_html',
    'adapterId', 'planalto.html',
    'adapterContractVersion', 1,
    'origin', pg_catalog.jsonb_build_object(
      'scheme', 'https', 'host', 'www.planalto.gov.br',
      'port', null, 'pathPrefix', '/ccivil_03/'
    ),
    'detectionParameters', pg_catalog.jsonb_build_object('requireLegalHeader', true),
    'configDigest', pg_catalog.repeat('a', 64),
    'createdByUserId', 'aaaaaaaa-0000-4000-8000-000000000001',
    'createdAt', '2026-08-13T12:00:00.000Z'
  )
);

select private.append_source_provider_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  1,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'providerRevisionId', 'aaaaaaaa-1000-4000-8000-000000000002',
    'providerId', 'aaaaaaaa-2000-4000-8000-000000000001',
    'revisionNumber', 2,
    'providerKey', 'planalto-oficial',
    'providerName', 'Portal da Legislacao do Planalto',
    'sourceType', 'planalto_html',
    'adapterId', 'planalto.html',
    'adapterContractVersion', 1,
    'origin', pg_catalog.jsonb_build_object(
      'scheme', 'https', 'host', 'www.planalto.gov.br',
      'port', null, 'pathPrefix', '/ccivil_03/'
    ),
    'detectionParameters', pg_catalog.jsonb_build_object('requireLegalHeader', true),
    'configDigest', pg_catalog.repeat('b', 64),
    'createdByUserId', 'aaaaaaaa-0000-4000-8000-000000000001',
    'createdAt', '2026-08-13T12:01:00.000Z'
  )
);

select private.append_law_source_binding_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  0,
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'bindingRevisionId', 'bbbbbbbb-1000-4000-8000-000000000001',
    'bindingId', 'bbbbbbbb-2000-4000-8000-000000000001',
    'lawId', '33333333-3333-4333-8333-333333333333',
    'providerRevisionId', 'aaaaaaaa-1000-4000-8000-000000000002',
    'revisionNumber', 1,
    'monitoringIntervalMs', 86400000,
    'configDigest', pg_catalog.repeat('c', 64),
    'createdByUserId', 'aaaaaaaa-0000-4000-8000-000000000001',
    'createdAt', '2026-08-13T12:02:00.000Z',
    'artifacts', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'order', 0,
        'sourceRole', 'primary_current',
        'sourceVariant', 'compiled',
        'sourceUrl', 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm'
      ),
      pg_catalog.jsonb_build_object(
        'order', 1,
        'sourceRole', 'historical_auxiliary',
        'sourceVariant', 'annotated',
        'sourceUrl', 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm'
      )
    )
  )
);

select private.get_source_catalog_provider_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002'
);
select private.get_source_catalog_test_configuration(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002',
  'bbbbbbbb-1000-4000-8000-000000000001'
);

select private.append_source_test_evidence(
  'aaaaaaaa-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'testEvidenceId', 'cccccccc-1000-4000-8000-000000000001',
    'providerRevisionId', 'aaaaaaaa-1000-4000-8000-000000000002',
    'bindingRevisionId', 'bbbbbbbb-1000-4000-8000-000000000001',
    'providerConfigDigest', pg_catalog.repeat('b', 64),
    'bindingConfigDigest', pg_catalog.repeat('c', 64),
    'adapterId', 'planalto.html',
    'adapterContractVersion', 1,
    'sourceTestOutcome', 'success',
    'completedStage', 'adapter',
    'evidenceDigest', pg_catalog.repeat('d', 64),
    'errorCode', null,
    'testedByUserId', 'aaaaaaaa-0000-4000-8000-000000000001',
    'testedAt', '2026-08-13T12:03:00.000Z'
  )
);

select private.append_source_test_evidence(
  'aaaaaaaa-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'testEvidenceId', 'cccccccc-1000-4000-8000-000000000003',
    'providerRevisionId', 'aaaaaaaa-1000-4000-8000-000000000002',
    'bindingRevisionId', 'bbbbbbbb-1000-4000-8000-000000000001',
    'providerConfigDigest', pg_catalog.repeat('b', 64),
    'bindingConfigDigest', pg_catalog.repeat('c', 64),
    'adapterId', 'planalto.html',
    'adapterContractVersion', 1,
    'sourceTestOutcome', 'success',
    'completedStage', 'adapter',
    'evidenceDigest', pg_catalog.repeat('f', 64),
    'errorCode', null,
    'testedByUserId', 'aaaaaaaa-0000-4000-8000-000000000001',
    'testedAt', '2026-08-13T12:05:00.000Z'
  )
);

select private.append_source_test_evidence(
  'aaaaaaaa-0000-4000-8000-000000000001',
  pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'testEvidenceId', 'cccccccc-1000-4000-8000-000000000002',
    'providerRevisionId', 'aaaaaaaa-1000-4000-8000-000000000002',
    'bindingRevisionId', 'bbbbbbbb-1000-4000-8000-000000000001',
    'providerConfigDigest', pg_catalog.repeat('b', 64),
    'bindingConfigDigest', pg_catalog.repeat('c', 64),
    'adapterId', 'planalto.html',
    'adapterContractVersion', 1,
    'sourceTestOutcome', 'failure',
    'completedStage', 'network',
    'evidenceDigest', pg_catalog.repeat('e', 64),
    'errorCode', 'SOURCE_TIMEOUT',
    'testedByUserId', 'aaaaaaaa-0000-4000-8000-000000000001',
    'testedAt', '2026-08-13T12:04:00.000Z'
  )
);

do $negative_paths$
begin
  begin
    perform private.activate_law_source_binding_revision(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-2000-4000-8000-000000000001',
      'aaaaaaaa-1000-4000-8000-000000000002',
      2,
      'bbbbbbbb-2000-4000-8000-000000000001',
      'bbbbbbbb-1000-4000-8000-000000000001',
      1,
      'cccccccc-1000-4000-8000-000000000001'
    );
    raise exception 'stale successful evidence activated a binding';
  exception when serialization_failure then
    null;
  end;

  begin
    perform private.activate_law_source_binding_revision(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-2000-4000-8000-000000000001',
      'aaaaaaaa-1000-4000-8000-000000000002',
      2,
      'bbbbbbbb-2000-4000-8000-000000000001',
      'bbbbbbbb-1000-4000-8000-000000000001',
      1,
      'cccccccc-1000-4000-8000-000000000099'
    );
    raise exception 'untested binding revision was activated';
  exception when serialization_failure then
    null;
  end;

  begin
    perform private.activate_law_source_binding_revision(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-2000-4000-8000-000000000001',
      'aaaaaaaa-1000-4000-8000-000000000002',
      2,
      'bbbbbbbb-2000-4000-8000-000000000001',
      'bbbbbbbb-1000-4000-8000-000000000001',
      1,
      'cccccccc-1000-4000-8000-000000000002'
    );
    raise exception 'failed test evidence activated a binding';
  exception when serialization_failure then
    null;
  end;

  begin
    perform private.append_source_provider_revision(
      'aaaaaaaa-0000-4000-8000-000000000001',
      0,
      pg_catalog.jsonb_build_object(
        'providerRevisionId', 'aaaaaaaa-1000-4000-8000-000000000003',
        'providerId', 'aaaaaaaa-2000-4000-8000-000000000001',
        'providerKey', 'planalto-oficial',
        'revisionNumber', 1,
        'createdByUserId', 'aaaaaaaa-0000-4000-8000-000000000001'
      )
    );
    raise exception 'stale provider lock version was accepted';
  exception when serialization_failure then
    null;
  end;

  begin
    perform private.append_source_test_evidence(
      '44444444-4444-4444-8444-444444444444',
      '{}'::jsonb
    );
    raise exception 'curator profile received source catalog authority';
  exception when insufficient_privilege then
    null;
  end;
end
$negative_paths$;

select private.activate_law_source_binding_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002',
  2,
  'bbbbbbbb-2000-4000-8000-000000000001',
  'bbbbbbbb-1000-4000-8000-000000000001',
  1,
  'cccccccc-1000-4000-8000-000000000003'
);

select private.list_source_catalog(
  'aaaaaaaa-0000-4000-8000-000000000001', null, 25
);

do $activation_conflict$
begin
  begin
    perform private.activate_law_source_binding_revision(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-2000-4000-8000-000000000001',
      'aaaaaaaa-1000-4000-8000-000000000002',
      2,
      'bbbbbbbb-2000-4000-8000-000000000001',
      'bbbbbbbb-1000-4000-8000-000000000001',
      1,
      'cccccccc-1000-4000-8000-000000000003'
    );
    raise exception 'stale activation lock versions were accepted';
  exception when serialization_failure then
    null;
  end;
end
$activation_conflict$;

reset session authorization;

set session authorization source_catalog_importer_test;
select private.resolve_active_source_import(
  'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm'
);
reset session authorization;

set session authorization source_catalog_admin_test;
select private.change_law_source_binding_activation(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-2000-4000-8000-000000000001', 2, 'paused'
);

do $paused_conflict$
begin
  begin
    perform private.change_law_source_binding_activation(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-2000-4000-8000-000000000001', 2, 'paused'
    );
    raise exception 'stale pause lock version was accepted';
  exception when serialization_failure then
    null;
  end;
end
$paused_conflict$;
reset session authorization;

set session authorization source_catalog_importer_test;
do $paused_not_resolved$
begin
  if private.resolve_active_source_import(
    'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm'
  ) is not null then
    raise exception 'paused binding was resolved for import';
  end if;
end
$paused_not_resolved$;
reset session authorization;

set session authorization source_catalog_admin_test;
select private.restore_law_source_binding_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002', 3,
  'bbbbbbbb-2000-4000-8000-000000000001',
  'bbbbbbbb-1000-4000-8000-000000000001', 3,
  'cccccccc-1000-4000-8000-000000000003'
);
select private.change_law_source_binding_activation(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-2000-4000-8000-000000000001', 4, 'archived'
);
reset session authorization;

set session authorization source_catalog_importer_test;
do $archived_not_resolved$
begin
  if private.resolve_active_source_import(
    'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm'
  ) is not null then
    raise exception 'archived binding was resolved for import';
  end if;
end
$archived_not_resolved$;
reset session authorization;

set session authorization source_catalog_admin_test;
select private.restore_law_source_binding_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002', 4,
  'bbbbbbbb-2000-4000-8000-000000000001',
  'bbbbbbbb-1000-4000-8000-000000000001', 5,
  'cccccccc-1000-4000-8000-000000000003'
);
reset session authorization;

set session authorization source_catalog_admin_test;
do $manual_check_deduplication$
declare
  v_first jsonb;
  v_same_key jsonb;
  v_open_job jsonb;
begin
  v_first := private.request_source_check(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-2000-4000-8000-000000000001',
    'verify-now:first', '2026-08-13T13:00:00.000Z'
  );
  v_same_key := private.request_source_check(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-2000-4000-8000-000000000001',
    'verify-now:first', '2026-08-13T13:00:01.000Z'
  );
  v_open_job := private.request_source_check(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-2000-4000-8000-000000000001',
    'verify-now:deduplicated-open-job', '2026-08-13T13:00:02.000Z'
  );
  if v_first ->> 'sourceCheckJobId' is distinct from v_same_key ->> 'sourceCheckJobId'
    or v_first ->> 'sourceCheckJobId' is distinct from v_open_job ->> 'sourceCheckJobId'
    or (v_first ->> 'deduplicated')::boolean
    or not (v_same_key ->> 'deduplicated')::boolean
    or not (v_open_job ->> 'deduplicated')::boolean
    or v_open_job ->> 'idempotencyKey' <> 'verify-now:first'
  then
    raise exception 'manual source check was not idempotent and deduplicated';
  end if;
end
$manual_check_deduplication$;
reset session authorization;

set session authorization source_catalog_worker_test;
select (
  private.claim_due_source_checks('2026-08-13T13:01:00.000Z', 25)
  -> 0 ->> 'sourceCheckJobId'
) as captured_running_job_id \gset
do $deduplicated_claim$
begin
  if private.claim_due_source_checks('2026-08-13T13:01:01.000Z', 25) <> '[]'::jsonb then
    raise exception 'a running source check was claimed twice';
  end if;
end
$deduplicated_claim$;
reset session authorization;

set session authorization source_catalog_admin_test;
select private.change_law_source_binding_activation(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-2000-4000-8000-000000000001', 6, 'paused'
);
reset session authorization;

set session authorization source_catalog_worker_test;
select private.complete_source_check(pg_catalog.jsonb_build_object(
  'sourceCheckJobId', :'captured_running_job_id',
  'sourceCheckJobState', 'completed',
  'detailCode', null,
  'completedAt', '2026-08-13T13:02:00.000Z',
  'health', pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'bindingId', 'bbbbbbbb-2000-4000-8000-000000000001',
    'bindingRevisionId', 'bbbbbbbb-1000-4000-8000-000000000001',
    'sourceHealthState', 'healthy',
    'nextCheckAt', '2026-08-14T13:02:00.000Z',
    'consecutiveFailures', 0,
    'nextRetryAt', null,
    'suspendedUntil', null,
    'lastErrorCode', null,
    'lastCheckedAt', '2026-08-13T13:02:00.000Z',
    'updatedAt', '2026-08-13T13:02:00.000Z'
  )
));
reset session authorization;

do $captured_job_survives_pause$
begin
  if not exists (
    select 1 from private.source_check_jobs
    where idempotency_key = 'verify-now:first'
      and source_check_job_state = 'completed'
      and binding_revision_id = 'bbbbbbbb-1000-4000-8000-000000000001'
      and provider_revision_id = 'aaaaaaaa-1000-4000-8000-000000000002'
      and base_version_id = (
        select versao_publicada_id from public.leis
        where id = '33333333-3333-4333-8333-333333333333'
      )
  ) or exists (
    select 1 from private.source_binding_health
    where binding_id = 'bbbbbbbb-2000-4000-8000-000000000001'
      and source_health_state = 'healthy'
  ) then
    raise exception 'pause invalidated a captured job or applied stale health';
  end if;
end
$captured_job_survives_pause$;

set session authorization source_catalog_admin_test;
select private.restore_law_source_binding_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002', 5,
  'bbbbbbbb-2000-4000-8000-000000000001',
  'bbbbbbbb-1000-4000-8000-000000000001', 7,
  'cccccccc-1000-4000-8000-000000000003'
);
select private.request_source_check(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-2000-4000-8000-000000000001',
  'verify-now:cancel-when-paused', '2026-08-13T13:03:00.000Z'
);
select private.change_law_source_binding_activation(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'bbbbbbbb-2000-4000-8000-000000000001', 8, 'paused'
);
reset session authorization;

set session authorization source_catalog_worker_test;
do $queued_job_cancelled_after_pause$
begin
  if private.claim_due_source_checks('2026-08-13T13:04:00.000Z', 25) <> '[]'::jsonb then
    raise exception 'paused binding created or retained a claimable queued job';
  end if;
end
$queued_job_cancelled_after_pause$;
reset session authorization;

do $queued_job_state$
begin
  if not exists (
    select 1 from private.source_check_jobs
    where idempotency_key = 'verify-now:cancel-when-paused'
      and source_check_job_state = 'cancelled'
      and detail_code = 'SOURCE_BINDING_INACTIVE'
  ) then
    raise exception 'paused queued job was not cancelled';
  end if;
end
$queued_job_state$;

set session authorization source_catalog_admin_test;
select private.restore_law_source_binding_revision(
  'aaaaaaaa-0000-4000-8000-000000000001',
  'aaaaaaaa-2000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002', 6,
  'bbbbbbbb-2000-4000-8000-000000000001',
  'bbbbbbbb-1000-4000-8000-000000000001', 9,
  'cccccccc-1000-4000-8000-000000000003'
);
reset session authorization;

do $health_backoff_suspension_and_recovery$
declare
  v_attempt integer;
  v_claim jsonb;
  v_completion jsonb;
  v_job_id uuid;
  v_now timestamptz := '2026-08-14T00:00:00.000Z';
  v_suspended_until timestamptz;
begin
  perform private.request_source_check(
    'aaaaaaaa-0000-4000-8000-000000000001',
    'bbbbbbbb-2000-4000-8000-000000000001',
    'verify-now:failure-cycle', v_now
  );
  for v_attempt in 1..5 loop
    v_claim := private.claim_due_source_checks(v_now, 25);
    if pg_catalog.jsonb_array_length(v_claim) <> 1 then
      raise exception 'due source check was not claimed at attempt %', v_attempt;
    end if;
    v_job_id := (v_claim -> 0 ->> 'sourceCheckJobId')::uuid;
    if v_claim -> 0 ->> 'bindingRevisionId' <> 'bbbbbbbb-1000-4000-8000-000000000001'
      or v_claim -> 0 ->> 'providerRevisionId' <> 'aaaaaaaa-1000-4000-8000-000000000002'
      or pg_catalog.jsonb_array_length(v_claim -> 0 -> 'bindingRevision' -> 'artifacts') <> 2
    then
      raise exception 'claim did not capture the complete active source revision';
    end if;
    if v_attempt = 5 then
      v_suspended_until := v_now + interval '6 hours';
    end if;
    v_completion := private.complete_source_check(pg_catalog.jsonb_build_object(
      'sourceCheckJobId', v_job_id,
      'sourceCheckJobState', 'failed',
      'detailCode', 'SOURCE_TIMEOUT',
      'completedAt', v_now,
      'health', pg_catalog.jsonb_build_object(
        'schemaVersion', 1,
        'bindingId', 'bbbbbbbb-2000-4000-8000-000000000001',
        'bindingRevisionId', 'bbbbbbbb-1000-4000-8000-000000000001',
        'sourceHealthState', case when v_attempt = 5 then 'suspended' else 'degraded' end,
        'nextCheckAt', v_now + interval '2 hours',
        'consecutiveFailures', v_attempt,
        'nextRetryAt', v_now + interval '2 hours',
        'suspendedUntil', v_suspended_until,
        'lastErrorCode', 'SOURCE_TIMEOUT',
        'lastCheckedAt', v_now,
        'updatedAt', v_now
      )
    ));
    if not (v_completion ->> 'healthApplied')::boolean then
      raise exception 'active revision health was not applied at attempt %', v_attempt;
    end if;
    v_now := v_now + interval '1 day';
  end loop;

  begin
    perform private.request_source_check(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-2000-4000-8000-000000000001',
      'verify-now:during-suspension', v_suspended_until - interval '1 hour'
    );
    raise exception 'manual check bypassed temporary suspension';
  exception when serialization_failure then
    null;
  end;
  if private.claim_due_source_checks(v_suspended_until - interval '1 second', 25) <> '[]'::jsonb then
    raise exception 'scheduler bypassed temporary suspension';
  end if;

  v_now := v_suspended_until + interval '1 second';
  v_claim := private.claim_due_source_checks(v_now, 25);
  if pg_catalog.jsonb_array_length(v_claim) <> 1 then
    raise exception 'source check did not resume after suspension';
  end if;
  v_job_id := (v_claim -> 0 ->> 'sourceCheckJobId')::uuid;
  v_completion := private.complete_source_check(pg_catalog.jsonb_build_object(
    'sourceCheckJobId', v_job_id,
    'sourceCheckJobState', 'completed',
    'detailCode', null,
    'completedAt', v_now,
    'health', pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'bindingId', 'bbbbbbbb-2000-4000-8000-000000000001',
      'bindingRevisionId', 'bbbbbbbb-1000-4000-8000-000000000001',
      'sourceHealthState', 'healthy',
      'nextCheckAt', v_now + interval '1 day',
      'consecutiveFailures', 0,
      'nextRetryAt', null,
      'suspendedUntil', null,
      'lastErrorCode', null,
      'lastCheckedAt', v_now,
      'updatedAt', v_now
    )
  ));
  if not (v_completion ->> 'healthApplied')::boolean then
    raise exception 'health recovery was not applied';
  end if;
end
$health_backoff_suspension_and_recovery$;

begin;
insert into public.leis (
  id, sigla, titulo, tipo, numero, ano, ramo, fonte_url, data_publicacao
) values (
  'dddddddd-0000-4000-8000-000000000001', 'duplicada', 'Lei duplicada para teste',
  'lei', '1', 2026, 'teste', 'https://example.invalid', '2026-08-13'
);
insert into private.law_source_bindings (
  binding_id, law_id, source_activation_state, lock_version
) values (
  'dddddddd-2000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000001', 'draft', 1
);
insert into private.law_source_binding_revisions (
  binding_revision_id, binding_id, law_id, provider_revision_id,
  revision_number, monitoring_interval_ms, config_digest,
  created_by_user_id, created_at
) values (
  'dddddddd-1000-4000-8000-000000000001',
  'dddddddd-2000-4000-8000-000000000001',
  'dddddddd-0000-4000-8000-000000000001',
  'aaaaaaaa-1000-4000-8000-000000000002',
  1, 86400000, pg_catalog.repeat('9', 64),
  'aaaaaaaa-0000-4000-8000-000000000001', '2026-08-13T12:10:00.000Z'
);
insert into private.law_source_binding_artifacts (
  binding_revision_id, artifact_order, source_role, source_variant, source_url
) values (
  'dddddddd-1000-4000-8000-000000000001', 0,
  'primary_current', 'compiled',
  'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm'
);
update private.law_source_bindings set
  active_binding_revision_id = 'dddddddd-1000-4000-8000-000000000001',
  source_activation_state = 'active'
where binding_id = 'dddddddd-2000-4000-8000-000000000001';

set session authorization source_catalog_importer_test;
do $ambiguous_import$
begin
  begin
    perform private.resolve_active_source_import(
      'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826compilado.htm'
    );
    raise exception 'ambiguous active source configuration was resolved';
  exception when cardinality_violation then
    null;
  end;
end
$ambiguous_import$;
reset session authorization;
rollback;

do $assertions$
declare
  v_binding private.law_source_bindings%rowtype;
  v_provider private.source_providers%rowtype;
  v_health private.source_binding_health%rowtype;
begin
  select * into v_provider from private.source_providers
  where provider_id = 'aaaaaaaa-2000-4000-8000-000000000001';
  select * into v_binding from private.law_source_bindings
  where binding_id = 'bbbbbbbb-2000-4000-8000-000000000001';
  select * into v_health from private.source_binding_health
  where binding_id = 'bbbbbbbb-2000-4000-8000-000000000001';

  if v_provider.active_provider_revision_id <> 'aaaaaaaa-1000-4000-8000-000000000002'
    or v_provider.source_activation_state <> 'active'
    or v_provider.lock_version <> 7
  then
    raise exception 'provider active pointer or optimistic lock is incorrect';
  end if;
  if v_binding.active_binding_revision_id <> 'bbbbbbbb-1000-4000-8000-000000000001'
    or v_binding.source_activation_state <> 'active'
    or v_binding.lock_version <> 10
  then
    raise exception 'binding active pointer or optimistic lock is incorrect';
  end if;
  if (select pg_catalog.count(*) from private.source_provider_revisions
      where provider_id = v_provider.provider_id) <> 2
  then
    raise exception 'immutable provider revision history was not preserved';
  end if;
  if v_health.source_health_state <> 'healthy'
    or v_health.consecutive_failures <> 0
    or v_health.next_retry_at is not null
    or v_health.suspended_until is not null
    or v_binding.source_activation_state <> 'active'
  then
    raise exception 'health was mixed with activation state';
  end if;
  if (select pg_catalog.count(*) from private.source_catalog_events) <> 15 then
    raise exception 'append-only source catalog audit is incomplete';
  end if;
  if not exists (
    select 1 from private.source_catalog_events
    where source_catalog_event_type = 'binding_activated'
      and binding_revision_id = v_binding.active_binding_revision_id
      and actor_user_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  ) then
    raise exception 'activation audit event is missing';
  end if;
  if not exists (
    select 1 from private.source_catalog_events
    where source_catalog_event_type = 'binding_paused'
  ) or not exists (
    select 1 from private.source_catalog_events
    where source_catalog_event_type = 'binding_archived'
  ) or (select pg_catalog.count(*) from private.source_catalog_events
        where source_catalog_event_type = 'binding_restored') <> 4
  then
    raise exception 'pause, archive or restore audit event is missing';
  end if;
  if (select pg_catalog.count(*) from private.source_check_jobs) <> 8
    or (select pg_catalog.count(*) from private.source_check_events) <> 21
    or (select pg_catalog.count(*) from private.source_check_events
        where source_check_event_type = 'check_failed') <> 5
    or (select pg_catalog.count(*) from private.source_check_events
        where source_check_event_type = 'health_degraded') <> 1
    or (select pg_catalog.count(*) from private.source_check_events
        where source_check_event_type = 'health_suspended') <> 1
    or (select pg_catalog.count(*) from private.source_check_events
        where source_check_event_type = 'health_recovered') <> 1
  then
    raise exception 'source check execution or health audit is incomplete';
  end if;

  if pg_catalog.has_table_privilege(
    'lex_source_catalog_admin', 'private.source_provider_revisions', 'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'lex_source_catalog_admin', 'private.law_source_binding_revisions', 'DELETE'
  ) or pg_catalog.has_table_privilege(
    'lex_source_catalog_worker', 'private.source_binding_health', 'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'lex_source_catalog_worker', 'public.leis', 'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'lex_source_catalog_worker', 'private.source_check_jobs', 'SELECT'
  ) or pg_catalog.has_table_privilege(
    'lex_source_catalog_admin', 'private.source_check_jobs', 'INSERT'
  ) then
    raise exception 'catalog roles received direct mutation authority';
  end if;
  if not pg_catalog.has_function_privilege(
    'lex_source_catalog_worker',
    'private.claim_due_source_checks(timestamp with time zone,integer)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'lex_source_catalog_worker', 'private.complete_source_check(jsonb)', 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'lex_source_catalog_admin',
    'private.request_source_check(uuid,uuid,text,timestamp with time zone)', 'EXECUTE'
  ) then
    raise exception 'worker minimum function grants are missing';
  end if;
  if not pg_catalog.has_function_privilege(
    'lex_source_catalog_importer', 'private.resolve_active_source_import(text)', 'EXECUTE'
  ) or pg_catalog.has_table_privilege(
    'lex_source_catalog_importer', 'private.law_source_binding_revisions', 'SELECT'
  ) then
    raise exception 'importer minimum authority is missing or excessive';
  end if;
  if pg_catalog.has_function_privilege(
    'lex_source_catalog_worker',
    'private.append_source_provider_revision(uuid,integer,jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_source_catalog_worker',
    'private.activate_law_source_binding_revision(uuid,uuid,uuid,integer,uuid,uuid,integer,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_source_catalog_worker',
    'private.get_source_catalog_test_configuration(uuid,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_source_catalog_admin',
    'private.claim_due_source_checks(timestamp with time zone,integer)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_source_catalog_worker',
    'private.request_source_check(uuid,uuid,text,timestamp with time zone)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_source_catalog_importer',
    'private.claim_due_source_checks(timestamp with time zone,integer)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'lex_source_catalog_importer',
    'private.activate_law_source_binding_revision(uuid,uuid,uuid,integer,uuid,uuid,integer,uuid)',
    'EXECUTE'
  ) then
    raise exception 'catalog authority crossed the admin/worker boundary';
  end if;
  if pg_catalog.has_function_privilege(
    'authenticated', 'private.append_source_provider_revision(uuid,integer,jsonb)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'private.request_source_check(uuid,uuid,text,timestamp with time zone)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'private.claim_due_source_checks(timestamp with time zone,integer)', 'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated', 'private.get_source_catalog_test_configuration(uuid,uuid,uuid)', 'EXECUTE'
  ) then
    raise exception 'generic authenticated role reached the catalog';
  end if;
end
$assertions$;
