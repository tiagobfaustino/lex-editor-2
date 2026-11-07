-- Closed server-side reads for the authenticated desktop gateway. This role
-- has no table grants, mutations, publication EXECUTE or exposed Data API RPCs.
do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_editor_reader') then
    create role lex_editor_reader nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_editor_read_owner') then
    create role lex_editor_read_owner nologin noinherit;
  end if;
end
$roles$;
grant lex_editor_reader, lex_editor_read_owner to postgres;
grant usage on schema private, public to lex_editor_read_owner;
grant usage on schema private to lex_editor_reader;
grant select on public.usuarios_perfil, public.leis, public.versoes_lei,
  public.block_ids, public.block_id_redirects, public.updates_legislativos to lex_editor_read_owner;
create policy desktop_reader_profiles on public.usuarios_perfil for select to lex_editor_read_owner using (true);
create policy desktop_reader_laws on public.leis for select to lex_editor_read_owner using (true);
create policy desktop_reader_versions on public.versoes_lei for select to lex_editor_read_owner using (true);
create policy desktop_reader_blocks on public.block_ids for select to lex_editor_read_owner using (true);
create policy desktop_reader_redirects on public.block_id_redirects for select to lex_editor_read_owner using (true);
create policy desktop_reader_updates on public.updates_legislativos for select to lex_editor_read_owner using (true);

create function private.get_desktop_editor_identity(p_actor_user_id uuid)
returns table(user_id uuid, account_status text, papel text)
language plpgsql security definer set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_editor_reader', 'USAGE') then
    raise exception using errcode = '42501', message = 'desktop reader required';
  end if;
  return query select p.user_id, p.account_status, p.papel from public.usuarios_perfil p where p.user_id = p_actor_user_id;
end
$function$;

create function private.assert_desktop_editor(p_actor_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_editor_reader', 'USAGE') or not exists (
    select 1 from public.usuarios_perfil p where p.user_id = p_actor_user_id and p.account_status = 'active' and p.papel = 'curador'
  ) then
    raise exception using errcode = '42501', message = 'active legal editor required';
  end if;
end
$function$;

create function private.get_desktop_publication_context(
  p_actor_user_id uuid, p_tipo text, p_numero text, p_ano integer, p_sigla text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_law public.leis%rowtype; v_current jsonb;
begin
  perform private.assert_desktop_editor(p_actor_user_id);
  if p_tipo is null or p_numero is null or p_ano is null or p_sigla is null
    or pg_catalog.length(p_tipo) > 80 or pg_catalog.length(p_numero) > 80 or pg_catalog.length(p_sigla) > 40 then
    raise exception using errcode = '22023', message = 'invalid law identity';
  end if;
  select * into v_law from public.leis l where l.tipo = p_tipo and l.numero = p_numero and l.ano = p_ano and l.sigla = p_sigla;
  if not found then return null; end if;
  select pg_catalog.jsonb_build_object('versionId', v.id, 'version', v.versao_vinculex,
    'publicationNumber', v.numero_publicacao, 'gitCommitSha', v.git_commit_sha)
    into v_current from public.versoes_lei v where v.id = v_law.versao_publicada_id;
  return pg_catalog.jsonb_build_object(
    'lawId', v_law.id, 'sigla', v_law.sigla, 'lawTitle', v_law.titulo,
    'tipoNorma', v_law.tipo, 'numero', v_law.numero, 'ano', v_law.ano, 'current', v_current,
    'blockIds', (select coalesce(pg_catalog.jsonb_agg(b.block_id order by b.block_id), '[]'::jsonb) from public.block_ids b where b.lei_id = v_law.id),
    'redirects', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('antigo', r.origem_block_id, 'novo', r.destino_block_id) order by r.origem_block_id), '[]'::jsonb) from public.block_id_redirects r where r.lei_id = v_law.id)
  );
end
$function$;

