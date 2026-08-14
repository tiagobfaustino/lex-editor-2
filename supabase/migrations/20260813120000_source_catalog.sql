-- Feature 011: catálogo versionado de fontes oficiais e autoridades separadas.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_source_catalog_owner') then
    create role lex_source_catalog_owner nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_source_catalog_admin') then
    create role lex_source_catalog_admin nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_source_catalog_worker') then
    create role lex_source_catalog_worker nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_source_catalog_importer') then
    create role lex_source_catalog_importer nologin noinherit;
  end if;
end
$roles$;

grant lex_source_catalog_owner, lex_source_catalog_admin, lex_source_catalog_worker,
  lex_source_catalog_importer to postgres;
grant usage on schema private
  to lex_source_catalog_owner, lex_source_catalog_admin, lex_source_catalog_worker,
  lex_source_catalog_importer;

create table private.source_providers (
  provider_id uuid primary key,
  provider_key text not null unique check (provider_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  active_provider_revision_id uuid,
  source_activation_state text not null default 'draft' check (
    source_activation_state in ('draft', 'active', 'paused', 'archived')
  ),
  lock_version integer not null default 0 check (lock_version >= 0),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table private.source_provider_revisions (
  provider_revision_id uuid primary key,
  provider_id uuid not null references private.source_providers(provider_id),
  revision_number integer not null check (revision_number > 0),
  provider_key text not null check (provider_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  provider_name text not null check (pg_catalog.length(pg_catalog.btrim(provider_name)) between 3 and 160),
  source_type text not null check (source_type in ('planalto_html', 'lexml_xml')),
  adapter_id text not null check (adapter_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  adapter_contract_version integer not null check (adapter_contract_version between 1 and 1000000),
  origin_scheme text not null check (origin_scheme in ('http', 'https')),
  origin_host text not null check (
    origin_host = pg_catalog.lower(origin_host)
    and pg_catalog.length(origin_host) between 1 and 253
    and pg_catalog.strpos(origin_host, '*') = 0
  ),
  origin_port integer check (origin_port between 1 and 65535),
  origin_path_prefix text not null check (
    pg_catalog.length(origin_path_prefix) between 1 and 1024
    and pg_catalog.left(origin_path_prefix, 1) = '/'
    and pg_catalog.strpos(origin_path_prefix, '?') = 0
    and pg_catalog.strpos(origin_path_prefix, '#') = 0
  ),
  detection_parameters jsonb not null default '{}'::jsonb check (
    pg_catalog.jsonb_typeof(detection_parameters) = 'object'
    and pg_catalog.jsonb_array_length(
      pg_catalog.jsonb_path_query_array(detection_parameters, '$.*')
    ) <= 32
  ),
  config_digest text not null check (config_digest ~ '^[0-9a-f]{64}$'),
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null,
  unique (provider_id, revision_number),
  unique (provider_id, config_digest),
  unique (provider_revision_id, provider_id)
);

alter table private.source_providers add constraint source_providers_active_revision_fk
  foreign key (active_provider_revision_id, provider_id)
  references private.source_provider_revisions(provider_revision_id, provider_id);

create table private.law_source_bindings (
  binding_id uuid primary key,
  law_id uuid not null unique references public.leis(id) on delete cascade,
  active_binding_revision_id uuid,
  source_activation_state text not null default 'draft' check (
    source_activation_state in ('draft', 'active', 'paused', 'archived')
  ),
  lock_version integer not null default 0 check (lock_version >= 0),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table private.law_source_binding_revisions (
  binding_revision_id uuid primary key,
  binding_id uuid not null references private.law_source_bindings(binding_id),
  law_id uuid not null references public.leis(id) on delete cascade,
  provider_revision_id uuid not null references private.source_provider_revisions(provider_revision_id),
  revision_number integer not null check (revision_number > 0),
  monitoring_interval_ms bigint not null check (
    monitoring_interval_ms between 3600000 and 2678400000
  ),
  config_digest text not null check (config_digest ~ '^[0-9a-f]{64}$'),
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null,
  unique (binding_id, revision_number),
  unique (binding_id, config_digest),
  unique (binding_revision_id, binding_id),
  unique (binding_revision_id, law_id)
);

alter table private.law_source_bindings add constraint law_source_bindings_active_revision_fk
  foreign key (active_binding_revision_id, binding_id)
  references private.law_source_binding_revisions(binding_revision_id, binding_id);

create table private.law_source_binding_artifacts (
  binding_revision_id uuid not null
    references private.law_source_binding_revisions(binding_revision_id) on delete restrict,
  artifact_order integer not null check (artifact_order >= 0),
  source_role text not null check (
    source_role in ('primary_current', 'historical_auxiliary', 'cross_check')
  ),
  source_variant text not null check (source_variant in ('compiled', 'annotated', 'other')),
  source_url text not null check (pg_catalog.length(source_url) between 1 and 2048),
  primary key (binding_revision_id, artifact_order),
  unique (binding_revision_id, source_url)
);

create unique index law_source_binding_one_primary
  on private.law_source_binding_artifacts(binding_revision_id)
  where source_role = 'primary_current';

create table private.source_test_evidence (
  test_evidence_id uuid primary key,
  provider_revision_id uuid not null references private.source_provider_revisions(provider_revision_id),
  binding_revision_id uuid not null references private.law_source_binding_revisions(binding_revision_id),
  provider_config_digest text not null check (provider_config_digest ~ '^[0-9a-f]{64}$'),
  binding_config_digest text not null check (binding_config_digest ~ '^[0-9a-f]{64}$'),
  adapter_id text not null,
  adapter_contract_version integer not null check (adapter_contract_version between 1 and 1000000),
  source_test_outcome text not null check (source_test_outcome in ('success', 'failure')),
  completed_stage text not null check (completed_stage in ('policy', 'network', 'detection', 'adapter')),
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  tested_by_user_id uuid not null references auth.users(id),
  tested_at timestamptz not null,
  check (
    (source_test_outcome = 'success' and error_code is null)
    or (source_test_outcome = 'failure' and error_code is not null)
  )
);

create table private.source_binding_health (
  binding_id uuid primary key references private.law_source_bindings(binding_id) on delete cascade,
  binding_revision_id uuid not null,
  source_health_state text not null default 'unknown' check (
    source_health_state in ('unknown', 'healthy', 'degraded', 'suspended')
  ),
  next_check_at timestamptz not null,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  next_retry_at timestamptz,
  suspended_until timestamptz,
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,79}$'
  ),
  last_checked_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  foreign key (binding_revision_id, binding_id)
    references private.law_source_binding_revisions(binding_revision_id, binding_id)
);

create table private.source_check_jobs (
  source_check_job_id uuid primary key,
  binding_id uuid not null references private.law_source_bindings(binding_id),
  binding_revision_id uuid not null,
  provider_revision_id uuid not null references private.source_provider_revisions(provider_revision_id),
  law_id uuid not null references public.leis(id),
  base_version_id uuid not null references public.versoes_lei(id),
  source_check_trigger text not null check (source_check_trigger in ('scheduled', 'manual')),
  source_check_job_state text not null check (
    source_check_job_state in ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  idempotency_key text not null unique check (pg_catalog.length(idempotency_key) between 1 and 200),
  requested_by_user_id uuid references auth.users(id),
  requested_at timestamptz not null,
  claimed_at timestamptz,
  completed_at timestamptz,
  detail_code text check (detail_code is null or detail_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  foreign key (binding_revision_id, binding_id)
    references private.law_source_binding_revisions(binding_revision_id, binding_id),
  check (
    (source_check_trigger = 'manual' and requested_by_user_id is not null)
    or (source_check_trigger = 'scheduled' and requested_by_user_id is null)
  ),
  check (
    (source_check_job_state = 'queued' and claimed_at is null and completed_at is null)
    or (source_check_job_state = 'running' and claimed_at is not null and completed_at is null)
    or (source_check_job_state in ('completed', 'failed', 'cancelled') and completed_at is not null)
  )
);

create unique index source_check_one_open_job_per_binding
  on private.source_check_jobs(binding_id)
  where source_check_job_state in ('queued', 'running');

create table private.source_check_events (
  source_check_event_id bigint generated always as identity primary key,
  source_check_job_id uuid not null references private.source_check_jobs(source_check_job_id),
  binding_id uuid not null,
  binding_revision_id uuid not null,
  source_check_event_type text not null check (source_check_event_type in (
    'check_requested', 'check_claimed', 'check_completed', 'check_failed',
    'check_cancelled', 'health_degraded', 'health_suspended', 'health_recovered'
  )),
  actor_user_id uuid references auth.users(id),
  actor_role text not null check (actor_role in ('source_catalog_admin', 'source_catalog_worker')),
  detail_code text check (detail_code is null or detail_code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
  occurred_at timestamptz not null
);

create table private.source_catalog_events (
  event_id bigint generated always as identity primary key,
  source_catalog_event_type text not null check (source_catalog_event_type in (
    'provider_revision_created', 'binding_revision_created', 'test_recorded',
    'binding_activated', 'binding_paused', 'binding_archived', 'binding_restored'
  )),
  source_catalog_entity_type text not null check (
    source_catalog_entity_type in ('provider', 'binding')
  ),
  entity_id uuid not null,
  provider_revision_id uuid references private.source_provider_revisions(provider_revision_id),
  binding_revision_id uuid references private.law_source_binding_revisions(binding_revision_id),
  previous_revision_id uuid,
  actor_user_id uuid not null references auth.users(id),
  detail_code text check (detail_code is null or pg_catalog.length(detail_code) between 1 and 80),
  occurred_at timestamptz not null default pg_catalog.now()
);

alter table private.source_providers owner to lex_source_catalog_owner;
alter table private.source_provider_revisions owner to lex_source_catalog_owner;
alter table private.law_source_bindings owner to lex_source_catalog_owner;
alter table private.law_source_binding_revisions owner to lex_source_catalog_owner;
alter table private.law_source_binding_artifacts owner to lex_source_catalog_owner;
alter table private.source_test_evidence owner to lex_source_catalog_owner;
alter table private.source_binding_health owner to lex_source_catalog_owner;
alter table private.source_check_jobs owner to lex_source_catalog_owner;
alter table private.source_check_events owner to lex_source_catalog_owner;
alter table private.source_catalog_events owner to lex_source_catalog_owner;

revoke all on private.source_providers, private.source_provider_revisions,
  private.law_source_bindings, private.law_source_binding_revisions,
  private.law_source_binding_artifacts, private.source_test_evidence,
  private.source_binding_health, private.source_check_jobs, private.source_check_events,
  private.source_catalog_events
  from public, anon, authenticated, lex_source_catalog_admin, lex_source_catalog_worker,
  lex_source_catalog_importer;

grant select on public.usuarios_perfil, public.leis, public.versoes_lei
to lex_source_catalog_owner;

create or replace function private.assert_source_catalog_admin(p_actor_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_source_catalog_admin', 'USAGE') then
    raise exception using errcode = '42501', message = 'source catalog admin identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil
    where user_id = p_actor_user_id and account_status = 'active' and papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
end
$function$;

alter function private.assert_source_catalog_admin(uuid) owner to lex_source_catalog_owner;
revoke all on function private.assert_source_catalog_admin(uuid) from public, anon, authenticated;

create or replace function private.get_source_catalog_provider_revision(
  p_actor_user_id uuid,
  p_provider_revision_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_revision private.source_provider_revisions%rowtype;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  select * into v_revision
  from private.source_provider_revisions
  where provider_revision_id = p_provider_revision_id;
  if not found then
    raise exception using errcode = '22023', message = 'source provider revision not found';
  end if;
  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'providerRevisionId', v_revision.provider_revision_id,
    'providerId', v_revision.provider_id,
    'revisionNumber', v_revision.revision_number,
    'providerKey', v_revision.provider_key,
    'providerName', v_revision.provider_name,
    'sourceType', v_revision.source_type,
    'adapterId', v_revision.adapter_id,
    'adapterContractVersion', v_revision.adapter_contract_version,
    'origin', pg_catalog.jsonb_build_object(
      'scheme', v_revision.origin_scheme,
      'host', v_revision.origin_host,
      'port', v_revision.origin_port,
      'pathPrefix', v_revision.origin_path_prefix
    ),
    'detectionParameters', v_revision.detection_parameters,
    'configDigest', v_revision.config_digest,
    'createdByUserId', v_revision.created_by_user_id,
    'createdAt', v_revision.created_at
  );
end
$function$;

alter function private.get_source_catalog_provider_revision(uuid, uuid)
owner to lex_source_catalog_owner;
revoke all on function private.get_source_catalog_provider_revision(uuid, uuid)
from public, anon, authenticated;
grant execute on function private.get_source_catalog_provider_revision(uuid, uuid)
to lex_source_catalog_admin;

create or replace function private.get_source_catalog_test_configuration(
  p_actor_user_id uuid,
  p_provider_revision_id uuid,
  p_binding_revision_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider jsonb;
  v_binding private.law_source_binding_revisions%rowtype;
  v_artifacts jsonb;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  v_provider := private.get_source_catalog_provider_revision(
    p_actor_user_id,
    p_provider_revision_id
  );
  select * into v_binding
  from private.law_source_binding_revisions
  where binding_revision_id = p_binding_revision_id
    and provider_revision_id = p_provider_revision_id;
  if not found then
    raise exception using errcode = '22023', message = 'source binding revision not found';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'order', artifact.artifact_order,
        'sourceRole', artifact.source_role,
        'sourceVariant', artifact.source_variant,
        'sourceUrl', artifact.source_url
      ) order by artifact.artifact_order
    ),
    '[]'::jsonb
  ) into v_artifacts
  from private.law_source_binding_artifacts artifact
  where artifact.binding_revision_id = p_binding_revision_id;
  return pg_catalog.jsonb_build_object(
    'providerRevision', v_provider,
    'bindingRevision', pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'bindingRevisionId', v_binding.binding_revision_id,
      'bindingId', v_binding.binding_id,
      'lawId', v_binding.law_id,
      'providerRevisionId', v_binding.provider_revision_id,
      'revisionNumber', v_binding.revision_number,
      'artifacts', v_artifacts,
      'monitoringIntervalMs', v_binding.monitoring_interval_ms,
      'configDigest', v_binding.config_digest,
      'createdByUserId', v_binding.created_by_user_id,
      'createdAt', v_binding.created_at
    )
  );
end
$function$;

alter function private.get_source_catalog_test_configuration(uuid, uuid, uuid)
owner to lex_source_catalog_owner;
revoke all on function private.get_source_catalog_test_configuration(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function private.get_source_catalog_test_configuration(uuid, uuid, uuid)
to lex_source_catalog_admin;

create or replace function private.append_source_provider_revision(
  p_actor_user_id uuid,
  p_expected_lock_version integer,
  p_revision jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider_id uuid := (p_revision ->> 'providerId')::uuid;
  v_revision_id uuid := (p_revision ->> 'providerRevisionId')::uuid;
  v_provider private.source_providers%rowtype;
  v_revision private.source_provider_revisions%rowtype;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  if p_revision ->> 'createdByUserId' <> p_actor_user_id::text
    or (p_revision ->> 'revisionNumber')::integer <> p_expected_lock_version + 1
  then
    raise exception using errcode = '22023', message = 'invalid provider revision actor or number';
  end if;

  insert into private.source_providers (
    provider_id, provider_key, lock_version
  ) values (
    v_provider_id, p_revision ->> 'providerKey', 0
  ) on conflict (provider_id) do nothing;

  select * into v_provider from private.source_providers
  where provider_id = v_provider_id for update;
  if not found or v_provider.lock_version <> p_expected_lock_version
    or v_provider.provider_key <> p_revision ->> 'providerKey'
  then
    raise exception using errcode = '40001', message = 'source provider revision conflict';
  end if;

  insert into private.source_provider_revisions (
    provider_revision_id, provider_id, revision_number, provider_key, provider_name,
    source_type, adapter_id, adapter_contract_version, origin_scheme, origin_host,
    origin_port, origin_path_prefix, detection_parameters, config_digest,
    created_by_user_id, created_at
  ) values (
    v_revision_id, v_provider_id, (p_revision ->> 'revisionNumber')::integer,
    p_revision ->> 'providerKey', p_revision ->> 'providerName', p_revision ->> 'sourceType',
    p_revision ->> 'adapterId', (p_revision ->> 'adapterContractVersion')::integer,
    p_revision #>> '{origin,scheme}', p_revision #>> '{origin,host}',
    (p_revision #>> '{origin,port}')::integer, p_revision #>> '{origin,pathPrefix}',
    p_revision -> 'detectionParameters', p_revision ->> 'configDigest',
    p_actor_user_id, (p_revision ->> 'createdAt')::timestamptz
  ) returning * into v_revision;

  update private.source_providers set
    lock_version = lock_version + 1, updated_at = pg_catalog.now()
  where provider_id = v_provider_id returning * into v_provider;

  insert into private.source_catalog_events (
    source_catalog_event_type, source_catalog_entity_type, entity_id,
    provider_revision_id, actor_user_id
  ) values (
    'provider_revision_created', 'provider', v_provider_id, v_revision_id, p_actor_user_id
  );

  return pg_catalog.jsonb_build_object(
    'provider', pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'providerId', v_provider.provider_id,
      'providerKey', v_provider.provider_key,
      'activeProviderRevisionId', v_provider.active_provider_revision_id,
      'sourceActivationState', v_provider.source_activation_state,
      'lockVersion', v_provider.lock_version
    ),
    'revision', p_revision
  );
end
$function$;

alter function private.append_source_provider_revision(uuid, integer, jsonb)
  owner to lex_source_catalog_owner;
revoke all on function private.append_source_provider_revision(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function private.append_source_provider_revision(uuid, integer, jsonb)
  to lex_source_catalog_admin;

create or replace function private.append_law_source_binding_revision(
  p_actor_user_id uuid,
  p_expected_lock_version integer,
  p_revision jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_binding_id uuid := (p_revision ->> 'bindingId')::uuid;
  v_revision_id uuid := (p_revision ->> 'bindingRevisionId')::uuid;
  v_law_id uuid := (p_revision ->> 'lawId')::uuid;
  v_binding private.law_source_bindings%rowtype;
  v_primary_count integer;
  v_artifact jsonb;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  if p_revision ->> 'createdByUserId' <> p_actor_user_id::text
    or (p_revision ->> 'revisionNumber')::integer <> p_expected_lock_version + 1
    or pg_catalog.jsonb_typeof(p_revision -> 'artifacts') <> 'array'
    or pg_catalog.jsonb_array_length(p_revision -> 'artifacts') < 1
  then
    raise exception using errcode = '22023', message = 'invalid binding revision';
  end if;

  select pg_catalog.count(*) into v_primary_count
  from pg_catalog.jsonb_array_elements(p_revision -> 'artifacts') artifact
  where artifact ->> 'sourceRole' = 'primary_current';
  if v_primary_count <> 1 then
    raise exception using errcode = '22023', message = 'exactly one primary source required';
  end if;

  insert into private.law_source_bindings (binding_id, law_id, lock_version)
  values (v_binding_id, v_law_id, 0) on conflict (binding_id) do nothing;
  select * into v_binding from private.law_source_bindings
  where binding_id = v_binding_id for update;
  if not found or v_binding.lock_version <> p_expected_lock_version or v_binding.law_id <> v_law_id then
    raise exception using errcode = '40001', message = 'law source binding revision conflict';
  end if;

  insert into private.law_source_binding_revisions (
    binding_revision_id, binding_id, law_id, provider_revision_id, revision_number,
    monitoring_interval_ms, config_digest, created_by_user_id, created_at
  ) values (
    v_revision_id, v_binding_id, v_law_id, (p_revision ->> 'providerRevisionId')::uuid,
    (p_revision ->> 'revisionNumber')::integer,
    (p_revision ->> 'monitoringIntervalMs')::bigint, p_revision ->> 'configDigest',
    p_actor_user_id, (p_revision ->> 'createdAt')::timestamptz
  );

  for v_artifact in select value from pg_catalog.jsonb_array_elements(p_revision -> 'artifacts')
  loop
    insert into private.law_source_binding_artifacts (
      binding_revision_id, artifact_order, source_role, source_variant, source_url
    ) values (
      v_revision_id, (v_artifact ->> 'order')::integer,
      v_artifact ->> 'sourceRole', v_artifact ->> 'sourceVariant', v_artifact ->> 'sourceUrl'
    );
  end loop;

  update private.law_source_bindings set
    lock_version = lock_version + 1, updated_at = pg_catalog.now()
  where binding_id = v_binding_id returning * into v_binding;

  insert into private.source_catalog_events (
    source_catalog_event_type, source_catalog_entity_type, entity_id,
    binding_revision_id, actor_user_id
  ) values (
    'binding_revision_created', 'binding', v_binding_id, v_revision_id, p_actor_user_id
  );

  return pg_catalog.jsonb_build_object(
    'binding', pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'bindingId', v_binding.binding_id, 'lawId', v_binding.law_id,
      'activeBindingRevisionId', v_binding.active_binding_revision_id,
      'sourceActivationState', v_binding.source_activation_state,
      'lockVersion', v_binding.lock_version
    ),
    'revision', p_revision
  );
end
$function$;

alter function private.append_law_source_binding_revision(uuid, integer, jsonb)
  owner to lex_source_catalog_owner;
revoke all on function private.append_law_source_binding_revision(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function private.append_law_source_binding_revision(uuid, integer, jsonb)
  to lex_source_catalog_admin;

create or replace function private.append_source_test_evidence(
  p_actor_user_id uuid,
  p_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider private.source_provider_revisions%rowtype;
  v_binding private.law_source_binding_revisions%rowtype;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  if p_evidence ->> 'testedByUserId' <> p_actor_user_id::text then
    raise exception using errcode = '22023', message = 'invalid source test actor';
  end if;
  select * into v_provider from private.source_provider_revisions
  where provider_revision_id = (p_evidence ->> 'providerRevisionId')::uuid;
  if not found then
    raise exception using errcode = '22023', message = 'source test provider revision not found';
  end if;
  select * into v_binding from private.law_source_binding_revisions
  where binding_revision_id = (p_evidence ->> 'bindingRevisionId')::uuid;
  if not found then
    raise exception using errcode = '22023', message = 'source test binding revision not found';
  end if;
  if v_provider.config_digest <> p_evidence ->> 'providerConfigDigest'
    or v_binding.config_digest <> p_evidence ->> 'bindingConfigDigest'
    or v_binding.provider_revision_id <> v_provider.provider_revision_id
    or v_provider.adapter_id <> p_evidence ->> 'adapterId'
    or v_provider.adapter_contract_version <> (p_evidence ->> 'adapterContractVersion')::integer
  then
    raise exception using errcode = '22023', message = 'source test evidence does not match revisions';
  end if;

  insert into private.source_test_evidence (
    test_evidence_id, provider_revision_id, binding_revision_id,
    provider_config_digest, binding_config_digest, adapter_id,
    adapter_contract_version, source_test_outcome, completed_stage,
    evidence_digest, error_code, tested_by_user_id, tested_at
  ) values (
    (p_evidence ->> 'testEvidenceId')::uuid,
    (p_evidence ->> 'providerRevisionId')::uuid,
    (p_evidence ->> 'bindingRevisionId')::uuid,
    p_evidence ->> 'providerConfigDigest', p_evidence ->> 'bindingConfigDigest',
    p_evidence ->> 'adapterId', (p_evidence ->> 'adapterContractVersion')::integer,
    p_evidence ->> 'sourceTestOutcome', p_evidence ->> 'completedStage',
    p_evidence ->> 'evidenceDigest', p_evidence ->> 'errorCode',
    p_actor_user_id, (p_evidence ->> 'testedAt')::timestamptz
  );
  insert into private.source_catalog_events (
    source_catalog_event_type, source_catalog_entity_type, entity_id,
    provider_revision_id, binding_revision_id, actor_user_id,
    detail_code, occurred_at
  ) values (
    'test_recorded', 'binding', (p_evidence ->> 'bindingRevisionId')::uuid,
    (p_evidence ->> 'providerRevisionId')::uuid,
    (p_evidence ->> 'bindingRevisionId')::uuid, p_actor_user_id,
    p_evidence ->> 'errorCode', (p_evidence ->> 'testedAt')::timestamptz
  );
  return p_evidence;
end
$function$;

alter function private.append_source_test_evidence(uuid, jsonb) owner to lex_source_catalog_owner;
revoke all on function private.append_source_test_evidence(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.append_source_test_evidence(uuid, jsonb)
  to lex_source_catalog_admin;

create or replace function private.set_law_source_binding_revision(
  p_actor_user_id uuid,
  p_provider_id uuid,
  p_provider_revision_id uuid,
  p_expected_provider_lock_version integer,
  p_binding_id uuid,
  p_binding_revision_id uuid,
  p_expected_binding_lock_version integer,
  p_test_evidence_id uuid,
  p_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider private.source_providers%rowtype;
  v_binding private.law_source_bindings%rowtype;
  v_binding_revision private.law_source_binding_revisions%rowtype;
  v_previous_binding_revision_id uuid;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  if p_event_type not in ('binding_activated', 'binding_restored') then
    raise exception using errcode = '22023', message = 'invalid source catalog activation event';
  end if;
  select * into v_provider from private.source_providers
  where provider_id = p_provider_id for update;
  if not found then
    raise exception using errcode = '40001', message = 'source catalog provider not found';
  end if;
  select * into v_binding from private.law_source_bindings
  where binding_id = p_binding_id for update;
  if not found then
    raise exception using errcode = '40001', message = 'source catalog binding not found';
  end if;
  select * into v_binding_revision from private.law_source_binding_revisions
  where binding_revision_id = p_binding_revision_id and binding_id = p_binding_id;
  if not found then
    raise exception using errcode = '40001', message = 'source catalog binding revision not found';
  end if;
  if v_provider.lock_version <> p_expected_provider_lock_version
    or v_binding.lock_version <> p_expected_binding_lock_version
    or v_binding_revision.provider_revision_id <> p_provider_revision_id
    or not exists (
      select 1 from private.source_provider_revisions
      where provider_revision_id = p_provider_revision_id and provider_id = p_provider_id
    )
    or not exists (
      select 1 from private.source_test_evidence evidence
      where evidence.test_evidence_id = p_test_evidence_id
        and evidence.provider_revision_id = p_provider_revision_id
        and evidence.binding_revision_id = p_binding_revision_id
        and evidence.source_test_outcome = 'success'
        and evidence.adapter_id = (
          select adapter_id from private.source_provider_revisions
          where provider_revision_id = p_provider_revision_id
        )
        and not exists (
          select 1 from private.source_test_evidence newer
          where newer.provider_revision_id = evidence.provider_revision_id
            and newer.binding_revision_id = evidence.binding_revision_id
            and (
              newer.tested_at > evidence.tested_at
              or (
                newer.tested_at = evidence.tested_at
                and newer.test_evidence_id::text > evidence.test_evidence_id::text
              )
            )
        )
    )
  then
    raise exception using errcode = '40001', message = 'source catalog activation conflict';
  end if;

  v_previous_binding_revision_id := v_binding.active_binding_revision_id;

  update private.source_providers set
    active_provider_revision_id = p_provider_revision_id,
    source_activation_state = 'active', lock_version = lock_version + 1,
    updated_at = pg_catalog.now()
  where provider_id = p_provider_id returning * into v_provider;
  update private.law_source_bindings set
    active_binding_revision_id = p_binding_revision_id,
    source_activation_state = 'active', lock_version = lock_version + 1,
    updated_at = pg_catalog.now()
  where binding_id = p_binding_id returning * into v_binding;
  insert into private.source_binding_health (
    binding_id, binding_revision_id, source_health_state, next_check_at
  ) values (
    p_binding_id, p_binding_revision_id, 'unknown', pg_catalog.now()
  ) on conflict (binding_id) do update set
    binding_revision_id = excluded.binding_revision_id,
    source_health_state = 'unknown', next_check_at = excluded.next_check_at,
    consecutive_failures = 0, next_retry_at = null, suspended_until = null,
    last_error_code = null, last_checked_at = null, updated_at = pg_catalog.now();
  insert into private.source_catalog_events (
    source_catalog_event_type, source_catalog_entity_type, entity_id,
    provider_revision_id, binding_revision_id, previous_revision_id, actor_user_id
  ) values (
    p_event_type, 'binding', p_binding_id, p_provider_revision_id,
    p_binding_revision_id, v_previous_binding_revision_id, p_actor_user_id
  );

  return pg_catalog.jsonb_build_object(
    'provider', pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'providerId', v_provider.provider_id,
      'providerKey', v_provider.provider_key,
      'activeProviderRevisionId', v_provider.active_provider_revision_id,
      'sourceActivationState', v_provider.source_activation_state,
      'lockVersion', v_provider.lock_version
    ),
    'binding', pg_catalog.jsonb_build_object(
      'schemaVersion', 1, 'bindingId', v_binding.binding_id, 'lawId', v_binding.law_id,
      'activeBindingRevisionId', v_binding.active_binding_revision_id,
      'sourceActivationState', v_binding.source_activation_state,
      'lockVersion', v_binding.lock_version
    )
  );
end
$function$;

alter function private.set_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid, text
) owner to lex_source_catalog_owner;
revoke all on function private.set_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid, text
) from public, anon, authenticated;

create or replace function private.activate_law_source_binding_revision(
  p_actor_user_id uuid,
  p_provider_id uuid,
  p_provider_revision_id uuid,
  p_expected_provider_lock_version integer,
  p_binding_id uuid,
  p_binding_revision_id uuid,
  p_expected_binding_lock_version integer,
  p_test_evidence_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.set_law_source_binding_revision(
    p_actor_user_id, p_provider_id, p_provider_revision_id,
    p_expected_provider_lock_version, p_binding_id, p_binding_revision_id,
    p_expected_binding_lock_version, p_test_evidence_id, 'binding_activated'
  )
$function$;

alter function private.activate_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid
) owner to lex_source_catalog_owner;
revoke all on function private.activate_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid
) from public, anon, authenticated;
grant execute on function private.activate_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid
) to lex_source_catalog_admin;

create or replace function private.restore_law_source_binding_revision(
  p_actor_user_id uuid,
  p_provider_id uuid,
  p_provider_revision_id uuid,
  p_expected_provider_lock_version integer,
  p_binding_id uuid,
  p_binding_revision_id uuid,
  p_expected_binding_lock_version integer,
  p_test_evidence_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select private.set_law_source_binding_revision(
    p_actor_user_id, p_provider_id, p_provider_revision_id,
    p_expected_provider_lock_version, p_binding_id, p_binding_revision_id,
    p_expected_binding_lock_version, p_test_evidence_id, 'binding_restored'
  )
$function$;

alter function private.restore_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid
) owner to lex_source_catalog_owner;
revoke all on function private.restore_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid
) from public, anon, authenticated;
grant execute on function private.restore_law_source_binding_revision(
  uuid, uuid, uuid, integer, uuid, uuid, integer, uuid
) to lex_source_catalog_admin;

create or replace function private.change_law_source_binding_activation(
  p_actor_user_id uuid,
  p_binding_id uuid,
  p_expected_binding_lock_version integer,
  p_target_source_activation_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_binding private.law_source_bindings%rowtype;
  v_event_type text;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  if p_target_source_activation_state not in ('paused', 'archived') then
    raise exception using errcode = '22023', message = 'invalid source activation transition';
  end if;
  select * into v_binding from private.law_source_bindings
  where binding_id = p_binding_id for update;
  if not found
    or v_binding.lock_version <> p_expected_binding_lock_version
    or v_binding.source_activation_state = 'archived'
    or (
      p_target_source_activation_state = 'paused'
      and v_binding.source_activation_state <> 'active'
    )
  then
    raise exception using errcode = '40001', message = 'source activation transition conflict';
  end if;
  update private.law_source_bindings set
    source_activation_state = p_target_source_activation_state,
    lock_version = lock_version + 1,
    updated_at = pg_catalog.now()
  where binding_id = p_binding_id returning * into v_binding;
  v_event_type := case p_target_source_activation_state
    when 'paused' then 'binding_paused'
    else 'binding_archived'
  end;
  insert into private.source_catalog_events (
    source_catalog_event_type, source_catalog_entity_type, entity_id,
    binding_revision_id, actor_user_id
  ) values (
    v_event_type, 'binding', v_binding.binding_id,
    v_binding.active_binding_revision_id, p_actor_user_id
  );
  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'bindingId', v_binding.binding_id,
    'lawId', v_binding.law_id,
    'activeBindingRevisionId', v_binding.active_binding_revision_id,
    'sourceActivationState', v_binding.source_activation_state,
    'lockVersion', v_binding.lock_version
  );
end
$function$;

alter function private.change_law_source_binding_activation(uuid, uuid, integer, text)
owner to lex_source_catalog_owner;
revoke all on function private.change_law_source_binding_activation(uuid, uuid, integer, text)
from public, anon, authenticated;
grant execute on function private.change_law_source_binding_activation(uuid, uuid, integer, text)
to lex_source_catalog_admin;

create or replace function private.list_source_catalog(
  p_actor_user_id uuid,
  p_cursor uuid default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_items jsonb;
  v_last_binding_id uuid;
  v_has_more boolean;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  if p_limit < 1 or p_limit > 50 then
    raise exception using errcode = '22023', message = 'invalid source catalog page limit';
  end if;
  with selected as (
    select
      binding.binding_id,
      pg_catalog.jsonb_build_object(
        'providerId', provider.provider_id,
        'providerRevisionId', provider_revision.provider_revision_id,
        'providerRevisionNumber', provider_revision.revision_number,
        'providerKey', provider.provider_key,
        'providerName', provider_revision.provider_name,
        'adapterId', provider_revision.adapter_id,
        'adapterContractVersion', provider_revision.adapter_contract_version,
        'providerLockVersion', provider.lock_version,
        'bindingId', binding.binding_id,
        'bindingRevisionId', binding_revision.binding_revision_id,
        'bindingRevisionNumber', binding_revision.revision_number,
        'bindingLockVersion', binding.lock_version,
        'lawId', binding.law_id,
        'lawTitle', law.titulo,
        'sourceActivationState', binding.source_activation_state,
        'sourceHealthState', coalesce(health.source_health_state, 'unknown'),
        'monitoringIntervalMs', binding_revision.monitoring_interval_ms,
        'lastSourceTestOutcome', latest_test.source_test_outcome,
        'lastTestEvidenceId', latest_test.test_evidence_id,
        'lastTestedAt', latest_test.tested_at,
        'lastCheckedAt', health.last_checked_at,
        'lastErrorCode', latest_test.error_code,
        'artifacts', (
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'order', artifact.artifact_order,
            'sourceRole', artifact.source_role,
            'sourceVariant', artifact.source_variant,
            'sourceUrl', artifact.source_url
          ) order by artifact.artifact_order)
          from private.law_source_binding_artifacts artifact
          where artifact.binding_revision_id = binding_revision.binding_revision_id
        )
      ) value
    from private.law_source_bindings binding
    join lateral (
      select revision.* from private.law_source_binding_revisions revision
      where revision.binding_id = binding.binding_id
      order by
        (revision.binding_revision_id = binding.active_binding_revision_id) desc,
        revision.revision_number desc
      limit 1
    ) binding_revision on true
    join private.source_provider_revisions provider_revision
      on provider_revision.provider_revision_id = binding_revision.provider_revision_id
    join private.source_providers provider
      on provider.provider_id = provider_revision.provider_id
    join public.leis law on law.id = binding.law_id
    left join private.source_binding_health health
      on health.binding_id = binding.binding_id
    left join lateral (
      select evidence.test_evidence_id, evidence.source_test_outcome,
        evidence.tested_at, evidence.error_code
      from private.source_test_evidence evidence
      where evidence.provider_revision_id = provider_revision.provider_revision_id
        and evidence.binding_revision_id = binding_revision.binding_revision_id
      order by evidence.tested_at desc, evidence.test_evidence_id::text desc
      limit 1
    ) latest_test on true
    where p_cursor is null or binding.binding_id > p_cursor
    order by binding.binding_id
    limit p_limit
  )
  select
    coalesce(pg_catalog.jsonb_agg(selected.value order by selected.binding_id), '[]'::jsonb),
    pg_catalog.max(selected.binding_id::text)::uuid
  into v_items, v_last_binding_id
  from selected;

  select v_last_binding_id is not null and exists (
    select 1 from private.law_source_bindings binding
    where binding.binding_id > v_last_binding_id
  ) into v_has_more;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'nextCursor', case when v_has_more then v_last_binding_id else null end
  );
end
$function$;

alter function private.list_source_catalog(uuid, uuid, integer)
owner to lex_source_catalog_owner;
revoke all on function private.list_source_catalog(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function private.list_source_catalog(uuid, uuid, integer)
to lex_source_catalog_admin;

create or replace function private.resolve_active_source_import(p_source_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_match_count integer;
  v_provider private.source_provider_revisions%rowtype;
  v_binding private.law_source_binding_revisions%rowtype;
  v_artifacts jsonb;
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_source_catalog_importer', 'USAGE') then
    raise exception using errcode = '42501', message = 'source catalog importer identity required';
  end if;
  if pg_catalog.length(p_source_url) < 1 or pg_catalog.length(p_source_url) > 2048 then
    raise exception using errcode = '22023', message = 'invalid source import URL';
  end if;
  select pg_catalog.count(*) into v_match_count
  from private.law_source_bindings binding
  join private.law_source_binding_revisions revision
    on revision.binding_revision_id = binding.active_binding_revision_id
  join private.law_source_binding_artifacts artifact
    on artifact.binding_revision_id = revision.binding_revision_id
  join private.source_provider_revisions provider_revision
    on provider_revision.provider_revision_id = revision.provider_revision_id
  join private.source_providers provider
    on provider.active_provider_revision_id = provider_revision.provider_revision_id
  where binding.source_activation_state = 'active'
    and provider.source_activation_state = 'active'
    and artifact.source_url = p_source_url;
  if v_match_count = 0 then return null; end if;
  if v_match_count <> 1 then
    raise exception using errcode = '21000', message = 'ambiguous active source configuration';
  end if;

  select provider_revision.*
  into v_provider
  from private.law_source_bindings binding
  join private.law_source_binding_revisions revision
    on revision.binding_revision_id = binding.active_binding_revision_id
  join private.law_source_binding_artifacts artifact
    on artifact.binding_revision_id = revision.binding_revision_id
  join private.source_provider_revisions provider_revision
    on provider_revision.provider_revision_id = revision.provider_revision_id
  join private.source_providers provider
    on provider.active_provider_revision_id = provider_revision.provider_revision_id
  where binding.source_activation_state = 'active'
    and provider.source_activation_state = 'active'
    and artifact.source_url = p_source_url;

  select revision.*
  into v_binding
  from private.law_source_bindings binding
  join private.law_source_binding_revisions revision
    on revision.binding_revision_id = binding.active_binding_revision_id
  join private.law_source_binding_artifacts artifact
    on artifact.binding_revision_id = revision.binding_revision_id
  join private.source_provider_revisions provider_revision
    on provider_revision.provider_revision_id = revision.provider_revision_id
  join private.source_providers provider
    on provider.active_provider_revision_id = provider_revision.provider_revision_id
  where binding.source_activation_state = 'active'
    and provider.source_activation_state = 'active'
    and artifact.source_url = p_source_url;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'order', artifact.artifact_order,
    'sourceRole', artifact.source_role,
    'sourceVariant', artifact.source_variant,
    'sourceUrl', artifact.source_url
  ) order by artifact.artifact_order)
  into v_artifacts
  from private.law_source_binding_artifacts artifact
  where artifact.binding_revision_id = v_binding.binding_revision_id;

  return pg_catalog.jsonb_build_object(
    'providerRevision', pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'providerRevisionId', v_provider.provider_revision_id,
      'providerId', v_provider.provider_id,
      'revisionNumber', v_provider.revision_number,
      'providerKey', v_provider.provider_key,
      'providerName', v_provider.provider_name,
      'sourceType', v_provider.source_type,
      'adapterId', v_provider.adapter_id,
      'adapterContractVersion', v_provider.adapter_contract_version,
      'origin', pg_catalog.jsonb_build_object(
        'scheme', v_provider.origin_scheme,
        'host', v_provider.origin_host,
        'port', v_provider.origin_port,
        'pathPrefix', v_provider.origin_path_prefix
      ),
      'detectionParameters', v_provider.detection_parameters,
      'configDigest', v_provider.config_digest,
      'createdByUserId', v_provider.created_by_user_id,
      'createdAt', v_provider.created_at
    ),
    'bindingRevision', pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'bindingRevisionId', v_binding.binding_revision_id,
      'bindingId', v_binding.binding_id,
      'lawId', v_binding.law_id,
      'providerRevisionId', v_binding.provider_revision_id,
      'revisionNumber', v_binding.revision_number,
      'artifacts', v_artifacts,
      'monitoringIntervalMs', v_binding.monitoring_interval_ms,
      'configDigest', v_binding.config_digest,
      'createdByUserId', v_binding.created_by_user_id,
      'createdAt', v_binding.created_at
    )
  );
end
$function$;

alter function private.resolve_active_source_import(text)
owner to lex_source_catalog_owner;
revoke all on function private.resolve_active_source_import(text)
from public, anon, authenticated;
grant execute on function private.resolve_active_source_import(text)
to lex_source_catalog_importer;

create or replace function private.get_source_check_job_payload(p_source_check_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'sourceCheckJobId', job.source_check_job_id,
    'bindingId', job.binding_id,
    'bindingRevisionId', job.binding_revision_id,
    'providerRevisionId', job.provider_revision_id,
    'lawId', job.law_id,
    'baseVersionId', job.base_version_id,
    'sourceCheckTrigger', job.source_check_trigger,
    'sourceCheckJobState', job.source_check_job_state,
    'idempotencyKey', job.idempotency_key,
    'requestedAt', job.requested_at,
    'claimedAt', job.claimed_at,
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
  )
  from private.source_check_jobs job
  join private.source_provider_revisions provider_revision
    on provider_revision.provider_revision_id = job.provider_revision_id
  join private.law_source_binding_revisions revision
    on revision.binding_revision_id = job.binding_revision_id
  join private.source_binding_health health on health.binding_id = job.binding_id
  where job.source_check_job_id = p_source_check_job_id
$function$;

alter function private.get_source_check_job_payload(uuid) owner to lex_source_catalog_owner;
revoke all on function private.get_source_check_job_payload(uuid)
from public, anon, authenticated;

create or replace function private.request_source_check(
  p_actor_user_id uuid,
  p_binding_id uuid,
  p_idempotency_key text,
  p_requested_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_binding private.law_source_bindings%rowtype;
  v_revision private.law_source_binding_revisions%rowtype;
  v_job private.source_check_jobs%rowtype;
  v_provider private.source_providers%rowtype;
  v_health private.source_binding_health%rowtype;
  v_base_version_id uuid;
  v_deduplicated boolean := false;
begin
  perform private.assert_source_catalog_admin(p_actor_user_id);
  if pg_catalog.length(p_idempotency_key) < 1 or pg_catalog.length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'invalid source check idempotency key';
  end if;

  select * into v_binding from private.law_source_bindings
  where binding_id = p_binding_id for update;
  if not found or v_binding.source_activation_state <> 'active'
    or v_binding.active_binding_revision_id is null then
    raise exception using errcode = '40001', message = 'source binding is not active';
  end if;
  select * into v_revision from private.law_source_binding_revisions
  where binding_revision_id = v_binding.active_binding_revision_id;
  select * into v_provider from private.source_providers
  where active_provider_revision_id = v_revision.provider_revision_id;
  if not found or v_provider.source_activation_state <> 'active' then
    raise exception using errcode = '40001', message = 'source provider is not active';
  end if;
  select * into v_health from private.source_binding_health
  where binding_id = p_binding_id;
  if v_health.suspended_until is not null and v_health.suspended_until > p_requested_at then
    raise exception using errcode = '40001', message = 'source binding is temporarily suspended';
  end if;
  select versao_publicada_id into v_base_version_id from public.leis
  where id = v_binding.law_id;
  if v_base_version_id is null then
    raise exception using errcode = '40001', message = 'source law has no published base';
  end if;

  select * into v_job from private.source_check_jobs
  where idempotency_key = p_idempotency_key;
  if found then
    if v_job.binding_id <> p_binding_id then
      raise exception using errcode = '40001', message = 'source check idempotency conflict';
    end if;
    v_deduplicated := true;
  else
    select * into v_job from private.source_check_jobs
    where binding_id = p_binding_id and source_check_job_state in ('queued', 'running')
    order by requested_at, source_check_job_id limit 1;
    if found then
      v_deduplicated := true;
    else
      insert into private.source_check_jobs (
        source_check_job_id, binding_id, binding_revision_id, provider_revision_id,
        law_id, base_version_id, source_check_trigger, source_check_job_state,
        idempotency_key, requested_by_user_id, requested_at
      ) values (
        pg_catalog.gen_random_uuid(), p_binding_id, v_revision.binding_revision_id,
        v_revision.provider_revision_id, v_binding.law_id, v_base_version_id,
        'manual', 'queued', p_idempotency_key, p_actor_user_id, p_requested_at
      ) returning * into v_job;
      insert into private.source_check_events (
        source_check_job_id, binding_id, binding_revision_id, source_check_event_type,
        actor_user_id, actor_role, occurred_at
      ) values (
        v_job.source_check_job_id, v_job.binding_id, v_job.binding_revision_id,
        'check_requested', p_actor_user_id, 'source_catalog_admin', p_requested_at
      );
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'sourceCheckJobId', v_job.source_check_job_id,
    'bindingId', v_job.binding_id,
    'bindingRevisionId', v_job.binding_revision_id,
    'providerRevisionId', v_job.provider_revision_id,
    'lawId', v_job.law_id,
    'baseVersionId', v_job.base_version_id,
    'sourceCheckTrigger', v_job.source_check_trigger,
    'sourceCheckJobState', v_job.source_check_job_state,
    'idempotencyKey', v_job.idempotency_key,
    'requestedAt', v_job.requested_at,
    'deduplicated', v_deduplicated
  );
end
$function$;

alter function private.request_source_check(uuid, uuid, text, timestamptz)
owner to lex_source_catalog_owner;
revoke all on function private.request_source_check(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function private.request_source_check(uuid, uuid, text, timestamptz)
to lex_source_catalog_admin;

create or replace function private.claim_due_source_checks(
  p_claimed_at timestamptz,
  p_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job_id uuid;
  v_binding record;
  v_result jsonb := '[]'::jsonb;
  v_remaining integer;
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_source_catalog_worker', 'USAGE') then
    raise exception using errcode = '42501', message = 'source catalog worker identity required';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'invalid source check claim limit';
  end if;

  with cancelled as (
    update private.source_check_jobs job set
      source_check_job_state = 'cancelled', completed_at = p_claimed_at,
      detail_code = 'SOURCE_BINDING_INACTIVE'
    where job.source_check_job_state = 'queued'
      and not exists (
        select 1 from private.law_source_bindings binding
        join private.law_source_binding_revisions revision
          on revision.binding_revision_id = binding.active_binding_revision_id
        join private.source_providers provider
          on provider.active_provider_revision_id = revision.provider_revision_id
        where binding.binding_id = job.binding_id
          and binding.source_activation_state = 'active'
          and provider.source_activation_state = 'active'
          and revision.binding_revision_id = job.binding_revision_id
      )
    returning job.*
  )
  insert into private.source_check_events (
    source_check_job_id, binding_id, binding_revision_id, source_check_event_type,
    actor_role, detail_code, occurred_at
  ) select source_check_job_id, binding_id, binding_revision_id, 'check_cancelled',
    'source_catalog_worker', detail_code, p_claimed_at from cancelled;

  for v_job_id in
    with candidates as (
      select job.source_check_job_id
      from private.source_check_jobs job
      join private.law_source_bindings binding on binding.binding_id = job.binding_id
      join private.law_source_binding_revisions revision
        on revision.binding_revision_id = binding.active_binding_revision_id
      join private.source_providers provider
        on provider.active_provider_revision_id = revision.provider_revision_id
      join private.source_binding_health health on health.binding_id = binding.binding_id
      where job.source_check_job_state = 'queued'
        and binding.source_activation_state = 'active'
        and provider.source_activation_state = 'active'
        and revision.binding_revision_id = job.binding_revision_id
        and (health.suspended_until is null or health.suspended_until <= p_claimed_at)
      order by job.requested_at, job.source_check_job_id
      for update of job skip locked
      limit p_limit
    )
    update private.source_check_jobs job set
      source_check_job_state = 'running', claimed_at = p_claimed_at
    from candidates
    where job.source_check_job_id = candidates.source_check_job_id
    returning job.source_check_job_id
  loop
    insert into private.source_check_events (
      source_check_job_id, binding_id, binding_revision_id, source_check_event_type,
      actor_role, occurred_at
    ) select source_check_job_id, binding_id, binding_revision_id, 'check_claimed',
      'source_catalog_worker', p_claimed_at from private.source_check_jobs
      where source_check_job_id = v_job_id;
    v_result := v_result || pg_catalog.jsonb_build_array(
      private.get_source_check_job_payload(v_job_id)
    );
  end loop;

  v_remaining := p_limit - pg_catalog.jsonb_array_length(v_result);
  if v_remaining > 0 then
    for v_binding in
      select binding.binding_id, binding.law_id, revision.binding_revision_id,
        revision.provider_revision_id, health.next_check_at, law.versao_publicada_id
      from private.source_binding_health health
      join private.law_source_bindings binding on binding.binding_id = health.binding_id
      join private.law_source_binding_revisions revision
        on revision.binding_revision_id = binding.active_binding_revision_id
      join private.source_providers provider
        on provider.active_provider_revision_id = revision.provider_revision_id
      join public.leis law on law.id = binding.law_id
      where binding.source_activation_state = 'active'
        and provider.source_activation_state = 'active'
        and health.binding_revision_id = revision.binding_revision_id
        and health.next_check_at <= p_claimed_at
        and (health.suspended_until is null or health.suspended_until <= p_claimed_at)
        and law.versao_publicada_id is not null
        and not exists (
          select 1 from private.source_check_jobs open_job
          where open_job.binding_id = binding.binding_id
            and open_job.source_check_job_state in ('queued', 'running')
        )
      order by health.next_check_at, binding.law_id
      for update of health skip locked
      limit v_remaining
    loop
      insert into private.source_check_jobs (
        source_check_job_id, binding_id, binding_revision_id, provider_revision_id,
        law_id, base_version_id, source_check_trigger, source_check_job_state,
        idempotency_key, requested_at, claimed_at
      ) values (
        pg_catalog.gen_random_uuid(), v_binding.binding_id, v_binding.binding_revision_id,
        v_binding.provider_revision_id, v_binding.law_id, v_binding.versao_publicada_id,
        'scheduled', 'running',
        'scheduled:' || v_binding.binding_revision_id::text || ':' || v_binding.next_check_at::text,
        p_claimed_at, p_claimed_at
      ) on conflict do nothing returning source_check_job_id into v_job_id;
      if v_job_id is not null then
        insert into private.source_check_events (
          source_check_job_id, binding_id, binding_revision_id, source_check_event_type,
          actor_role, occurred_at
        ) values (
          v_job_id, v_binding.binding_id, v_binding.binding_revision_id,
          'check_claimed', 'source_catalog_worker', p_claimed_at
        );
        v_result := v_result || pg_catalog.jsonb_build_array(
          private.get_source_check_job_payload(v_job_id)
        );
      end if;
      v_job_id := null;
    end loop;
  end if;
  return v_result;
end
$function$;

alter function private.claim_due_source_checks(timestamptz, integer)
owner to lex_source_catalog_owner;
revoke all on function private.claim_due_source_checks(timestamptz, integer)
from public, anon, authenticated;
grant execute on function private.claim_due_source_checks(timestamptz, integer)
to lex_source_catalog_worker;

create or replace function private.complete_source_check(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job private.source_check_jobs%rowtype;
  v_previous_health private.source_binding_health%rowtype;
  v_health_applied boolean := false;
  v_event_type text;
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_source_catalog_worker', 'USAGE') then
    raise exception using errcode = '42501', message = 'source catalog worker identity required';
  end if;
  if p_payload ->> 'sourceCheckJobState' not in ('completed', 'failed') then
    raise exception using errcode = '22023', message = 'invalid source check completion';
  end if;
  if (p_payload ->> 'sourceCheckJobState') = 'failed'
    and p_payload ->> 'detailCode' is null then
    raise exception using errcode = '22023', message = 'failed source check requires detail code';
  end if;
  if (p_payload ->> 'sourceCheckJobState') = 'completed' and (
    p_payload ->> 'detailCode' is not null
    or p_payload -> 'health' ->> 'sourceHealthState' <> 'healthy'
    or (p_payload -> 'health' ->> 'consecutiveFailures')::integer is distinct from 0
    or p_payload -> 'health' ->> 'nextRetryAt' is not null
    or p_payload -> 'health' ->> 'suspendedUntil' is not null
    or p_payload -> 'health' ->> 'lastErrorCode' is not null
    or p_payload -> 'health' ->> 'lastCheckedAt' is null
  ) then
    raise exception using errcode = '22023', message = 'completed source check health is invalid';
  end if;
  if (p_payload ->> 'sourceCheckJobState') = 'failed' and (
    p_payload -> 'health' ->> 'sourceHealthState' not in ('degraded', 'suspended')
    or coalesce(
      (p_payload -> 'health' ->> 'consecutiveFailures')::integer, 0
    ) <= 0
    or p_payload -> 'health' ->> 'nextRetryAt' is null
    or p_payload -> 'health' ->> 'lastErrorCode' is distinct from p_payload ->> 'detailCode'
    or p_payload -> 'health' ->> 'lastCheckedAt' is null
    or (
      p_payload -> 'health' ->> 'sourceHealthState' = 'degraded'
      and p_payload -> 'health' ->> 'suspendedUntil' is not null
    )
    or (
      p_payload -> 'health' ->> 'sourceHealthState' = 'suspended'
      and p_payload -> 'health' ->> 'suspendedUntil' is null
    )
  ) then
    raise exception using errcode = '22023', message = 'failed source check health is invalid';
  end if;

  select * into v_job from private.source_check_jobs
  where source_check_job_id = (p_payload ->> 'sourceCheckJobId')::uuid for update;
  if not found or v_job.source_check_job_state <> 'running' then
    raise exception using errcode = '40001', message = 'source check completion conflict';
  end if;
  if (p_payload -> 'health' ->> 'bindingId')::uuid <> v_job.binding_id
    or (p_payload -> 'health' ->> 'bindingRevisionId')::uuid <> v_job.binding_revision_id then
    raise exception using errcode = '22023', message = 'source check health revision mismatch';
  end if;

  update private.source_check_jobs set
    source_check_job_state = p_payload ->> 'sourceCheckJobState',
    completed_at = (p_payload ->> 'completedAt')::timestamptz,
    detail_code = p_payload ->> 'detailCode'
  where source_check_job_id = v_job.source_check_job_id;

  select * into v_previous_health from private.source_binding_health
  where binding_id = v_job.binding_id for update;
  update private.source_binding_health health set
    source_health_state = p_payload -> 'health' ->> 'sourceHealthState',
    next_check_at = (p_payload -> 'health' ->> 'nextCheckAt')::timestamptz,
    consecutive_failures = (p_payload -> 'health' ->> 'consecutiveFailures')::integer,
    next_retry_at = (p_payload -> 'health' ->> 'nextRetryAt')::timestamptz,
    suspended_until = (p_payload -> 'health' ->> 'suspendedUntil')::timestamptz,
    last_error_code = p_payload -> 'health' ->> 'lastErrorCode',
    last_checked_at = (p_payload -> 'health' ->> 'lastCheckedAt')::timestamptz,
    updated_at = (p_payload -> 'health' ->> 'updatedAt')::timestamptz
  where health.binding_id = v_job.binding_id
    and health.binding_revision_id = v_job.binding_revision_id
    and exists (
      select 1 from private.law_source_bindings binding
      where binding.binding_id = v_job.binding_id
        and binding.active_binding_revision_id = v_job.binding_revision_id
        and binding.source_activation_state = 'active'
    );
  v_health_applied := found;

  insert into private.source_check_events (
    source_check_job_id, binding_id, binding_revision_id, source_check_event_type,
    actor_role, detail_code, occurred_at
  ) values (
    v_job.source_check_job_id, v_job.binding_id, v_job.binding_revision_id,
    case when (p_payload ->> 'sourceCheckJobState') = 'completed'
      then 'check_completed' else 'check_failed' end,
    'source_catalog_worker', p_payload ->> 'detailCode',
    (p_payload ->> 'completedAt')::timestamptz
  );

  if v_health_applied then
    v_event_type := case
      when p_payload -> 'health' ->> 'sourceHealthState' = 'healthy'
        and v_previous_health.source_health_state in ('degraded', 'suspended')
        then 'health_recovered'
      when p_payload -> 'health' ->> 'sourceHealthState' = 'suspended'
        and v_previous_health.source_health_state <> 'suspended'
        then 'health_suspended'
      when p_payload -> 'health' ->> 'sourceHealthState' = 'degraded'
        and v_previous_health.source_health_state <> 'degraded'
        then 'health_degraded'
      else null
    end;
    if v_event_type is not null then
      insert into private.source_check_events (
        source_check_job_id, binding_id, binding_revision_id, source_check_event_type,
        actor_role, detail_code, occurred_at
      ) values (
        v_job.source_check_job_id, v_job.binding_id, v_job.binding_revision_id,
        v_event_type, 'source_catalog_worker', p_payload ->> 'detailCode',
        (p_payload ->> 'completedAt')::timestamptz
      );
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'sourceCheckJobId', v_job.source_check_job_id,
    'sourceCheckJobState', p_payload ->> 'sourceCheckJobState',
    'healthApplied', v_health_applied
  );
end
$function$;

alter function private.complete_source_check(jsonb) owner to lex_source_catalog_owner;
revoke all on function private.complete_source_check(jsonb)
from public, anon, authenticated;
grant execute on function private.complete_source_check(jsonb)
to lex_source_catalog_worker;

-- Nenhuma identidade operacional recebe escrita normativa ou mutação direta
-- nas tabelas do catálogo. Toda escrita passa pelas funções fechadas acima.
revoke insert, update, delete, truncate
  on public.leis, public.versoes_lei, public.artefatos_fonte,
     public.dispositivos, public.block_ids, public.block_id_redirects
  from lex_source_catalog_admin, lex_source_catalog_worker, lex_source_catalog_importer;
