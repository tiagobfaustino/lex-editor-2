\set ON_ERROR_STOP on

create role publisher_test login;
create role unauthorized_test login;
grant lex_publisher to publisher_test;

insert into auth.users (id) values ('44444444-4444-4444-8444-444444444444');
insert into public.usuarios_perfil (user_id, account_status, papel)
values ('44444444-4444-4444-8444-444444444444', 'active', 'curador');
insert into public.leis (
  id, sigla, titulo, tipo, numero, ano, ramo, fonte_url, data_publicacao
) values (
  '33333333-3333-4333-8333-333333333333', 'LDEM', 'Lei de demonstração',
  'lei ordinária', '1', 2026, 'teste', 'https://example.invalid/lei', '2026-08-10'
);

create table public.test_publication_payload (value jsonb not null);
insert into public.test_publication_payload (value)
values (jsonb_build_object(
  'publication', jsonb_build_object(
    'id', '11111111-1111-4111-8111-111111111111',
    'lawId', '33333333-3333-4333-8333-333333333333',
    'idempotencyKey', '22222222-2222-4222-8222-222222222222',
    'version', '1.0.0',
    'publicationNumber', 1,
    'kind', 'initial',
    'restoredVersionId', null,
    'gitCommitSha', repeat('a', 40),
    'manifestDigest', repeat('c', 64),
    'approvedBy', '44444444-4444-4444-8444-444444444444',
    'expectedPublishedVersionId', null,
    'expectedGitBaseSha', repeat('b', 40)
  ),
  'projection', jsonb_build_object(
    'lei', jsonb_build_object(
      'sigla', 'LDEM', 'titulo', 'Lei de demonstração', 'tipo', 'lei ordinária',
      'numero', '1', 'ano', 2026, 'ramo', 'teste',
      'fonte_url', 'https://example.invalid/lei',
      'data_publicacao', '2026-08-10', 'legal_status', 'vigente'
    ),
    'version', jsonb_build_object(
      'data_atualizacao_legal', '2026-08-10',
      'data_formatacao_vinculex', '2026-08-10',
      'total_artigos', 1, 'tags', jsonb_build_array(), 'revogada_por', null,
      'redacoes_dadas_por', jsonb_build_array(), 'ids_depreciados', jsonb_build_array(),
      'fontes_secundarias', jsonb_build_array(),
      'data_verificacao_integridade', '2026-08-10',
      'avisos_atualizacao', jsonb_build_array(), 'notas_editoriais', jsonb_build_array()
    ),
    'raiz', jsonb_build_object(
      'id', 'norma-raiz', 'ordem', 0,
      'source_ref', jsonb_build_object('sourceArtifactSha256', repeat('d', 64)),
      'supporting_source_refs', jsonb_build_array(),
      'parse_evidence', jsonb_build_object('method', 'test')
    )
  ),
  'changelog', E'# Atualizações\n\n- Publicação inicial.\n',
  'changes', jsonb_build_object(
    'added', jsonb_build_array('ldem-art-1'), 'modified', jsonb_build_array(),
    'revoked', jsonb_build_array(), 'renumbered', jsonb_build_array()
  ),
  'sourceArtifacts', jsonb_build_array(jsonb_build_object(
    'sourceType', 'planalto_html', 'sourceRole', 'primary_current',
    'sourceVariant', 'compiled', 'sourceUrl', 'https://example.invalid/lei',
    'finalUrl', 'https://example.invalid/lei', 'artifactSha256', repeat('d', 64),
    'artifactUri', 'git:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:snapshot',
    'capturedAt', '2026-08-10T14:00:00.000Z'
  )),
  'blockIds', jsonb_build_array('ldem-art-1'),
  'redirects', jsonb_build_array(),
  'devices', jsonb_build_array(jsonb_build_object(
    'id', '55555555-5555-4555-8555-555555555555', 'parentId', null,
    'row', jsonb_build_object(
      'tipo', 'artigo', 'block_id', 'ldem-art-1', 'numero', '1',
      'titulo', null, 'texto', 'Texto do artigo.', 'conteudo_estruturado', null,
      'ordem', 0, 'device_status', 'active', 'nota_status', null,
      'preservar_texto_revogado', null, 'redacao_atual_dada_por', null,
      'redacoes_anteriores', jsonb_build_array(), 'renumerado_para_block_id', null,
      'source_ref', jsonb_build_object('sourceArtifactSha256', repeat('d', 64)),
      'supporting_source_refs', jsonb_build_array(),
      'parse_evidence', jsonb_build_object('method', 'test')
    )
  ))
));
grant select on public.test_publication_payload to publisher_test;

