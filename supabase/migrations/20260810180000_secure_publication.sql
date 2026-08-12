-- Feature 007: autoridade fechada e transação atômica de publicação.
-- Pré-requisito: schema normativo de DATA_MODEL.md já aplicado.

do $roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_publication_owner') then
    create role lex_publication_owner nologin noinherit;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'lex_publisher') then
    create role lex_publisher nologin noinherit;
  end if;
end
$roles$;

-- No Supabase gerenciado, `postgres` não é superusuário. A associação permite
-- que a migration atribua ownership ao papel sem login e que o workload
-- server-side invoque somente as funções concedidas a `lex_publisher`.
grant lex_publication_owner, lex_publisher to postgres;

create schema if not exists private authorization lex_publication_owner;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to lex_publisher;
grant usage on schema private to lex_publication_owner;

alter table public.versoes_lei
  add column if not exists raiz_id text,
  add column if not exists raiz_ordem integer,
  add column if not exists raiz_source_ref jsonb,
  add column if not exists raiz_supporting_source_refs jsonb default '[]'::jsonb,
  add column if not exists raiz_parse_evidence jsonb;

alter table public.versoes_lei
  add constraint versoes_lei_raiz_ordem_check check (raiz_ordem >= 0) not valid,
  add constraint versoes_lei_raiz_source_ref_check
    check (raiz_source_ref is null or jsonb_typeof(raiz_source_ref) = 'object') not valid,
  add constraint versoes_lei_raiz_supporting_refs_check
    check (
      raiz_supporting_source_refs is null
      or jsonb_typeof(raiz_supporting_source_refs) = 'array'
    ) not valid,
  add constraint versoes_lei_raiz_evidence_check
    check (raiz_parse_evidence is null or jsonb_typeof(raiz_parse_evidence) = 'object') not valid;

alter table public.publicacoes
  add column if not exists resume_from_status text
    check (resume_from_status in ('pushed', 'syncing'));

create table if not exists private.publication_approvals (
  approval_id uuid primary key,
  publication_id uuid not null unique,
  user_id uuid not null references auth.users(id),
  approval_role text not null check (approval_role = 'editor_juridico'),
  manifest_digest text not null check (manifest_digest ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now()
);

create table if not exists private.publication_events (
  event_id bigint generated always as identity primary key,
  publication_id uuid not null,
  event_type text not null check (event_type in (
    'approval_recorded', 'pushed', 'syncing', 'published', 'failed'
  )),
  actor_user_id uuid references auth.users(id),
  manifest_digest text check (manifest_digest is null or manifest_digest ~ '^[0-9a-f]{64}$'),
  git_commit_sha text check (
    git_commit_sha is null or git_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  ),
  failure_code text,
  occurred_at timestamptz not null default pg_catalog.now()
);

alter table private.publication_approvals owner to lex_publication_owner;
alter table private.publication_events owner to lex_publication_owner;

grant select on public.usuarios_perfil to lex_publication_owner;
grant select, update on public.leis to lex_publication_owner;
grant select, insert on public.versoes_lei to lex_publication_owner;
grant insert on public.artefatos_fonte, public.dispositivos to lex_publication_owner;
grant select, insert on public.block_ids to lex_publication_owner;
grant select, insert, update on public.block_id_redirects to lex_publication_owner;
grant select, insert, update on public.publicacoes to lex_publication_owner;

revoke all on private.publication_approvals, private.publication_events from public, anon, authenticated;
revoke all on private.publication_approvals, private.publication_events from lex_publisher;

create or replace function private.assert_publisher_identity()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'lex_publisher', 'USAGE') then
    raise exception using errcode = '42501', message = 'publisher identity required';
  end if;
end
$function$;

alter function private.assert_publisher_identity() owner to lex_publication_owner;
revoke all on function private.assert_publisher_identity() from public, anon, authenticated;

