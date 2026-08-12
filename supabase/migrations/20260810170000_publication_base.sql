-- Subconjunto normativo de DATA_MODEL.md necessário à publicação segura.
-- auth.users, anon e authenticated são gerenciados pela plataforma Supabase.

create table public.usuarios_perfil (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome_exibicao text,
  foco_concurso text,
  papel text not null default 'usuario'
    check (papel in ('usuario', 'curador', 'administrador')),
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended')),
  preferencias jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default pg_catalog.now(),
  atualizado_em timestamptz not null default pg_catalog.now()
);

create table public.leis (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  sigla text not null unique,
  titulo text not null,
  tipo text not null,
  numero text not null,
  ano integer not null,
  ramo text not null,
  fonte_url text not null,
  data_publicacao date not null,
  versao_publicada_id uuid,
  legal_status text not null default 'vigente'
    check (legal_status in (
      'vigente', 'revogada', 'alterada', 'suspensa', 'sem_eficacia', 'desconhecida'
    )),
  publication_status text not null default 'draft'
    check (publication_status in (
      'draft', 'review', 'approved', 'published', 'archived', 'outdated'
    )),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

create table public.versoes_lei (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  lei_id uuid not null references public.leis(id) on delete cascade,
  numero_publicacao integer not null check (numero_publicacao > 0),
  versao_vinculex text not null
    check (versao_vinculex ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  tipo_publicacao text not null check (tipo_publicacao in (
    'initial', 'legislative_update', 'editorial_correction', 'rollback'
  )),
  restaura_versao_id uuid,
  git_commit_sha text not null
    check (git_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  conteudo_sha256 text not null check (conteudo_sha256 ~ '^[0-9a-f]{64}$'),
  data_atualizacao_legal date not null,
  data_formatacao_vinculex date not null,
  total_artigos integer not null check (total_artigos >= 0),
  tags text[] not null default '{}',
  revogada_por text,
  redacoes_dadas_por jsonb not null default '[]'::jsonb
    check (jsonb_typeof(redacoes_dadas_por) = 'array'),
  ids_depreciados jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ids_depreciados) = 'array'),
  fontes_secundarias text[] not null default '{}',
  data_verificacao_integridade date not null,
  avisos_atualizacao text[] not null default '{}',
  notas_editoriais text[] not null default '{}',
  changelog text not null,
  mudancas jsonb not null check (jsonb_typeof(mudancas) = 'object'),
  aprovado_por uuid not null references auth.users(id),
  publicado_em timestamptz not null default pg_catalog.now(),
  created_at timestamptz not null default pg_catalog.now(),
  check (
    (tipo_publicacao = 'rollback' and restaura_versao_id is not null)
    or (tipo_publicacao <> 'rollback' and restaura_versao_id is null)
  ),
  unique (lei_id, numero_publicacao),
  unique (lei_id, versao_vinculex),
  unique (lei_id, git_commit_sha),
  unique (id, lei_id),
  foreign key (restaura_versao_id, lei_id)
    references public.versoes_lei(id, lei_id)
);

alter table public.leis
  add constraint leis_versao_publicada_fk
  foreign key (versao_publicada_id, id)
  references public.versoes_lei(id, lei_id);

alter table public.leis
  add constraint leis_publicacao_coerente
  check (publication_status <> 'published' or versao_publicada_id is not null);

create table public.artefatos_fonte (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  versao_lei_id uuid not null references public.versoes_lei(id) on delete cascade,
  source_type text not null check (source_type in (
    'planalto_html', 'lexml_xml', 'markdown', 'local_file'
  )),
  source_role text not null check (source_role in (
    'primary_current', 'historical_auxiliary', 'cross_check'
  )),
  source_variant text not null check (source_variant in ('compiled', 'annotated', 'other')),
  source_url text,
  final_url text,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_uri text not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (versao_lei_id, source_role, artifact_sha256)
);

create unique index artefatos_fonte_uma_primaria_por_versao
  on public.artefatos_fonte (versao_lei_id)
  where source_role = 'primary_current';

create table public.block_ids (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  lei_id uuid not null references public.leis(id) on delete cascade,
  block_id text not null,
  primeira_versao_id uuid not null,
  criado_em timestamptz not null default pg_catalog.now(),
  unique (lei_id, block_id),
  foreign key (primeira_versao_id, lei_id)
    references public.versoes_lei(id, lei_id)
);

create table public.block_id_redirects (
  lei_id uuid not null references public.leis(id) on delete cascade,
  origem_block_id text not null,
  destino_block_id text not null,
  criado_em_versao_id uuid not null,
  motivo text not null,
  criado_em timestamptz not null default pg_catalog.now(),
  primary key (lei_id, origem_block_id),
  check (origem_block_id <> destino_block_id),
  foreign key (lei_id, origem_block_id)
    references public.block_ids(lei_id, block_id),
  foreign key (lei_id, destino_block_id)
    references public.block_ids(lei_id, block_id),
  foreign key (criado_em_versao_id, lei_id)
    references public.versoes_lei(id, lei_id)
);

create table public.dispositivos (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  versao_lei_id uuid not null,
  lei_id uuid not null,
  parent_id uuid,
  tipo text not null check (tipo in (
    'ato_transitorio', 'livro', 'titulo', 'capitulo', 'secao', 'subsecao',
    'artigo', 'paragrafo', 'inciso', 'alinea', 'item', 'pena', 'anexo', 'tabela'
  )),
  block_id text,
  numero text,
  titulo text,
  texto text,
  conteudo_estruturado jsonb,
  ordem integer not null,
  device_status text not null default 'active' check (device_status in (
    'active', 'revoked', 'vetoed', 'included', 'amended', 'renumbered',
    'suspended', 'unknown'
  )),
  nota_status text,
  preservar_texto_revogado boolean,
  redacao_atual_dada_por text,
  redacoes_anteriores jsonb not null default '[]'::jsonb,
  renumerado_para_block_id text,
  source_ref jsonb not null,
  supporting_source_refs jsonb not null default '[]'::jsonb,
  parse_evidence jsonb not null,
  created_at timestamptz not null default pg_catalog.now(),
  unique (id, versao_lei_id),
  unique (versao_lei_id, block_id),
  foreign key (versao_lei_id, lei_id)
    references public.versoes_lei(id, lei_id) on delete cascade,
  foreign key (parent_id, versao_lei_id)
    references public.dispositivos(id, versao_lei_id) on delete cascade,
  foreign key (lei_id, block_id)
    references public.block_ids(lei_id, block_id),
  foreign key (lei_id, renumerado_para_block_id)
    references public.block_ids(lei_id, block_id),
  check (
    tipo in ('ato_transitorio', 'livro', 'titulo', 'capitulo', 'secao', 'subsecao')
    or block_id is not null
  ),
  check (device_status <> 'revoked' or preservar_texto_revogado is not null),
  check (jsonb_typeof(redacoes_anteriores) = 'array'),
  check (jsonb_typeof(source_ref) = 'object'),
  check (jsonb_typeof(supporting_source_refs) = 'array'),
  check (jsonb_typeof(parse_evidence) = 'object'),
  check (
    tipo <> 'tabela'
    or (conteudo_estruturado is not null and jsonb_typeof(conteudo_estruturado) = 'object')
  )
);

create unique index dispositivos_ordem_irmaos_unique
  on public.dispositivos (versao_lei_id, parent_id, ordem)
  where parent_id is not null;

create unique index dispositivos_ordem_raiz_unique
  on public.dispositivos (versao_lei_id, ordem)
  where parent_id is null;

create table public.publicacoes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  lei_id uuid not null references public.leis(id) on delete cascade,
  versao_lei_id uuid,
  idempotency_key uuid not null,
  versao_vinculex text not null
    check (versao_vinculex ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  publication_attempt_status text not null check (publication_attempt_status in (
    'prepared', 'committed_local', 'pushed', 'syncing', 'published', 'failed'
  )),
  git_commit_sha text check (
    git_commit_sha is null or git_commit_sha ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'
  ),
  conteudo_sha256 text not null check (conteudo_sha256 ~ '^[0-9a-f]{64}$'),
  publicado_por uuid references auth.users(id),
  canal text not null default 'supabase'
    check (canal in ('supabase', 'github-publico', 'obsidian-publish')),
  tentativas_sync integer not null default 0,
  ultimo_erro text,
  preparado_em timestamptz not null default pg_catalog.now(),
  publicado_em timestamptz,
  atualizado_em timestamptz not null default pg_catalog.now(),
  check (
    publication_attempt_status <> 'published'
    or (
      versao_lei_id is not null and git_commit_sha is not null
      and publicado_por is not null and publicado_em is not null
    )
  ),
  unique (lei_id, idempotency_key),
  unique (lei_id, versao_vinculex),
  unique (lei_id, git_commit_sha),
  foreign key (versao_lei_id, lei_id)
    references public.versoes_lei(id, lei_id)
);

alter table public.leis enable row level security;
alter table public.versoes_lei enable row level security;
alter table public.artefatos_fonte enable row level security;
alter table public.block_ids enable row level security;
alter table public.block_id_redirects enable row level security;
alter table public.dispositivos enable row level security;
alter table public.publicacoes enable row level security;
alter table public.usuarios_perfil enable row level security;

create policy "leis publicadas" on public.leis for select
  using (publication_status = 'published');
create policy "versoes de leis publicadas" on public.versoes_lei for select
  using (exists (
    select 1 from public.leis
    where leis.id = versoes_lei.lei_id and leis.publication_status = 'published'
  ));
create policy "dispositivos da versao publica" on public.dispositivos for select
  using (exists (
    select 1 from public.leis
    where leis.id = dispositivos.lei_id
      and leis.publication_status = 'published'
      and leis.versao_publicada_id = dispositivos.versao_lei_id
  ));

revoke all on public.usuarios_perfil, public.artefatos_fonte,
  public.block_ids, public.block_id_redirects, public.publicacoes
from anon, authenticated;
revoke all on public.versoes_lei, public.dispositivos from anon, authenticated;
revoke insert, update, delete, truncate on public.leis from anon, authenticated;

grant select (
  id, sigla, titulo, tipo, numero, ano, ramo, data_publicacao,
  versao_publicada_id, legal_status, publication_status
) on public.leis to anon, authenticated;
grant select (
  id, lei_id, numero_publicacao, versao_vinculex, tipo_publicacao,
  restaura_versao_id, data_atualizacao_legal, data_formatacao_vinculex,
  changelog, mudancas, publicado_em
) on public.versoes_lei to anon, authenticated;
grant select (
  id, versao_lei_id, lei_id, parent_id, tipo, block_id, numero, titulo,
  texto, conteudo_estruturado, ordem, device_status, nota_status,
  preservar_texto_revogado, redacao_atual_dada_por, redacoes_anteriores,
  renumerado_para_block_id
) on public.dispositivos to anon, authenticated;