set session authorization publisher_test;
select private.record_publication_approval(
  '77777777-7777-4777-8777-777777777777',
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444',
  repeat('c', 64),
  '2026-08-10T16:00:00.000Z'
);
select private.prepare_publication_attempt(value) from public.test_publication_payload;
select private.mark_publication_attempt(
  '11111111-1111-4111-8111-111111111111', repeat('a', 40), 'syncing'
);
select private.publish_validated_release(value) from public.test_publication_payload;
-- Idempotência: repetir a transação retorna a mesma versão, sem novos inserts.
select private.publish_validated_release(value) from public.test_publication_payload;
select private.find_published_publication(
  '11111111-1111-4111-8111-111111111111',
  repeat('a', 40),
  '44444444-4444-4444-8444-444444444444'
);
select private.get_publication_attempt(
  '11111111-1111-4111-8111-111111111111',
  '44444444-4444-4444-8444-444444444444'
);
reset session authorization;

do $assertions$
declare
  v_version_id uuid;
begin
  select versao_publicada_id into v_version_id
  from public.leis where id = '33333333-3333-4333-8333-333333333333';
  if v_version_id is null then raise exception 'public pointer was not switched'; end if;
  if (select count(*) from public.versoes_lei) <> 1 then
    raise exception 'publication was not idempotent';
  end if;
  if (select count(*) from public.dispositivos where versao_lei_id = v_version_id) <> 1 then
    raise exception 'device snapshot is incomplete';
  end if;
  if (select publication_attempt_status from public.publicacoes
      where id = '11111111-1111-4111-8111-111111111111') <> 'published' then
    raise exception 'attempt was not completed';
  end if;
  if pg_catalog.has_function_privilege(
      'authenticated', 'private.publish_validated_release(jsonb)', 'EXECUTE') then
    raise exception 'authenticated must not execute publication';
  end if;
  if pg_catalog.has_function_privilege(
      'authenticated', 'private.find_published_publication(uuid,text,uuid)', 'EXECUTE') then
    raise exception 'authenticated must not query publication attempts';
  end if;
  if pg_catalog.has_function_privilege(
      'authenticated', 'private.get_publication_attempt(uuid,uuid)', 'EXECUTE') then
    raise exception 'authenticated must not inspect publication attempts';
  end if;
  if pg_catalog.has_table_privilege('authenticated', 'public.versoes_lei', 'INSERT') then
    raise exception 'authenticated must not insert versions';
  end if;
  if pg_catalog.has_table_privilege('anon', 'public.publicacoes', 'UPDATE') then
    raise exception 'anon must not mutate publication attempts';
  end if;
  if pg_catalog.has_table_privilege('lex_publisher', 'public.leis', 'UPDATE')
    or pg_catalog.has_table_privilege('lex_publisher', 'public.versoes_lei', 'INSERT')
    or pg_catalog.has_table_privilege('lex_publisher', 'public.publicacoes', 'UPDATE') then
    raise exception 'publisher must only mutate data through the private functions';
  end if;
  if not exists (
    select 1
    from private.publication_approvals as approval
    join public.publicacoes as attempt on attempt.id = approval.publication_id
    join public.versoes_lei as version on version.id = attempt.versao_lei_id
    join private.publication_events as event on event.publication_id = attempt.id
    where attempt.id = '11111111-1111-4111-8111-111111111111'
      and approval.user_id = attempt.publicado_por
      and approval.manifest_digest = attempt.conteudo_sha256
      and version.git_commit_sha = attempt.git_commit_sha
      and version.versao_vinculex = attempt.versao_vinculex
      and event.event_type = 'published'
      and event.manifest_digest = attempt.conteudo_sha256
      and event.git_commit_sha = attempt.git_commit_sha
  ) then
    raise exception 'audit trail does not bind approval, publication, SHA, version and result';
  end if;
end
$assertions$;
