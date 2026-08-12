-- Feature 010: arestas jurídicas derivadas por identidades canônicas.
-- Paths de vault/filesystem não pertencem ao contrato persistido.

create table public.referencias_juridicas (
  source_versao_lei_id uuid not null references public.versoes_lei(id) on delete cascade,
  reference_id text not null check (reference_id ~ '^[0-9a-f]{64}$'),
  source_law_key text not null,
  source_revision_sha256 text not null check (source_revision_sha256 ~ '^[0-9a-f]{64}$'),
  source_block_id text not null,
  source_field text not null check (source_field in ('caput', 'texto')),
  span_encoding text not null check (span_encoding = 'utf16'),
  span_start integer not null check (span_start >= 0),
  span_end integer not null check (span_end > span_start),
  span_text text not null check (pg_catalog.length(span_text) > 0),
  state text not null check (state in ('detected', 'resolved', 'unresolved', 'ambiguous')),
  severity text not null check (severity in ('error', 'warning', 'info')),
  locator jsonb not null check (pg_catalog.jsonb_typeof(locator) = 'object'),
  evidence jsonb not null check (pg_catalog.jsonb_typeof(evidence) = 'array'),
  target_law_key text,
  target_revision_sha256 text check (
    target_revision_sha256 is null or target_revision_sha256 ~ '^[0-9a-f]{64}$'
  ),
  target_block_id text,
  candidate_targets jsonb not null default '[]'::jsonb
    check (pg_catalog.jsonb_typeof(candidate_targets) = 'array'),
  reason text,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (source_versao_lei_id, reference_id),
  check (
    (state = 'resolved'
      and target_law_key is not null
      and target_revision_sha256 is not null
      and target_block_id is not null)
    or (state <> 'resolved'
      and target_law_key is null
      and target_revision_sha256 is null
      and target_block_id is null)
  )
);

create index referencias_juridicas_target_idx
  on public.referencias_juridicas (target_law_key, target_revision_sha256, target_block_id)
  where state = 'resolved';

alter table public.referencias_juridicas enable row level security;

create policy "referencias de leis publicadas"
  on public.referencias_juridicas for select
  using (exists (
    select 1
    from public.versoes_lei
    join public.leis on leis.id = versoes_lei.lei_id
    where versoes_lei.id = referencias_juridicas.source_versao_lei_id
      and leis.publication_status = 'published'
      and leis.versao_publicada_id = versoes_lei.id
  ));

revoke insert, update, delete on public.referencias_juridicas from anon, authenticated;
