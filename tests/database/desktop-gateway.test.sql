\set ON_ERROR_STOP on

create role desktop_gateway_reader_test login;
create role desktop_gateway_unauthorized_test login;
grant lex_editor_reader to desktop_gateway_reader_test;

do $test$
begin
  if pg_catalog.has_table_privilege('desktop_gateway_reader_test', 'public.leis', 'SELECT')
    or pg_catalog.has_table_privilege('desktop_gateway_reader_test', 'public.versoes_lei', 'SELECT')
    or pg_catalog.has_table_privilege('desktop_gateway_reader_test', 'public.updates_legislativos', 'SELECT')
    or pg_catalog.has_table_privilege('desktop_gateway_reader_test', 'public.usuarios_perfil', 'SELECT')
    or pg_catalog.has_function_privilege('desktop_gateway_reader_test', 'private.publish_validated_release(jsonb)', 'EXECUTE') then
    raise exception 'desktop reader unexpectedly has broad authority';
  end if;
end
$test$;

-- Test parameters are shared separately; the reader never gains table access
-- to actual normative or editorial data.
create table public.test_desktop_gateway_identity (value jsonb not null);
insert into public.test_desktop_gateway_identity(value)
select pg_catalog.jsonb_build_object('tipoNorma', l.tipo, 'numero', l.numero, 'ano', l.ano, 'sigla', l.sigla)
  from public.leis l where l.id = '33333333-3333-4333-8333-333333333333';
grant select on public.test_desktop_gateway_identity to desktop_gateway_reader_test;

set session authorization desktop_gateway_reader_test;
do $test$
declare
  v_actor uuid := '44444444-4444-4444-8444-444444444444';
  v_admin uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_identity jsonb; v_context jsonb; v_history jsonb; v_inspection jsonb;
begin
  select value into v_identity from public.test_desktop_gateway_identity;
  if (select papel from private.get_desktop_editor_identity(v_actor)) <> 'curador' then
    raise exception 'session identity did not preserve editorial role';
  end if;
  v_context := private.get_desktop_publication_context(v_actor, v_identity->>'tipoNorma', v_identity->>'numero', (v_identity->>'ano')::integer, v_identity->>'sigla');
  if v_context->>'lawId' <> '33333333-3333-4333-8333-333333333333'
    or v_context->'current' is null or pg_catalog.jsonb_array_length(v_context->'blockIds') = 0 then
    raise exception 'registered context lacks current version and identity reservations';
  end if;
  if v_context ?| array['ast', 'snapshot', 'uri', 'path', 'sourceUrl', 'token', 'approvedBy'] then
    raise exception 'context contains privileged payload';
  end if;
  v_history := private.list_desktop_publication_history(v_actor, (v_context->>'lawId')::uuid, null, 1);
  if pg_catalog.jsonb_array_length(v_history->'items') <> 1 or (v_history->>'totalItems')::integer < 1 then
    raise exception 'history pagination omitted publication';
  end if;
  v_inspection := private.inspect_desktop_publication_history(v_actor, v_identity->>'tipoNorma', v_identity->>'numero', (v_identity->>'ano')::integer, v_identity->>'sigla');
  if v_inspection->>'availability' <> 'available' or pg_catalog.jsonb_array_length(v_inspection->'publishedVersionIds') < 1 then
    raise exception 'history evidence did not preserve version identities';
  end if;
  if private.inspect_desktop_publication_history(v_actor, v_identity->>'tipoNorma', v_identity->>'numero', (v_identity->>'ano')::integer, null)->>'availability' <> 'available' then
    raise exception 'canonical identity inspection incorrectly requires a sigla';
  end if;
  if private.get_desktop_publication_context(v_actor, 'lei', 'not-registered', 2026, 'UNKNOWN') is not null then
    raise exception 'unregistered law acquired a fabricated identity';
  end if;
  if private.inspect_desktop_publication_history(v_actor, 'lei', 'not-registered', 2026, 'UNKNOWN')->>'availability' <> 'unavailable' then
    raise exception 'unregistered law was falsely proved never published';
  end if;
  begin
    perform private.get_desktop_publication_context(v_admin, v_identity->>'tipoNorma', v_identity->>'numero', (v_identity->>'ano')::integer, v_identity->>'sigla');
    raise exception 'administrator acquired editorial authority';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.list_desktop_publication_history(v_actor, (v_context->>'lawId')::uuid, null, 101);
    raise exception 'oversized history page accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform private.list_desktop_publication_history(v_actor, (v_context->>'lawId')::uuid, null, null);
    raise exception 'null history limit accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    execute 'update public.leis set titulo = ''forged''';
    raise exception 'desktop reader mutated normative content';
  exception when insufficient_privilege then null;
  end;
end
$test$;
reset session authorization;
set session authorization desktop_gateway_unauthorized_test;
do $test$
begin
  begin
    perform * from private.get_desktop_editor_identity('44444444-4444-4444-8444-444444444444');
    raise exception 'unauthorized server identity read profile';
  exception when insufficient_privilege then null;
  end;
end
$test$;
reset session authorization;