create or replace function private.record_publication_approval(
  p_approval_id uuid,
  p_publication_id uuid,
  p_user_id uuid,
  p_manifest_digest text,
  p_approved_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing private.publication_approvals%rowtype;
begin
  perform private.assert_publisher_identity();
  if p_manifest_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid manifest digest';
  end if;
  if not exists (
    select 1
    from public.usuarios_perfil as profile
    where profile.user_id = p_user_id
      and profile.account_status = 'active'
      and profile.papel = 'curador'
  ) then
    raise exception using errcode = '42501', message = 'active legal editor required';
  end if;

  select * into v_existing
  from private.publication_approvals
  where publication_id = p_publication_id;
  if found then
    if v_existing.user_id <> p_user_id or v_existing.manifest_digest <> p_manifest_digest then
      raise exception using errcode = '23505', message = 'immutable approval conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'approvalId', v_existing.approval_id,
      'publicationId', v_existing.publication_id,
      'userId', v_existing.user_id,
      'role', v_existing.approval_role,
      'manifestDigest', v_existing.manifest_digest,
      'approvedAt', v_existing.approved_at
    );
  end if;

  insert into private.publication_approvals (
    approval_id, publication_id, user_id, approval_role, manifest_digest, approved_at
  ) values (
    p_approval_id, p_publication_id, p_user_id, 'editor_juridico',
    p_manifest_digest, p_approved_at
  );
  insert into private.publication_events (
    publication_id, event_type, actor_user_id, manifest_digest
  ) values (p_publication_id, 'approval_recorded', p_user_id, p_manifest_digest);
  return pg_catalog.jsonb_build_object(
    'approvalId', p_approval_id,
    'publicationId', p_publication_id,
    'userId', p_user_id,
    'role', 'editor_juridico',
    'manifestDigest', p_manifest_digest,
    'approvedAt', p_approved_at
  );
end
$function$;

alter function private.record_publication_approval(uuid, uuid, uuid, text, timestamptz)
  owner to lex_publication_owner;
