-- Contrato relacional da Feature 010: identidades/Block IDs, nunca paths.

insert into public.referencias_juridicas (
  source_versao_lei_id,
  reference_id,
  source_law_key,
  source_revision_sha256,
  source_block_id,
  source_field,
  span_encoding,
  span_start,
  span_end,
  span_text,
  state,
  severity,
  locator,
  evidence,
  target_law_key,
  target_revision_sha256,
  target_block_id
)
select
  id,
  repeat('a', 64),
  'lei ordinária:14133:2021',
  repeat('b', 64),
  'nllc-art-1-par-5',
  'texto',
  'utf16',
  0,
  16,
  'caput do art. 37',
  'resolved',
  'info',
  '{"scope":"external_law"}'::jsonb,
  '[{"kind":"canonical_identity"}]'::jsonb,
  'constituição:1988:1988',
  repeat('c', 64),
  'cf1988-art-37'
from public.versoes_lei
order by created_at
limit 1;

do $assertions$
begin
  if not exists (
    select 1 from public.referencias_juridicas
    where source_law_key = 'lei ordinária:14133:2021'
      and target_law_key = 'constituição:1988:1988'
      and target_block_id = 'cf1988-art-37'
  ) then
    raise exception 'canonical legal edge was not persisted';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'referencias_juridicas'
      and column_name ~ '(path|wiki|arquivo)'
  ) then
    raise exception 'legal edge table leaked a path-oriented identity';
  end if;

  begin
    insert into public.referencias_juridicas (
      source_versao_lei_id, reference_id, source_law_key, source_revision_sha256,
      source_block_id, source_field, span_encoding, span_start, span_end, span_text,
      state, severity, locator, evidence
    )
    select id, repeat('d', 64), 'lei ordinária:14133:2021', repeat('e', 64),
      'nllc-art-1-par-5', 'texto', 'utf16', 0, 1, 'x', 'resolved', 'info',
      '{}'::jsonb, '[]'::jsonb
    from public.versoes_lei order by created_at limit 1;
    raise exception 'resolved edge without target was accepted';
  exception
    when check_violation then null;
  end;
end
$assertions$;