create function private.inspect_desktop_publication_history(
  p_actor_user_id uuid, p_tipo text, p_numero text, p_ano integer, p_sigla text
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_context jsonb; v_ids jsonb; v_sigla text; v_matches integer;
begin
  perform private.assert_desktop_editor(p_actor_user_id);
  select pg_catalog.count(*), pg_catalog.min(l.sigla) into v_matches, v_sigla
    from public.leis l where l.tipo = p_tipo and l.numero = p_numero and l.ano = p_ano and (p_sigla is null or l.sigla = p_sigla);
  if v_matches <> 1 then
    return pg_catalog.jsonb_build_object('availability', 'unavailable', 'reason', 'authority_error');
  end if;
  v_context := private.get_desktop_publication_context(p_actor_user_id, p_tipo, p_numero, p_ano, v_sigla);
  if v_context is null then
    -- An unregistered identity is not proof of never having been published.
    return pg_catalog.jsonb_build_object('availability', 'unavailable', 'reason', 'authority_error');
  end if;
  select coalesce(pg_catalog.jsonb_agg(v.id order by v.numero_publicacao), '[]'::jsonb)
    into v_ids from public.versoes_lei v where v.lei_id = (v_context->>'lawId')::uuid;
  return pg_catalog.jsonb_build_object('availability', 'available',
    'authorityRevision', (v_context->>'lawId') || ':' || coalesce(v_context->'current'->>'versionId', 'none') || ':' || pg_catalog.jsonb_array_length(v_ids)::text,
    'publishedVersionIds', v_ids);
end
$function$;

create function private.list_desktop_publication_history(
  p_actor_user_id uuid, p_law_id uuid, p_before_number integer, p_limit integer
)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_items jsonb; v_total integer; v_more boolean; v_next text;
begin
  perform private.assert_desktop_editor(p_actor_user_id);
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_before_number is not null and p_before_number < 1) then
    raise exception using errcode = '22023', message = 'invalid page';
  end if;
  if not exists(select 1 from public.leis l where l.id = p_law_id) then
    raise exception using errcode = 'P0002', message = 'law not found';
  end if;
  select pg_catalog.count(*) into v_total from public.versoes_lei v where v.lei_id = p_law_id;
  select coalesce(pg_catalog.jsonb_agg(item.value order by item.numero_publicacao desc), '[]'::jsonb) into v_items from (
    select v.numero_publicacao, pg_catalog.jsonb_build_object(
      'versionId', v.id, 'lawId', v.lei_id, 'version', v.versao_vinculex,
      'publicationNumber', v.numero_publicacao, 'publicationKind', v.tipo_publicacao,
      'restoredVersionId', v.restaura_versao_id, 'gitCommitSha', v.git_commit_sha,
      'publishedAt', pg_catalog.to_char(v.publicado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'isCurrent', v.id = l.versao_publicada_id,
      'sourceSummary', coalesce(nullif(pg_catalog.left(pg_catalog.regexp_replace(v.changelog, '[\r\n]+', ' ', 'g'), 500), ''), 'Publicação registrada')
    ) as value from public.versoes_lei v join public.leis l on l.id = v.lei_id
      where v.lei_id = p_law_id and (p_before_number is null or v.numero_publicacao < p_before_number)
      order by v.numero_publicacao desc limit p_limit
  ) item;
  v_next := v_items->(pg_catalog.jsonb_array_length(v_items)-1)->>'publicationNumber';
  select exists(select 1 from public.versoes_lei v where v.lei_id = p_law_id and v.numero_publicacao < v_next::integer) into v_more;
  return pg_catalog.jsonb_build_object('items', v_items, 'nextCursor', case when v_more then v_next else null end, 'totalItems', v_total);
end
$function$;

create function private.get_desktop_update_list_item(p_actor_user_id uuid, p_update_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_result jsonb;
begin
  perform private.assert_desktop_editor(p_actor_user_id);
  select pg_catalog.jsonb_build_object(
    'updateId', u.id, 'lawId', u.lei_id, 'lawSigla', l.sigla, 'lawTitle', l.titulo, 'sourceUrl', u.source_url,
    'updateReviewStatus', u.update_review_status, 'summary', u.diff_summary, 'overallConfidence', u.overall_confidence,
    'requiresHumanReview', u.requires_human_review, 'detectedAt', pg_catalog.to_char(u.detected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastDetectedAt', pg_catalog.to_char(u.last_detected_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'detectionCount', u.detection_count, 'retryCount', u.retry_count, 'rejectionReason', u.rejection_reason,
    'errorCode', u.error_code, 'publicationId', u.publication_id,
    'reprocessRequested', (u.reprocess_requested_at is not null and u.reprocess_claimed_at is null)
  ) into v_result from public.updates_legislativos u join public.leis l on l.id = u.lei_id where u.id = p_update_id;
  if v_result is null then raise exception using errcode = 'P0002', message = 'update not found'; end if;
  return v_result;
end
$function$;

alter function private.get_desktop_editor_identity(uuid) owner to lex_editor_read_owner;
alter function private.assert_desktop_editor(uuid) owner to lex_editor_read_owner;
alter function private.get_desktop_publication_context(uuid,text,text,integer,text) owner to lex_editor_read_owner;
alter function private.inspect_desktop_publication_history(uuid,text,text,integer,text) owner to lex_editor_read_owner;
alter function private.list_desktop_publication_history(uuid,uuid,integer,integer) owner to lex_editor_read_owner;
alter function private.get_desktop_update_list_item(uuid,uuid) owner to lex_editor_read_owner;
revoke all on function private.get_desktop_editor_identity(uuid), private.assert_desktop_editor(uuid),
  private.get_desktop_publication_context(uuid,text,text,integer,text), private.inspect_desktop_publication_history(uuid,text,text,integer,text),
  private.list_desktop_publication_history(uuid,uuid,integer,integer), private.get_desktop_update_list_item(uuid,uuid)
  from public, anon, authenticated;
grant execute on function private.get_desktop_editor_identity(uuid), private.get_desktop_publication_context(uuid,text,text,integer,text),
  private.inspect_desktop_publication_history(uuid,text,text,integer,text), private.list_desktop_publication_history(uuid,uuid,integer,integer),
  private.get_desktop_update_list_item(uuid,uuid) to lex_editor_reader;
