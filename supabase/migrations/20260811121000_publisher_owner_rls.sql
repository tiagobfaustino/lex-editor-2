-- As funções security definer executam como um papel sem login. RLS continua
-- ativa para esse papel, portanto as operações fechadas recebem políticas
-- explícitas e continuam limitadas pelos GRANTs definidos na migration base.

create policy "publisher owner reads profiles"
  on public.usuarios_perfil for select to lex_publication_owner using (true);

create policy "publisher owner reads laws"
  on public.leis for select to lex_publication_owner using (true);
create policy "publisher owner updates laws"
  on public.leis for update to lex_publication_owner using (true) with check (true);

create policy "publisher owner reads versions"
  on public.versoes_lei for select to lex_publication_owner using (true);
create policy "publisher owner inserts versions"
  on public.versoes_lei for insert to lex_publication_owner with check (true);

create policy "publisher owner inserts source artifacts"
  on public.artefatos_fonte for insert to lex_publication_owner with check (true);

create policy "publisher owner reads block ids"
  on public.block_ids for select to lex_publication_owner using (true);
create policy "publisher owner inserts block ids"
  on public.block_ids for insert to lex_publication_owner with check (true);

create policy "publisher owner reads block redirects"
  on public.block_id_redirects for select to lex_publication_owner using (true);
create policy "publisher owner inserts block redirects"
  on public.block_id_redirects for insert to lex_publication_owner with check (true);
create policy "publisher owner updates block redirects"
  on public.block_id_redirects for update to lex_publication_owner
  using (true) with check (true);

create policy "publisher owner inserts devices"
  on public.dispositivos for insert to lex_publication_owner with check (true);

create policy "publisher owner reads publication attempts"
  on public.publicacoes for select to lex_publication_owner using (true);
create policy "publisher owner inserts publication attempts"
  on public.publicacoes for insert to lex_publication_owner with check (true);
create policy "publisher owner updates publication attempts"
  on public.publicacoes for update to lex_publication_owner using (true) with check (true);
