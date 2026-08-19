-- Feature 013, Grupo 1: projeções fechadas de auditoria sobre stores autoritativos existentes.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_audit_reader') then
    create role lex_audit_reader nologin noinherit;
  end if;
end
$roles$;

grant lex_audit_reader to postgres;
grant usage on schema private to lex_audit_reader;

revoke all on private.publication_events, private.legislative_update_events,
  private.source_catalog_events, private.source_check_events
from lex_audit_reader;

create index if not exists publication_events_audit_time_idx
  on private.publication_events (occurred_at desc, event_id desc);
create index if not exists publication_events_audit_entity_idx
  on private.publication_events (publication_id, event_id desc);
create index if not exists legislative_update_events_audit_time_idx
  on private.legislative_update_events (occurred_at desc, event_id desc);
create index if not exists legislative_update_events_audit_entity_idx
  on private.legislative_update_events (update_id, event_id desc);
create index if not exists source_catalog_events_audit_time_idx
  on private.source_catalog_events (occurred_at desc, event_id desc);
create index if not exists source_catalog_events_audit_entity_idx
  on private.source_catalog_events (entity_id, event_id desc);
create index if not exists source_check_events_audit_time_idx
  on private.source_check_events (occurred_at desc, source_check_event_id desc);
create index if not exists source_check_events_audit_entity_idx
  on private.source_check_events (source_check_job_id, source_check_event_id desc);

