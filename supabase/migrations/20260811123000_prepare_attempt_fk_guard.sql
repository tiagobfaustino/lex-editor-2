-- A existência da lei é garantida pela FK de publicacoes e revalidada sob lock
-- na transação final. Evita uma leitura preliminar sujeita ao contexto RLS do
-- security definer sem reduzir a proteção contra remoção ou troca concorrente.

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
