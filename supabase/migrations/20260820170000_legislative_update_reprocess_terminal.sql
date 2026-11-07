-- Feature 013: resultado terminal idempotente na correlação do reprocessamento do worker.

alter table private.legislative_update_events
  drop constraint legislative_update_events_event_type_check;

alter table private.legislative_update_events
  add constraint legislative_update_events_event_type_check check (event_type in (
    'created', 'detected_again', 'superseded', 'approved', 'rejected',
    'error_recorded', 'reprocess_requested', 'reprocess_claimed',
    'reprocess_completed', 'reprocess_failed'
  ));

create unique index legislative_update_reprocess_terminal_once_idx
  on private.legislative_update_events (update_id)
  where event_type in ('reprocess_completed', 'reprocess_failed');

create or replace function private.complete_legislative_update_reprocess(
  p_update_id uuid,
  p_outcome text,
  p_detail_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_type text;
begin
  perform private.assert_update_worker_identity();
  if p_outcome not in ('completed', 'failed') then
    raise exception using errcode = '22023', message = 'invalid reprocess outcome';
  end if;
  v_event_type := 'reprocess_' || p_outcome;
  update public.updates_legislativos
    set reprocess_requested_at = null, reprocess_claimed_at = null
    where id = p_update_id and reprocess_claimed_at is not null;
  if not found then
    return pg_catalog.jsonb_build_object('recorded', false);
  end if;
  insert into private.legislative_update_events (update_id, event_type, detail_code)
    values (p_update_id, v_event_type, p_detail_code)
    on conflict (update_id) where event_type in ('reprocess_completed', 'reprocess_failed') do nothing;
  return pg_catalog.jsonb_build_object('recorded', found);
end
$function$;

alter function private.complete_legislative_update_reprocess(uuid, text, text)
  owner to lex_update_owner;
revoke all on function private.complete_legislative_update_reprocess(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.complete_legislative_update_reprocess(uuid, text, text)
  to lex_update_worker;