create or replace function private.list_publication_audit_events(
  p_actor_user_id uuid,
  p_before_sequence bigint,
  p_cutoff timestamptz,
  p_limit integer
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if (p_before_sequence is not null and p_before_sequence < 0)
    or p_cutoff is null or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'invalid audit page bounds';
  end if;

  return query
  select event.event_id,
    event.occurred_at,
    case when event.event_type = 'failed' then 'error' else 'info' end,
    'publication'::text,
    'publisher'::text,
    ('publication_' || event.event_type)::text,
    case event.event_type
      when 'approval_recorded' then 'Aprovação de publicação registrada.'
      when 'pushed' then 'Candidato de publicação enviado.'
      when 'syncing' then 'Sincronização da publicação iniciada.'
      when 'published' then 'Publicação confirmada.'
      else 'Publicação falhou.'
    end,
    case when event.event_type = 'approval_recorded'
      then 'editor_juridico' else 'publisher_service' end,
    publication.lei_id,
    event.publication_id
  from private.publication_events as event
  left join public.publicacoes as publication on publication.id = event.publication_id
  where (p_before_sequence is null or event.event_id < p_before_sequence)
    and event.occurred_at <= p_cutoff
  order by event.event_id desc
  limit p_limit;
end
$function$;

alter function private.list_publication_audit_events(uuid, bigint, timestamptz, integer)
owner to lex_publication_owner;
revoke all on function private.list_publication_audit_events(uuid, bigint, timestamptz, integer)
from public, anon, authenticated;
grant execute on function private.list_publication_audit_events(uuid, bigint, timestamptz, integer)
to lex_audit_reader;

create or replace function private.get_publication_audit_event(
  p_actor_user_id uuid,
  p_event_sequence bigint
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid,
  manifest_digest text,
  git_commit_sha text,
  failure_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if p_event_sequence is null or p_event_sequence < 0 then
    raise exception using errcode = '22023', message = 'invalid audit event sequence';
  end if;

  return query
  select event.event_id,
    event.occurred_at,
    case when event.event_type = 'failed' then 'error' else 'info' end,
    'publication'::text,
    'publisher'::text,
    ('publication_' || event.event_type)::text,
    case event.event_type
      when 'approval_recorded' then 'Aprovação de publicação registrada.'
      when 'pushed' then 'Candidato de publicação enviado.'
      when 'syncing' then 'Sincronização da publicação iniciada.'
      when 'published' then 'Publicação confirmada.'
      else 'Publicação falhou.'
    end,
    case when event.event_type = 'approval_recorded'
      then 'editor_juridico' else 'publisher_service' end,
    publication.lei_id,
    event.publication_id,
    event.manifest_digest,
    event.git_commit_sha,
    event.failure_code
  from private.publication_events as event
  left join public.publicacoes as publication on publication.id = event.publication_id
  where event.event_id = p_event_sequence;
end
$function$;

alter function private.get_publication_audit_event(uuid, bigint)
owner to lex_publication_owner;
revoke all on function private.get_publication_audit_event(uuid, bigint)
from public, anon, authenticated;
grant execute on function private.get_publication_audit_event(uuid, bigint)
to lex_audit_reader;

create or replace function private.list_legislative_update_audit_events(
  p_actor_user_id uuid,
  p_before_sequence bigint,
  p_cutoff timestamptz,
  p_limit integer
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if (p_before_sequence is not null and p_before_sequence < 0)
    or p_cutoff is null or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'invalid audit page bounds';
  end if;

  return query
  select event.event_id,
    event.occurred_at,
    case
      when event.event_type = 'error_recorded' then 'error'
      when event.event_type = 'rejected' then 'warn'
      else 'info'
    end,
    'legislative_update'::text,
    'update_worker'::text,
    ('legislative_update_' || event.event_type)::text,
    case event.event_type
      when 'created' then 'Atualização legislativa criada.'
      when 'detected_again' then 'Atualização legislativa detectada novamente.'
      when 'superseded' then 'Atualização legislativa substituída.'
      when 'approved' then 'Atualização legislativa aprovada.'
      when 'rejected' then 'Atualização legislativa rejeitada.'
      when 'error_recorded' then 'Falha de atualização legislativa registrada.'
      when 'reprocess_requested' then 'Reprocessamento legislativo solicitado.'
      else 'Reprocessamento legislativo assumido.'
    end,
    case when event.event_type in ('approved', 'rejected')
      then 'editor_juridico' else 'update_worker' end,
    update.lei_id,
    event.update_id
  from private.legislative_update_events as event
  join public.updates_legislativos as update on update.id = event.update_id
  where (p_before_sequence is null or event.event_id < p_before_sequence)
    and event.occurred_at <= p_cutoff
  order by event.event_id desc
  limit p_limit;
end
$function$;

alter function private.list_legislative_update_audit_events(uuid, bigint, timestamptz, integer)
owner to lex_update_owner;
revoke all on function private.list_legislative_update_audit_events(uuid, bigint, timestamptz, integer)
from public, anon, authenticated;
grant execute on function private.list_legislative_update_audit_events(uuid, bigint, timestamptz, integer)
to lex_audit_reader;

create or replace function private.get_legislative_update_audit_event(
  p_actor_user_id uuid,
  p_event_sequence bigint
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid,
  base_normative_sha256 text,
  candidate_normative_sha256 text,
  detail_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if p_event_sequence is null or p_event_sequence < 0 then
    raise exception using errcode = '22023', message = 'invalid audit event sequence';
  end if;

  return query
  select event.event_id,
    event.occurred_at,
    case
      when event.event_type = 'error_recorded' then 'error'
      when event.event_type = 'rejected' then 'warn'
      else 'info'
    end,
    'legislative_update'::text,
    'update_worker'::text,
    ('legislative_update_' || event.event_type)::text,
    case event.event_type
      when 'created' then 'Atualização legislativa criada.'
      when 'detected_again' then 'Atualização legislativa detectada novamente.'
      when 'superseded' then 'Atualização legislativa substituída.'
      when 'approved' then 'Atualização legislativa aprovada.'
      when 'rejected' then 'Atualização legislativa rejeitada.'
      when 'error_recorded' then 'Falha de atualização legislativa registrada.'
      when 'reprocess_requested' then 'Reprocessamento legislativo solicitado.'
      else 'Reprocessamento legislativo assumido.'
    end,
    case when event.event_type in ('approved', 'rejected')
      then 'editor_juridico' else 'update_worker' end,
    update.lei_id,
    event.update_id,
    update.base_normative_sha256,
    update.candidate_normative_sha256,
    event.detail_code
  from private.legislative_update_events as event
  join public.updates_legislativos as update on update.id = event.update_id
  where event.event_id = p_event_sequence;
end
$function$;

alter function private.get_legislative_update_audit_event(uuid, bigint)
owner to lex_update_owner;
revoke all on function private.get_legislative_update_audit_event(uuid, bigint)
from public, anon, authenticated;
grant execute on function private.get_legislative_update_audit_event(uuid, bigint)
to lex_audit_reader;

create or replace function private.list_source_catalog_audit_events(
  p_actor_user_id uuid,
  p_before_sequence bigint,
  p_cutoff timestamptz,
  p_limit integer
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if (p_before_sequence is not null and p_before_sequence < 0)
    or p_cutoff is null or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'invalid audit page bounds';
  end if;

  return query
  select event.event_id,
    event.occurred_at,
    case when event.source_catalog_event_type in (
      'binding_paused', 'binding_archived'
    ) then 'warn' else 'info' end,
    'source_catalog'::text,
    'source_catalog'::text,
    ('source_catalog_' || event.source_catalog_event_type)::text,
    case event.source_catalog_event_type
      when 'provider_revision_created' then 'Revisão de provedor criada.'
      when 'binding_revision_created' then 'Revisão de vínculo criada.'
      when 'test_recorded' then 'Teste de fonte registrado.'
      when 'binding_activated' then 'Vínculo de fonte ativado.'
      when 'binding_paused' then 'Vínculo de fonte pausado.'
      when 'binding_archived' then 'Vínculo de fonte arquivado.'
      else 'Vínculo de fonte restaurado.'
    end,
    'source_catalog_admin'::text,
    binding.law_id,
    event.entity_id
  from private.source_catalog_events as event
  left join private.law_source_bindings as binding
    on event.source_catalog_entity_type = 'binding' and binding.binding_id = event.entity_id
  where (p_before_sequence is null or event.event_id < p_before_sequence)
    and event.occurred_at <= p_cutoff
  order by event.event_id desc
  limit p_limit;
end
$function$;

alter function private.list_source_catalog_audit_events(uuid, bigint, timestamptz, integer)
owner to lex_source_catalog_owner;
revoke all on function private.list_source_catalog_audit_events(uuid, bigint, timestamptz, integer)
from public, anon, authenticated;
grant execute on function private.list_source_catalog_audit_events(uuid, bigint, timestamptz, integer)
to lex_audit_reader;

create or replace function private.get_source_catalog_audit_event(
  p_actor_user_id uuid,
  p_event_sequence bigint
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid,
  source_catalog_entity_type text,
  provider_revision_id uuid,
  binding_revision_id uuid,
  detail_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if p_event_sequence is null or p_event_sequence < 0 then
    raise exception using errcode = '22023', message = 'invalid audit event sequence';
  end if;

  return query
  select event.event_id,
    event.occurred_at,
    case when event.source_catalog_event_type in (
      'binding_paused', 'binding_archived'
    ) then 'warn' else 'info' end,
    'source_catalog'::text,
    'source_catalog'::text,
    ('source_catalog_' || event.source_catalog_event_type)::text,
    case event.source_catalog_event_type
      when 'provider_revision_created' then 'Revisão de provedor criada.'
      when 'binding_revision_created' then 'Revisão de vínculo criada.'
      when 'test_recorded' then 'Teste de fonte registrado.'
      when 'binding_activated' then 'Vínculo de fonte ativado.'
      when 'binding_paused' then 'Vínculo de fonte pausado.'
      when 'binding_archived' then 'Vínculo de fonte arquivado.'
      else 'Vínculo de fonte restaurado.'
    end,
    'source_catalog_admin'::text,
    binding.law_id,
    event.entity_id,
    event.source_catalog_entity_type,
    event.provider_revision_id,
    event.binding_revision_id,
    event.detail_code
  from private.source_catalog_events as event
  left join private.law_source_bindings as binding
    on event.source_catalog_entity_type = 'binding' and binding.binding_id = event.entity_id
  where event.event_id = p_event_sequence;
end
$function$;

alter function private.get_source_catalog_audit_event(uuid, bigint)
owner to lex_source_catalog_owner;
revoke all on function private.get_source_catalog_audit_event(uuid, bigint)
from public, anon, authenticated;
grant execute on function private.get_source_catalog_audit_event(uuid, bigint)
to lex_audit_reader;

create or replace function private.list_source_check_audit_events(
  p_actor_user_id uuid,
  p_before_sequence bigint,
  p_cutoff timestamptz,
  p_limit integer
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if (p_before_sequence is not null and p_before_sequence < 0)
    or p_cutoff is null or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'invalid audit page bounds';
  end if;

  return query
  select event.source_check_event_id,
    event.occurred_at,
    case
      when event.source_check_event_type in ('check_failed', 'health_suspended') then 'error'
      when event.source_check_event_type in (
        'check_cancelled', 'health_degraded'
      ) then 'warn'
      else 'info'
    end,
    'source_catalog'::text,
    'source_catalog'::text,
    ('source_' || event.source_check_event_type)::text,
    case event.source_check_event_type
      when 'check_requested' then 'Verificação de fonte solicitada.'
      when 'check_claimed' then 'Verificação de fonte assumida.'
      when 'check_completed' then 'Verificação de fonte concluída.'
      when 'check_failed' then 'Verificação de fonte falhou.'
      when 'check_cancelled' then 'Verificação de fonte cancelada.'
      when 'health_degraded' then 'Saúde da fonte degradada.'
      when 'health_suspended' then 'Verificação da fonte suspensa.'
      else 'Saúde da fonte recuperada.'
    end,
    event.actor_role,
    binding.law_id,
    event.source_check_job_id
  from private.source_check_events as event
  join private.law_source_bindings as binding on binding.binding_id = event.binding_id
  where (p_before_sequence is null or event.source_check_event_id < p_before_sequence)
    and event.occurred_at <= p_cutoff
  order by event.source_check_event_id desc
  limit p_limit;
end
$function$;

alter function private.list_source_check_audit_events(uuid, bigint, timestamptz, integer)
owner to lex_source_catalog_owner;
revoke all on function private.list_source_check_audit_events(uuid, bigint, timestamptz, integer)
from public, anon, authenticated;
grant execute on function private.list_source_check_audit_events(uuid, bigint, timestamptz, integer)
to lex_audit_reader;

create or replace function private.get_source_check_audit_event(
  p_actor_user_id uuid,
  p_event_sequence bigint
)
returns table (
  event_sequence bigint,
  occurred_at timestamptz,
  event_level text,
  event_module text,
  event_origin text,
  event_code text,
  display_message text,
  actor_role text,
  law_id uuid,
  correlation_id uuid,
  binding_revision_id uuid,
  detail_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil as profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active'
      and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if p_event_sequence is null or p_event_sequence < 0 then
    raise exception using errcode = '22023', message = 'invalid audit event sequence';
  end if;

  return query
  select event.source_check_event_id,
    event.occurred_at,
    case
      when event.source_check_event_type in ('check_failed', 'health_suspended') then 'error'
      when event.source_check_event_type in (
        'check_cancelled', 'health_degraded'
      ) then 'warn'
      else 'info'
    end,
    'source_catalog'::text,
    'source_catalog'::text,
    ('source_' || event.source_check_event_type)::text,
    case event.source_check_event_type
      when 'check_requested' then 'Verificação de fonte solicitada.'
      when 'check_claimed' then 'Verificação de fonte assumida.'
      when 'check_completed' then 'Verificação de fonte concluída.'
      when 'check_failed' then 'Verificação de fonte falhou.'
      when 'check_cancelled' then 'Verificação de fonte cancelada.'
      when 'health_degraded' then 'Saúde da fonte degradada.'
      when 'health_suspended' then 'Verificação da fonte suspensa.'
      else 'Saúde da fonte recuperada.'
    end,
    event.actor_role,
    binding.law_id,
    event.source_check_job_id,
    event.binding_revision_id,
    event.detail_code
  from private.source_check_events as event
  join private.law_source_bindings as binding on binding.binding_id = event.binding_id
  where event.source_check_event_id = p_event_sequence;
end
$function$;

alter function private.get_source_check_audit_event(uuid, bigint)
owner to lex_source_catalog_owner;
revoke all on function private.get_source_check_audit_event(uuid, bigint)
from public, anon, authenticated;
grant execute on function private.get_source_check_audit_event(uuid, bigint)
to lex_audit_reader;
