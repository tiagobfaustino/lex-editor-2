create role anon nologin;
create role authenticated nologin;
create schema auth;

create table auth.users (
  id uuid primary key
);

create table public.usuarios_perfil (
  user_id uuid primary key references auth.users(id),
  account_status text not null,
  papel text not null
);

create table public.leis (
  id uuid primary key,
  sigla text not null unique,
  titulo text not null,
  tipo text not null,
  numero text not null,
  ano integer not null,
  ramo text not null,
  fonte_url text not null,
  data_publicacao date not null,
  versao_publicada_id uuid,
  legal_status text not null default 'vigente',
  publication_status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.versoes_lei (
  id uuid primary key,
  lei_id uuid not null references public.leis(id) on delete cascade,
  numero_publicacao integer not null,
  versao_vinculex text not null,
  tipo_publicacao text not null,
  restaura_versao_id uuid,
  git_commit_sha text not null,
  conteudo_sha256 text not null,
  data_atualizacao_legal date not null,
  data_formatacao_vinculex date not null,
  total_artigos integer not null,
  tags text[] not null default '{}',
  revogada_por text,
  redacoes_dadas_por jsonb not null default '[]',
  ids_depreciados jsonb not null default '[]',
  fontes_secundarias text[] not null default '{}',
  data_verificacao_integridade date not null,
  avisos_atualizacao text[] not null default '{}',
  notas_editoriais text[] not null default '{}',
  changelog text not null,
  mudancas jsonb not null,
  aprovado_por uuid not null references auth.users(id),
  publicado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (lei_id, numero_publicacao),
  unique (lei_id, versao_vinculex),
  unique (lei_id, git_commit_sha),
  unique (id, lei_id)
);

alter table public.leis add constraint leis_versao_publicada_fk
  foreign key (versao_publicada_id, id) references public.versoes_lei(id, lei_id);

create table public.artefatos_fonte (
  id uuid primary key default gen_random_uuid(),
  versao_lei_id uuid not null references public.versoes_lei(id) on delete cascade,
  source_type text not null,
  source_role text not null,
  source_variant text not null,
  source_url text,
  final_url text,
  artifact_sha256 text not null,
  artifact_uri text not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (versao_lei_id, source_role, artifact_sha256)
);

create unique index artefatos_fonte_uma_primaria_por_versao
  on public.artefatos_fonte (versao_lei_id) where source_role = 'primary_current';

create table public.block_ids (
  id uuid primary key default gen_random_uuid(),
  lei_id uuid not null references public.leis(id) on delete cascade,
  block_id text not null,
  primeira_versao_id uuid not null,
  criado_em timestamptz not null default now(),
  unique (lei_id, block_id),
  foreign key (primeira_versao_id, lei_id) references public.versoes_lei(id, lei_id)
);

create table public.block_id_redirects (
  lei_id uuid not null references public.leis(id) on delete cascade,
  origem_block_id text not null,
  destino_block_id text not null,
  criado_em_versao_id uuid not null,
  motivo text not null,
  criado_em timestamptz not null default now(),
  primary key (lei_id, origem_block_id),
  foreign key (lei_id, origem_block_id) references public.block_ids(lei_id, block_id),
  foreign key (lei_id, destino_block_id) references public.block_ids(lei_id, block_id),
  foreign key (criado_em_versao_id, lei_id) references public.versoes_lei(id, lei_id)
);

create table public.dispositivos (
  id uuid not null,
  versao_lei_id uuid not null,
  lei_id uuid not null,
  parent_id uuid,
  tipo text not null,
  block_id text,
  numero text,
  titulo text,
  texto text,
  conteudo_estruturado jsonb,
  ordem integer not null,
  device_status text not null default 'active',
  nota_status text,
  preservar_texto_revogado boolean,
  redacao_atual_dada_por text,
  redacoes_anteriores jsonb not null default '[]',
  renumerado_para_block_id text,
  source_ref jsonb not null,
  supporting_source_refs jsonb not null default '[]',
  parse_evidence jsonb not null,
  created_at timestamptz not null default now(),
  primary key (id),
  unique (id, versao_lei_id),
  unique (versao_lei_id, block_id),
  foreign key (versao_lei_id, lei_id) references public.versoes_lei(id, lei_id),
  foreign key (parent_id, versao_lei_id) references public.dispositivos(id, versao_lei_id),
  foreign key (lei_id, block_id) references public.block_ids(lei_id, block_id),
  foreign key (lei_id, renumerado_para_block_id) references public.block_ids(lei_id, block_id)
);

create table public.publicacoes (
  id uuid primary key,
  lei_id uuid not null references public.leis(id) on delete cascade,
  versao_lei_id uuid,
  idempotency_key uuid not null,
  versao_vinculex text not null,
  publication_attempt_status text not null,
  git_commit_sha text,
  conteudo_sha256 text not null,
  publicado_por uuid references auth.users(id),
  canal text not null default 'supabase',
  tentativas_sync integer not null default 0,
  ultimo_erro text,
  preparado_em timestamptz not null default now(),
  publicado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  unique (lei_id, idempotency_key),
  unique (lei_id, versao_vinculex),
  unique (lei_id, git_commit_sha),
  foreign key (versao_lei_id, lei_id) references public.versoes_lei(id, lei_id)
);
