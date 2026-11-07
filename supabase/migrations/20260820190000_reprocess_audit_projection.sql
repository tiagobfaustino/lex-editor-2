-- Feature 013: atualiza projeções já instaladas com os eventos terminais.

create or replace function private.list_legislative_update_audit_events(
  p_actor_user_id uuid, p_before_sequence bigint, p_cutoff timestamptz, p_limit integer
)
returns table (
  event_sequence bigint, occurred_at timestamptz, event_level text, event_module text,
  event_origin text, event_code text, display_message text, actor_role text,
  law_id uuid, correlation_id uuid
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active' and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if (p_before_sequence is not null and p_before_sequence < 0)
    or p_cutoff is null or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception using errcode = '22023', message = 'invalid audit page bounds';
  end if;
  return query
  select event.event_id, event.occurred_at,
    case
      when event.event_type in ('error_recorded', 'reprocess_failed') then 'error'
      when event.event_type = 'rejected' then 'warn' else 'info'
    end,
    'legislative_update'::text, 'update_worker'::text,
    ('legislative_update_' || event.event_type)::text,
    case event.event_type
      when 'created' then 'Atualização legislativa criada.'
      when 'detected_again' then 'Atualização legislativa detectada novamente.'
      when 'superseded' then 'Atualização legislativa substituída.'
      when 'approved' then 'Atualização legislativa aprovada.'
      when 'rejected' then 'Atualização legislativa rejeitada.'
      when 'error_recorded' then 'Falha de atualização legislativa registrada.'
      when 'reprocess_requested' then 'Reprocessamento legislativo solicitado.'
      when 'reprocess_claimed' then 'Reprocessamento legislativo assumido.'
      when 'reprocess_completed' then 'Reprocessamento legislativo concluído.'
      else 'Reprocessamento legislativo falhou.'
    end,
    case when event.event_type in ('approved', 'rejected')
      then 'editor_juridico' else 'update_worker' end,
    update.lei_id, event.update_id
  from private.legislative_update_events event
  join public.updates_legislativos update on update.id = event.update_id
  where (p_before_sequence is null or event.event_id < p_before_sequence)
    and event.occurred_at <= p_cutoff
  order by event.event_id desc limit p_limit;
end
$function$;

create or replace function private.get_legislative_update_audit_event(
  p_actor_user_id uuid, p_event_sequence bigint
)
returns table (
  event_sequence bigint, occurred_at timestamptz, event_level text, event_module text,
  event_origin text, event_code text, display_message text, actor_role text,
  law_id uuid, correlation_id uuid, base_normative_sha256 text,
  candidate_normative_sha256 text, detail_code text
)
language plpgsql stable security definer set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_audit_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'audit reader identity required';
  end if;
  if not exists (
    select 1 from public.usuarios_perfil profile
    where profile.user_id = p_actor_user_id
      and profile.account_status = 'active' and profile.papel = 'administrador'
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;
  if p_event_sequence is null or p_event_sequence < 0 then
    raise exception using errcode = '22023', message = 'invalid audit event sequence';
  end if;
  return query
  select event.event_id, event.occurred_at,
    case
      when event.event_type in ('error_recorded', 'reprocess_failed') then 'error'
      when event.event_type = 'rejected' then 'warn' else 'info'
    end,
    'legislative_update'::text, 'update_worker'::text,
    ('legislative_update_' || event.event_type)::text,
    case event.event_type
      when 'created' then 'Atualização legislativa criada.'
      when 'detected_again' then 'Atualização legislativa detectada novamente.'
      when 'superseded' then 'Atualização legislativa substituída.'
      when 'approved' then 'Atualização legislativa aprovada.'
      when 'rejected' then 'Atualização legislativa rejeitada.'
      when 'error_recorded' then 'Falha de atualização legislativa registrada.'
      when 'reprocess_requested' then 'Reprocessamento legislativo solicitado.'
      when 'reprocess_claimed' then 'Reprocessamento legislativo assumido.'
      when 'reprocess_completed' then 'Reprocessamento legislativo concluído.'
      else 'Reprocessamento legislativo falhou.'
    end,
    case when event.event_type in ('approved', 'rejected')
      then 'editor_juridico' else 'update_worker' end,
    update.lei_id, event.update_id, update.base_normative_sha256,
    update.candidate_normative_sha256, event.detail_code
  from private.legislative_update_events event
  join public.updates_legislativos update on update.id = event.update_id
  where event.event_id = p_event_sequence;
end
$function$;

alter function private.list_legislative_update_audit_events(uuid, bigint, timestamptz, integer)
  owner to lex_update_owner;
alter function private.get_legislative_update_audit_event(uuid, bigint)
  owner to lex_update_owner;
revoke all on function private.list_legislative_update_audit_events(uuid, bigint, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function private.get_legislative_update_audit_event(uuid, bigint)
  from public, anon, authenticated;
grant execute on function private.list_legislative_update_audit_events(uuid, bigint, timestamptz, integer),
  private.get_legislative_update_audit_event(uuid, bigint) to lex_audit_reader;
