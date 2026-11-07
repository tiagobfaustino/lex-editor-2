\set ON_ERROR_STOP on

do $test$
begin
  if pg_catalog.has_table_privilege('publisher_test', 'public.usuarios_perfil', 'SELECT')
    or pg_catalog.has_table_privilege('publisher_test', 'public.leis', 'SELECT')
    or pg_catalog.has_table_privilege('publisher_test', 'public.versoes_lei', 'SELECT')
    or pg_catalog.has_table_privilege('publisher_test', 'public.publicacoes', 'SELECT')
    or pg_catalog.has_table_privilege('publisher_test', 'public.block_ids', 'SELECT') then
    raise exception 'publisher unexpectedly gained direct normative reads';
  end if;
  if pg_catalog.has_function_privilege('unauthorized_test', 'private.get_publisher_editor_identity(uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('update_worker_test', 'private.get_publisher_publication_baseline(uuid)', 'EXECUTE')
    or pg_catalog.has_function_privilege('desktop_gateway_reader_test', 'private.get_publisher_historical_version(uuid,uuid)', 'EXECUTE') then
    raise exception 'publisher evidence reads escaped the workload role';
  end if;
end
$test$;

set session authorization publisher_test;
do $test$
declare
  v_law uuid := '33333333-3333-4333-8333-333333333333';
  v_identity jsonb;
  v_base jsonb;
  v_history jsonb;
begin
  v_identity := private.get_publisher_editor_identity('44444444-4444-4444-8444-444444444444');
  if v_identity->>'papel' <> 'curador' or v_identity->>'accountStatus' <> 'active' then
    raise exception 'publisher identity failed to read the authoritative role';
  end if;
  if private.get_publisher_editor_identity('ffffffff-ffff-4fff-8fff-ffffffffffff') is not null then
    raise exception 'unknown identity was provisioned';
  end if;
  v_base := private.get_publisher_publication_baseline(v_law);
  if v_base->>'lawId' <> v_law::text or v_base->>'version' <> '1.0.0'
    or pg_catalog.jsonb_array_length(v_base->'historicalBlockIds') = 0 then
    raise exception 'publisher baseline lacks authoritative published namespace';
  end if;
  v_history := private.get_publisher_historical_version(v_law, (v_base->>'publishedVersionId')::uuid);
  if v_history->>'manifestDigest' <> repeat('c', 64)
    or v_history->>'gitCommitSha' <> repeat('a', 40)
    or v_history->>'publicationId' <> '11111111-1111-4111-8111-111111111111' then
    raise exception 'historical evidence did not preserve immutable coordinates';
  end if;
  if private.get_publisher_historical_version('ffffffff-ffff-4fff-8fff-ffffffffffff', (v_base->>'publishedVersionId')::uuid) is not null then
    raise exception 'historical version crossed a law boundary';
  end if;
end
$test$;
reset session authorization;
