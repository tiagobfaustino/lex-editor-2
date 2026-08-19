import type { MetadataStateDto, UpdateMetadataCommand } from '../../../../shared/ipc/metadata.js';

export type MetadataDraft = Readonly<{
  titulo: string;
  sigla: string;
  tipoNorma: MetadataStateDto['fields']['tipoNorma']['value'];
  numero: string;
  ano: string;
  ramo: string;
  dataPublicacao: string;
  dataAtualizacaoLegal: string;
  legalStatus: MetadataStateDto['fields']['legalStatus']['value'];
  tags: string;
  revogadaPor: string;
  reason: string;
}>;

export type MetadataDraftField = keyof MetadataDraft;
export type MetadataDraftErrors = Readonly<Partial<Record<MetadataDraftField, string>>>;
export type MetadataChanges = UpdateMetadataCommand['changes'];

export type MetadataChangeSummary = Readonly<{
  field: keyof MetadataChanges;
  label: string;
  previous: string;
  next: string;
}>;

const FIELD_LABELS: Readonly<Record<keyof MetadataChanges, string>> = Object.freeze({
  titulo: 'Título',
  sigla: 'Sigla',
  tipoNorma: 'Tipo da norma',
  numero: 'Número',
  ano: 'Ano',
  ramo: 'Ramo',
  dataPublicacao: 'Data de publicação',
  dataAtualizacaoLegal: 'Data de atualização legal',
  legalStatus: 'Vigência',
  tags: 'Tags',
  revogadaPor: 'Norma revogadora',
});

const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
};

