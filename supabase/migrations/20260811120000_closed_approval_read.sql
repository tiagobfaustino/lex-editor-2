-- A leitura da aprovação permanece fechada no schema private. O workload não
-- recebe SELECT direto na tabela e só observa o registro da tentativa pedida.

create or replace function private.get_publication_approval(p_publication_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_approval private.publication_approvals%rowtype;
begin
  perform private.assert_publisher_identity();
  select * into v_approval
  from private.publication_approvals
  where publication_id = p_publication_id;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'approvalId', v_approval.approval_id,
    'publicationId', v_approval.publication_id,
    'userId', v_approval.user_id,
    'role', v_approval.approval_role,
    'manifestDigest', v_approval.manifest_digest,
    'approvedAt', v_approval.approved_at
  );
end
$function$;

alter function private.get_publication_approval(uuid) owner to lex_publication_owner;
revoke all on function private.get_publication_approval(uuid) from public, anon, authenticated;
grant execute on function private.get_publication_approval(uuid) to lex_publisher;
