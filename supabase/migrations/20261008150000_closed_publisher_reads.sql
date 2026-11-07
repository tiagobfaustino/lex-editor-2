-- Server-only evidence reads; the workload receives no direct table access.
create function private.get_publisher_editor_identity(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_identity jsonb;
begin
  perform private.assert_publisher_identity();
  select pg_catalog.jsonb_build_object('userId', p.user_id,
    'accountStatus', p.account_status, 'papel', p.papel)
    into v_identity from public.usuarios_perfil p where p.user_id = p_user_id;
  return v_identity;
end
$function$;

create function private.get_publisher_publication_baseline(p_law_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_baseline jsonb;
begin
  perform private.assert_publisher_identity();
  select pg_catalog.jsonb_build_object(
    'lawId', law.id, 'publishedVersionId', law.versao_publicada_id,
    'gitCommitSha', version.git_commit_sha, 'version', version.versao_vinculex,
    'publicationNumber', version.numero_publicacao,
    'historicalBlockIds', (select coalesce(pg_catalog.jsonb_agg(b.block_id order by b.block_id), '[]'::jsonb)
      from public.block_ids b where b.lei_id = law.id),
    'redirects', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'antigo', r.origem_block_id, 'novo', r.destino_block_id) order by r.origem_block_id), '[]'::jsonb)
      from public.block_id_redirects r where r.lei_id = law.id)
  ) into v_baseline from public.leis law
  left join public.versoes_lei version on version.id = law.versao_publicada_id
  where law.id = p_law_id;
  return v_baseline;
end
$function$;

create function private.get_publisher_historical_version(p_law_id uuid, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_version jsonb;
begin
  perform private.assert_publisher_identity();
  select pg_catalog.jsonb_build_object(
    'lawId', version.lei_id, 'versionId', version.id,
    'gitCommitSha', version.git_commit_sha, 'version', version.versao_vinculex,
    'publicationNumber', version.numero_publicacao, 'publicationId', publication.id,
    'manifestDigest', publication.conteudo_sha256
  ) into v_version from public.versoes_lei version
  join public.publicacoes publication on publication.versao_lei_id = version.id
    and publication.lei_id = version.lei_id
    and publication.publication_attempt_status = 'published'
    and publication.git_commit_sha = version.git_commit_sha
  where version.lei_id = p_law_id and version.id = p_version_id;
  return v_version;
end
$function$;

alter function private.get_publisher_editor_identity(uuid) owner to lex_publication_owner;
alter function private.get_publisher_publication_baseline(uuid) owner to lex_publication_owner;
alter function private.get_publisher_historical_version(uuid,uuid) owner to lex_publication_owner;
revoke all on function private.get_publisher_editor_identity(uuid),
  private.get_publisher_publication_baseline(uuid),
  private.get_publisher_historical_version(uuid,uuid) from public, anon, authenticated;
grant execute on function private.get_publisher_editor_identity(uuid),
  private.get_publisher_publication_baseline(uuid),
  private.get_publisher_historical_version(uuid,uuid) to lex_publisher;