export const parseMetadataTags = (value: string): readonly string[] =>
  value
    .split(/[\n,]/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

export const createMetadataDraft = (state: MetadataStateDto): MetadataDraft => ({
  titulo: state.fields.titulo.value,
  sigla: state.fields.sigla.value,
  tipoNorma: state.fields.tipoNorma.value,
  numero: state.fields.numero.value,
  ano: String(state.fields.ano.value),
  ramo: state.fields.ramo.value,
  dataPublicacao: state.fields.dataPublicacao.value,
  dataAtualizacaoLegal: state.fields.dataAtualizacaoLegal.value,
  legalStatus: state.fields.legalStatus.value,
  tags: (state.fields.tags.value ?? []).join(', '),
  revogadaPor: state.fields.revogadaPor.value ?? '',
  reason: '',
});

const validateRequiredText = (
  errors: Partial<Record<MetadataDraftField, string>>,
  field: MetadataDraftField,
  value: string,
  maximum: number,
  label: string,
): void => {
  const length = value.trim().length;
  if (length === 0) errors[field] = `${label} é obrigatório.`;
  else if (value.length > maximum)
    errors[field] = `${label} deve ter no máximo ${String(maximum)} caracteres.`;
};

export const validateMetadataDraft = (
  draft: MetadataDraft,
  state: MetadataStateDto,
): MetadataDraftErrors => {
  const errors: Partial<Record<MetadataDraftField, string>> = {};
  validateRequiredText(errors, 'titulo', draft.titulo, 500, 'Título');
  validateRequiredText(errors, 'sigla', draft.sigla, 80, 'Sigla');
  if (
    draft.sigla.trim().length > 0 &&
    !/^[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*$/u.test(draft.sigla.trim())
  ) {
    errors.sigla = 'Use letras e números, começando por uma letra; hífens separam segmentos.';
  }
  validateRequiredText(errors, 'numero', draft.numero, 80, 'Número');
  validateRequiredText(errors, 'ramo', draft.ramo, 160, 'Ramo');

  const year = Number(draft.ano);
  if (!/^\d{4}$/u.test(draft.ano) || year < 1000 || year > 9999)
    errors.ano = 'Informe um ano entre 1000 e 9999.';
  if (!validDate(draft.dataPublicacao))
    errors.dataPublicacao = 'Informe uma data de publicação real.';
  if (!validDate(draft.dataAtualizacaoLegal))
    errors.dataAtualizacaoLegal = 'Informe uma data de atualização legal real.';
  if (
    errors.dataPublicacao === undefined &&
    errors.dataAtualizacaoLegal === undefined &&
    draft.dataAtualizacaoLegal < draft.dataPublicacao
  ) {
    errors.dataAtualizacaoLegal = 'A atualização legal não pode anteceder a publicação.';
  }

  const tags = parseMetadataTags(draft.tags);
  if (tags.length > 100) errors.tags = 'Informe no máximo 100 tags.';
  else if (tags.some((tag) => tag.length > 120))
    errors.tags = 'Cada tag deve ter no máximo 120 caracteres.';
  else if (new Set(tags).size !== tags.length) errors.tags = 'Remova as tags duplicadas.';

  if (draft.legalStatus === 'revogada') {
    validateRequiredText(errors, 'revogadaPor', draft.revogadaPor, 500, 'Norma revogadora');
  } else if (draft.revogadaPor.trim().length > 0) {
    errors.revogadaPor = 'A norma revogadora só se aplica quando a vigência é “Revogada”.';
  }

  const changes = buildMetadataChanges(draft, state);
  if (Object.keys(changes).length > 0) {
    const reasonLength = draft.reason.trim().length;
    if (reasonLength < 2) errors.reason = 'Registre um motivo com pelo menos 2 caracteres.';
    else if (draft.reason.length > 2_000)
      errors.reason = 'O motivo deve ter no máximo 2.000 caracteres.';
  }
  return errors;
};

export const buildMetadataChanges = (
  draft: MetadataDraft,
  state: MetadataStateDto,
): MetadataChanges => {
  const changes: Partial<MetadataChanges> = {};
  const assignText = (
    field: 'titulo' | 'sigla' | 'numero' | 'ramo' | 'dataPublicacao' | 'dataAtualizacaoLegal',
    value: string,
  ): void => {
    const normalized = value.trim();
    if (state.fields[field].editable && normalized !== state.fields[field].value)
      changes[field] = normalized;
  };
  assignText('titulo', draft.titulo);
  assignText('sigla', draft.sigla);
  assignText('numero', draft.numero);
  assignText('ramo', draft.ramo);
  assignText('dataPublicacao', draft.dataPublicacao);
  assignText('dataAtualizacaoLegal', draft.dataAtualizacaoLegal);

  if (state.fields.tipoNorma.editable && draft.tipoNorma !== state.fields.tipoNorma.value)
    changes.tipoNorma = draft.tipoNorma;
  const year = Number(draft.ano);
  if (state.fields.ano.editable && year !== state.fields.ano.value) changes.ano = year;
  if (state.fields.legalStatus.editable && draft.legalStatus !== state.fields.legalStatus.value)
    changes.legalStatus = draft.legalStatus;

  const tags = [...parseMetadataTags(draft.tags)];
  const currentTags = state.fields.tags.value ?? [];
  if (
    state.fields.tags.editable &&
    (tags.length !== currentTags.length || tags.some((tag, index) => tag !== currentTags[index]))
  ) {
    changes.tags = tags;
  }

  const revogadaPor = draft.revogadaPor.trim() || null;
  if (state.fields.revogadaPor.editable && revogadaPor !== state.fields.revogadaPor.value) {
    changes.revogadaPor = revogadaPor;
  }
  return changes;
};

const formatSummaryValue = (value: unknown): string => {
  if (value === null) return 'Não informado';
  if (Array.isArray(value)) return value.length === 0 ? 'Nenhuma' : value.join(', ');
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return 'Valor indisponível';
};

export const summarizeMetadataChanges = (
  changes: MetadataChanges,
  state: MetadataStateDto,
): readonly MetadataChangeSummary[] =>
  (Object.keys(changes) as (keyof MetadataChanges)[]).map((field) => ({
    field,
    label: FIELD_LABELS[field],
    previous: formatSummaryValue(state.fields[field].value),
    next: formatSummaryValue(changes[field]),
  }));
