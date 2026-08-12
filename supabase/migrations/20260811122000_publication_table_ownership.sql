-- O papel sem login que possui as funções fechadas também possui as tabelas
-- do agregado de publicação. Assim, security definer enxerga o estado
-- autoritativo sem abrir políticas para anon/authenticated; clientes públicos
-- continuam sujeitos à RLS e aos grants colunares da migration base.

grant create on schema public to lex_publication_owner;

alter table public.usuarios_perfil owner to lex_publication_owner;
alter table public.leis owner to lex_publication_owner;
alter table public.versoes_lei owner to lex_publication_owner;
alter table public.artefatos_fonte owner to lex_publication_owner;
alter table public.block_ids owner to lex_publication_owner;
alter table public.block_id_redirects owner to lex_publication_owner;
alter table public.dispositivos owner to lex_publication_owner;
alter table public.publicacoes owner to lex_publication_owner;

revoke create on schema public from lex_publication_owner;