revoke all on function private.record_publication_approval(uuid, uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function private.record_publication_approval(uuid, uuid, uuid, text, timestamptz)
  to lex_publisher;

create or replace function private.prepare_publication_attempt(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_publication jsonb := p_payload -> 'publication';
  v_attempt public.publicacoes%rowtype;
  v_law_id uuid := (v_publication ->> 'lawId')::uuid;
  v_publication_id uuid := (v_publication ->> 'id')::uuid;
  v_candidate_sha text := v_publication ->> 'gitCommitSha';
  v_digest text := v_publication ->> 'manifestDigest';
begin
  perform private.assert_publisher_identity();
  perform 1 from public.leis where id = v_law_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'law not found';
  end if;
  if v_candidate_sha !~ '^[0-9a-f]{40}([0-9a-f]{24})?$' or v_digest !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid publication hashes';
  end if;
  if not exists (
    select 1 from private.publication_approvals as approval
    join public.usuarios_perfil as profile on profile.user_id = approval.user_id
    where approval.publication_id = v_publication_id
      and approval.user_id = (v_publication ->> 'approvedBy')::uuid
      and approval.manifest_digest = v_digest
      and profile.account_status = 'active'
      and profile.papel = 'curador'
  ) then
    raise exception using errcode = '42501', message = 'matching active approval required';
  end if;

  select * into v_attempt from public.publicacoes where id = v_publication_id;
  if found then
    if v_attempt.lei_id <> v_law_id
      or v_attempt.idempotency_key <> (v_publication ->> 'idempotencyKey')::uuid
      or v_attempt.git_commit_sha <> v_candidate_sha
      or v_attempt.conteudo_sha256 <> v_digest
      or v_attempt.versao_vinculex <> v_publication ->> 'version'
    then
      raise exception using errcode = '23505', message = 'idempotency conflict';
    end if;
  else
    insert into public.publicacoes (
      id, lei_id, idempotency_key, versao_vinculex,
      publication_attempt_status, git_commit_sha, conteudo_sha256, publicado_por
    ) values (
      v_publication_id, v_law_id, (v_publication ->> 'idempotencyKey')::uuid,
      v_publication ->> 'version', 'pushed', v_candidate_sha, v_digest,
      (v_publication ->> 'approvedBy')::uuid
    ) returning * into v_attempt;
    insert into private.publication_events (
      publication_id, event_type, actor_user_id, manifest_digest, git_commit_sha
    ) values (
      v_publication_id, 'pushed', (v_publication ->> 'approvedBy')::uuid,
      v_digest, v_candidate_sha
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'publicationId', v_attempt.id,
    'candidateSha', v_attempt.git_commit_sha,
    'manifestDigest', v_attempt.conteudo_sha256,
    'publicationAttemptStatus', v_attempt.publication_attempt_status,
    'resumeFromStatus', v_attempt.resume_from_status,
    'publishedVersionId', v_attempt.versao_lei_id
  );
end
$function$;

alter function private.prepare_publication_attempt(jsonb) owner to lex_publication_owner;
revoke all on function private.prepare_publication_attempt(jsonb) from public, anon, authenticated;
grant execute on function private.prepare_publication_attempt(jsonb) to lex_publisher;

create or replace function private.find_published_publication(
  p_publication_id uuid,
  p_candidate_sha text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.publicacoes%rowtype;
begin
  perform private.assert_publisher_identity();
  if p_candidate_sha !~ '^[0-9a-f]{40}([0-9a-f]{24})?$' then
    raise exception using errcode = '22023', message = 'invalid candidate sha';
  end if;
  select attempt.* into v_attempt
  from public.publicacoes as attempt
  join public.usuarios_perfil as profile on profile.user_id = attempt.publicado_por
  where attempt.id = p_publication_id
    and attempt.git_commit_sha = p_candidate_sha
    and attempt.publicado_por = p_actor_user_id
    and attempt.publication_attempt_status = 'published'
    and profile.account_status = 'active'
    and profile.papel = 'curador';
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'publicationId', v_attempt.id,
    'candidateSha', v_attempt.git_commit_sha,
    'manifestDigest', v_attempt.conteudo_sha256,
    'publicationAttemptStatus', v_attempt.publication_attempt_status,
    'resumeFromStatus', v_attempt.resume_from_status,
    'publishedVersionId', v_attempt.versao_lei_id
  );
end
$function$;

alter function private.find_published_publication(uuid, text, uuid)
  owner to lex_publication_owner;
revoke all on function private.find_published_publication(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function private.find_published_publication(uuid, text, uuid)
  to lex_publisher;

create or replace function private.get_publication_attempt(
  p_publication_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.publicacoes%rowtype;
begin
  perform private.assert_publisher_identity();
  select attempt.* into v_attempt
  from public.publicacoes as attempt
  join public.usuarios_perfil as profile on profile.user_id = attempt.publicado_por
  where attempt.id = p_publication_id
    and attempt.publicado_por = p_actor_user_id
    and profile.account_status = 'active'
    and profile.papel = 'curador';
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'publicationId', v_attempt.id,
    'candidateSha', v_attempt.git_commit_sha,
    'manifestDigest', v_attempt.conteudo_sha256,
    'publicationAttemptStatus', v_attempt.publication_attempt_status,
    'resumeFromStatus', v_attempt.resume_from_status,
    'publishedVersionId', v_attempt.versao_lei_id
  );
end
$function$;

alter function private.get_publication_attempt(uuid, uuid) owner to lex_publication_owner;
revoke all on function private.get_publication_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.get_publication_attempt(uuid, uuid)
  to lex_publisher;

create or replace function private.mark_publication_attempt(
  p_publication_id uuid,
  p_candidate_sha text,
  p_target_status text,
  p_resume_from_status text default null,
  p_failure_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt public.publicacoes%rowtype;
begin
  perform private.assert_publisher_identity();
  select * into v_attempt from public.publicacoes where id = p_publication_id for update;
  if not found or v_attempt.git_commit_sha <> p_candidate_sha then
    raise exception using errcode = 'P0002', message = 'publication attempt not found';
  end if;
  if p_target_status = 'syncing' then
    if v_attempt.publication_attempt_status not in ('pushed', 'syncing', 'failed')
      or (v_attempt.publication_attempt_status = 'failed' and v_attempt.resume_from_status <> 'syncing')
    then
      raise exception using errcode = '22023', message = 'invalid transition to syncing';
    end if;
    update public.publicacoes
    set publication_attempt_status = 'syncing', resume_from_status = null,
        ultimo_erro = null, tentativas_sync = tentativas_sync + 1,
        atualizado_em = pg_catalog.now()
    where id = p_publication_id returning * into v_attempt;
  elsif p_target_status = 'failed'
    and p_resume_from_status in ('pushed', 'syncing')
    and (
      v_attempt.publication_attempt_status = p_resume_from_status
      or (
        v_attempt.publication_attempt_status = 'failed'
        and v_attempt.resume_from_status = p_resume_from_status
      )
    )
  then
    update public.publicacoes
    set publication_attempt_status = 'failed', resume_from_status = p_resume_from_status,
        ultimo_erro = p_failure_code, atualizado_em = pg_catalog.now()
    where id = p_publication_id returning * into v_attempt;
  else
    raise exception using errcode = '22023', message = 'invalid publication transition';
  end if;
  insert into private.publication_events (
    publication_id, event_type, actor_user_id, manifest_digest, git_commit_sha, failure_code
  ) values (
    v_attempt.id, p_target_status, v_attempt.publicado_por,
    v_attempt.conteudo_sha256, v_attempt.git_commit_sha, p_failure_code
  );
  return pg_catalog.jsonb_build_object(
    'publicationId', v_attempt.id,
    'candidateSha', v_attempt.git_commit_sha,
    'manifestDigest', v_attempt.conteudo_sha256,
    'publicationAttemptStatus', v_attempt.publication_attempt_status,
    'resumeFromStatus', v_attempt.resume_from_status,
    'publishedVersionId', v_attempt.versao_lei_id
  );
end
$function$;

alter function private.mark_publication_attempt(uuid, text, text, text, text)
  owner to lex_publication_owner;
revoke all on function private.mark_publication_attempt(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function private.mark_publication_attempt(uuid, text, text, text, text)
  to lex_publisher;

create or replace function private.publish_validated_release(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_publication jsonb := p_payload -> 'publication';
  v_projection jsonb := p_payload -> 'projection';
  v_law public.leis%rowtype;
  v_attempt public.publicacoes%rowtype;
  v_version_id uuid := pg_catalog.gen_random_uuid();
  v_law_id uuid := (v_publication ->> 'lawId')::uuid;
  v_publication_id uuid := (v_publication ->> 'id')::uuid;
  v_expected_version_id uuid := nullif(v_publication ->> 'expectedPublishedVersionId', '')::uuid;
  v_current_git_sha text;
begin
  perform private.assert_publisher_identity();
  select * into v_law from public.leis where id = v_law_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'law not found'; end if;

  select * into v_attempt from public.publicacoes where id = v_publication_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'attempt not prepared'; end if;
  if v_attempt.lei_id <> v_law_id
    or v_attempt.git_commit_sha <> v_publication ->> 'gitCommitSha'
    or v_attempt.conteudo_sha256 <> v_publication ->> 'manifestDigest'
  then
    raise exception using errcode = '22023', message = 'attempt evidence mismatch';
  end if;
  if v_attempt.publication_attempt_status = 'published' then
    return pg_catalog.jsonb_build_object(
      'publicationId', v_attempt.id, 'candidateSha', v_attempt.git_commit_sha,
      'manifestDigest', v_attempt.conteudo_sha256,
      'publicationAttemptStatus', 'published', 'resumeFromStatus', null,
      'publishedVersionId', v_attempt.versao_lei_id
    );
  end if;
  if v_attempt.publication_attempt_status <> 'syncing' then
    raise exception using errcode = '22023', message = 'attempt evidence mismatch';
  end if;
  if v_law.versao_publicada_id is distinct from v_expected_version_id then
    raise exception using errcode = '40001', message = 'published pointer changed';
  end if;
  if v_law.versao_publicada_id is not null then
    select version.git_commit_sha into v_current_git_sha
    from public.versoes_lei as version where version.id = v_law.versao_publicada_id;
    if v_current_git_sha <> v_publication ->> 'expectedGitBaseSha' then
      raise exception using errcode = '40001', message = 'git base changed';
    end if;
  end if;
  if pg_catalog.jsonb_array_length(p_payload -> 'sourceArtifacts') < 1
    or (select count(*) from pg_catalog.jsonb_array_elements(p_payload -> 'sourceArtifacts') as source
        where source ->> 'sourceRole' = 'primary_current') <> 1
  then
    raise exception using errcode = '22023', message = 'exactly one primary source required';
  end if;

  insert into public.versoes_lei (
    id, lei_id, numero_publicacao, versao_vinculex, tipo_publicacao,
    restaura_versao_id, git_commit_sha, conteudo_sha256,
    data_atualizacao_legal, data_formatacao_vinculex, total_artigos,
    tags, revogada_por, redacoes_dadas_por, ids_depreciados, fontes_secundarias,
    data_verificacao_integridade, avisos_atualizacao, notas_editoriais,
    raiz_id, raiz_ordem, raiz_source_ref, raiz_supporting_source_refs,
    raiz_parse_evidence, changelog, mudancas, aprovado_por
  ) values (
    v_version_id, v_law_id, (v_publication ->> 'publicationNumber')::integer,
    v_publication ->> 'version', v_publication ->> 'kind',
    nullif(v_publication ->> 'restoredVersionId', '')::uuid,
    v_publication ->> 'gitCommitSha', v_publication ->> 'manifestDigest',
    (v_projection -> 'version' ->> 'data_atualizacao_legal')::date,
    (v_projection -> 'version' ->> 'data_formatacao_vinculex')::date,
    (v_projection -> 'version' ->> 'total_artigos')::integer,
    array(select pg_catalog.jsonb_array_elements_text(v_projection -> 'version' -> 'tags')),
    v_projection -> 'version' ->> 'revogada_por',
    v_projection -> 'version' -> 'redacoes_dadas_por',
    v_projection -> 'version' -> 'ids_depreciados',
    array(select pg_catalog.jsonb_array_elements_text(v_projection -> 'version' -> 'fontes_secundarias')),
    (v_projection -> 'version' ->> 'data_verificacao_integridade')::date,
    array(select pg_catalog.jsonb_array_elements_text(v_projection -> 'version' -> 'avisos_atualizacao')),
    array(select pg_catalog.jsonb_array_elements_text(v_projection -> 'version' -> 'notas_editoriais')),
    v_projection -> 'raiz' ->> 'id', (v_projection -> 'raiz' ->> 'ordem')::integer,
    v_projection -> 'raiz' -> 'source_ref',
    v_projection -> 'raiz' -> 'supporting_source_refs',
    v_projection -> 'raiz' -> 'parse_evidence',
    p_payload ->> 'changelog', p_payload -> 'changes',
    (v_publication ->> 'approvedBy')::uuid
  );

  insert into public.artefatos_fonte (
    versao_lei_id, source_type, source_role, source_variant, source_url,
    final_url, artifact_sha256, artifact_uri, captured_at
  )
  select v_version_id, source ->> 'sourceType', source ->> 'sourceRole',
    source ->> 'sourceVariant', source ->> 'sourceUrl', source ->> 'finalUrl',
    source ->> 'artifactSha256', source ->> 'artifactUri',
    (source ->> 'capturedAt')::timestamptz
  from pg_catalog.jsonb_array_elements(p_payload -> 'sourceArtifacts') as source;

  insert into public.block_ids (lei_id, block_id, primeira_versao_id)
  select v_law_id, value, v_version_id
  from pg_catalog.jsonb_array_elements_text(p_payload -> 'blockIds')
  on conflict (lei_id, block_id) do nothing;

  insert into public.block_id_redirects (
    lei_id, origem_block_id, destino_block_id, criado_em_versao_id, motivo
  )
  select v_law_id, redirect ->> 'from', redirect ->> 'to', v_version_id,
    redirect ->> 'reason'
  from pg_catalog.jsonb_array_elements(p_payload -> 'redirects') as redirect
  on conflict (lei_id, origem_block_id) do update
    set destino_block_id = excluded.destino_block_id
    where public.block_id_redirects.destino_block_id = excluded.destino_block_id;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'redirects') as redirect
    join public.block_id_redirects as persisted
      on persisted.lei_id = v_law_id and persisted.origem_block_id = redirect ->> 'from'
    where persisted.destino_block_id <> redirect ->> 'to'
  ) then
    raise exception using errcode = '23505', message = 'redirect conflict';
  end if;

  insert into public.dispositivos (
    id, versao_lei_id, lei_id, parent_id, tipo, block_id, numero, titulo, texto,
    conteudo_estruturado, ordem, device_status, nota_status,
    preservar_texto_revogado, redacao_atual_dada_por, redacoes_anteriores,
    renumerado_para_block_id, source_ref, supporting_source_refs, parse_evidence
  )
  select (device ->> 'id')::uuid, v_version_id, v_law_id,
    nullif(device ->> 'parentId', '')::uuid, device -> 'row' ->> 'tipo',
    device -> 'row' ->> 'block_id', device -> 'row' ->> 'numero',
    device -> 'row' ->> 'titulo', device -> 'row' ->> 'texto',
    device -> 'row' -> 'conteudo_estruturado',
    (device -> 'row' ->> 'ordem')::integer,
    device -> 'row' ->> 'device_status', device -> 'row' ->> 'nota_status',
    (device -> 'row' ->> 'preservar_texto_revogado')::boolean,
    device -> 'row' ->> 'redacao_atual_dada_por',
    device -> 'row' -> 'redacoes_anteriores',
    device -> 'row' ->> 'renumerado_para_block_id',
    device -> 'row' -> 'source_ref', device -> 'row' -> 'supporting_source_refs',
    device -> 'row' -> 'parse_evidence'
  from pg_catalog.jsonb_array_elements(p_payload -> 'devices') as device;

  update public.leis set
    sigla = v_projection -> 'lei' ->> 'sigla',
    titulo = v_projection -> 'lei' ->> 'titulo',
    tipo = v_projection -> 'lei' ->> 'tipo',
    numero = v_projection -> 'lei' ->> 'numero',
    ano = (v_projection -> 'lei' ->> 'ano')::integer,
    ramo = v_projection -> 'lei' ->> 'ramo',
    fonte_url = v_projection -> 'lei' ->> 'fonte_url',
    data_publicacao = (v_projection -> 'lei' ->> 'data_publicacao')::date,
    legal_status = v_projection -> 'lei' ->> 'legal_status',
    versao_publicada_id = v_version_id,
    publication_status = 'published',
    updated_at = pg_catalog.now()
  where id = v_law_id;

  update public.publicacoes set
    versao_lei_id = v_version_id, publication_attempt_status = 'published',
    resume_from_status = null, publicado_em = pg_catalog.now(),
    atualizado_em = pg_catalog.now(), ultimo_erro = null
  where id = v_publication_id returning * into v_attempt;
  insert into private.publication_events (
    publication_id, event_type, actor_user_id, manifest_digest, git_commit_sha
  ) values (
    v_publication_id, 'published', v_attempt.publicado_por,
    v_attempt.conteudo_sha256, v_attempt.git_commit_sha
  );
  return pg_catalog.jsonb_build_object(
    'publicationId', v_attempt.id, 'candidateSha', v_attempt.git_commit_sha,
    'manifestDigest', v_attempt.conteudo_sha256,
    'publicationAttemptStatus', 'published', 'resumeFromStatus', null,
    'publishedVersionId', v_version_id
  );
end
$function$;

alter function private.publish_validated_release(jsonb) owner to lex_publication_owner;
revoke all on function private.publish_validated_release(jsonb) from public, anon, authenticated;
grant execute on function private.publish_validated_release(jsonb) to lex_publisher;

revoke insert, update, delete, truncate on
  public.leis, public.versoes_lei, public.artefatos_fonte, public.dispositivos,
  public.block_ids, public.block_id_redirects, public.publicacoes
from anon, authenticated;
