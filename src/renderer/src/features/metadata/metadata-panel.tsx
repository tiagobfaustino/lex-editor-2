import { useEffect, useId, useRef, useState } from 'react';

import type {
  MetadataStateDto,
  UpdateMetadataCommand,
  UpdateMetadataResult,
} from '../../../../shared/ipc/metadata.js';
import {
  buildMetadataChanges,
  createMetadataDraft,
  summarizeMetadataChanges,
  validateMetadataDraft,
  type MetadataChangeSummary,
  type MetadataDraft,
  type MetadataDraftErrors,
  type MetadataDraftField,
} from './metadata-form-validation.js';

type MetadataPanelMode = 'closed' | 'editing' | 'confirming' | 'saving' | 'error' | 'conflict';

type MetadataFieldInfo = Readonly<{
  origin: MetadataStateDto['fields']['titulo']['origin'];
  mutability: MetadataStateDto['fields']['titulo']['mutability'];
  editable: boolean;
  blockedReason: MetadataStateDto['fields']['titulo']['blockedReason'];
}>;

const ORIGIN_LABELS: Readonly<Record<MetadataFieldInfo['origin'], string>> = Object.freeze({
  import: 'Importação',
  official_source: 'Fonte oficial',
  editorial: 'Edição editorial',
  source_catalog: 'Catálogo de fontes',
  formatter: 'Formatador',
  ast_structure: 'Estrutura da lei',
  publication: 'Publicação',
  projection: 'Projeção',
  reference_catalog: 'Catálogo de referências',
  reconciliation: 'Reconciliação',
});

const BLOCKED_REASON_LABELS: Readonly<
  Record<NonNullable<MetadataFieldInfo['blockedReason']>, string>
> = Object.freeze({
  published_identity: 'Identidade bloqueada porque a lei já foi publicada.',
  publication_history_unknown:
    'Identidade bloqueada porque o histórico de publicação não pôde ser comprovado.',
  source_managed: 'Valor administrado pelo catálogo de fontes.',
  system_managed: 'Valor administrado pelo sistema.',
  derived_value: 'Valor calculado a partir da revisão atual.',
});

const LAW_TYPE_OPTIONS: readonly MetadataDraft['tipoNorma'][] = Object.freeze([
  'lei ordinária',
  'lei complementar',
  'decreto-lei',
  'decreto',
  'medida provisória',
  'emenda constitucional',
  'código',
  'constituição',
]);

const LEGAL_STATUS_OPTIONS: Readonly<Record<MetadataDraft['legalStatus'], string>> = Object.freeze({
  vigente: 'Vigente',
  revogada: 'Revogada',
  alterada: 'Alterada',
  suspensa: 'Suspensa',
  sem_eficacia: 'Sem eficácia',
  desconhecida: 'Desconhecida',
});

const displayValue = (value: unknown): string => {
  if (value === null) return 'Não informado';
  if (Array.isArray(value)) return value.length === 0 ? 'Nenhum' : value.join(', ');
  if (typeof value === 'string') return value.replaceAll('_', ' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'Valor indisponível';
};

const MetadataFieldNote = ({
  field,
}: Readonly<{ field: MetadataFieldInfo }>): React.JSX.Element => {
  const mutability =
    field.mutability === 'editable'
      ? 'Editável'
      : field.mutability === 'prepublication_only'
        ? 'Editável antes da primeira publicação'
        : 'Somente leitura';
  return (
    <small className="metadata-field-note">
      Origem: {ORIGIN_LABELS[field.origin]} · {mutability}
      {field.blockedReason === null ? '' : ` · ${BLOCKED_REASON_LABELS[field.blockedReason]}`}
    </small>
  );
};

const ReadOnlyMetadata = ({
  label,
  field,
}: Readonly<{
  label: string;
  field: MetadataFieldInfo & Readonly<{ value: unknown }>;
}>): React.JSX.Element => (
  <div className="metadata-readonly-field">
    <span className="metadata-readonly-label">{label}</span>
    <span className="metadata-readonly-value">{displayValue(field.value)}</span>
    <MetadataFieldNote field={field} />
  </div>
);

const MetadataOverview = ({ state }: Readonly<{ state: MetadataStateDto }>): React.JSX.Element => (
  <div className="metadata-overview">
    <section aria-labelledby="metadata-editorial-overview">
      <h3 id="metadata-editorial-overview">Editorial</h3>
      <div className="metadata-value-grid">
        <ReadOnlyMetadata label="Título" field={state.fields.titulo} />
        <ReadOnlyMetadata label="Ramo" field={state.fields.ramo} />
        <ReadOnlyMetadata label="Vigência" field={state.fields.legalStatus} />
        <ReadOnlyMetadata label="Tags" field={state.fields.tags} />
        <ReadOnlyMetadata label="Norma revogadora" field={state.fields.revogadaPor} />
      </div>
    </section>
    <section aria-labelledby="metadata-identity-overview">
      <h3 id="metadata-identity-overview">Identidade pré-publicação</h3>
      <div className="metadata-value-grid">
        <ReadOnlyMetadata label="Sigla" field={state.fields.sigla} />
        <ReadOnlyMetadata label="Tipo da norma" field={state.fields.tipoNorma} />
        <ReadOnlyMetadata label="Número" field={state.fields.numero} />
        <ReadOnlyMetadata label="Ano" field={state.fields.ano} />
      </div>
    </section>
    <section aria-labelledby="metadata-provenance-overview">
      <h3 id="metadata-provenance-overview">Proveniência</h3>
      <div className="metadata-value-grid">
        <ReadOnlyMetadata label="Fonte oficial" field={state.fields.fonte} />
        <ReadOnlyMetadata label="Data de publicação" field={state.fields.dataPublicacao} />
        <ReadOnlyMetadata
          label="Data de atualização legal"
          field={state.fields.dataAtualizacaoLegal}
        />
        <ReadOnlyMetadata label="Fontes secundárias" field={state.fields.fontesSecundarias} />
      </div>
    </section>
    <section aria-labelledby="metadata-system-overview">
      <h3 id="metadata-system-overview">Sistema</h3>
      <div className="metadata-value-grid">
        <ReadOnlyMetadata
          label="Data de formatação Vinculex"
          field={state.fields.dataFormatacaoVinculex}
        />
        <ReadOnlyMetadata label="Versão Vinculex" field={state.fields.versaoVinculex} />
        <ReadOnlyMetadata label="Estado de publicação" field={state.fields.publicationStatus} />
      </div>
    </section>
    <section aria-labelledby="metadata-derived-overview">
      <h3 id="metadata-derived-overview">Derivados</h3>
      <div className="metadata-value-grid">
        <ReadOnlyMetadata label="Total de artigos" field={state.fields.totalArtigos} />
        <ReadOnlyMetadata label="Redações dadas por" field={state.fields.redacoesDadasPor} />
        <ReadOnlyMetadata label="IDs depreciados" field={state.fields.idsDepreciados} />
        <ReadOnlyMetadata label="Perfil de projeção" field={state.fields.projectionProfile} />
        <ReadOnlyMetadata label="Aliases" field={state.fields.aliases} />
      </div>
    </section>
  </div>
);

const MetadataConfirmationDialog = ({
  summary,
  reason,
  busy,
  onCancel,
  onConfirm,
}: Readonly<{
  summary: readonly MetadataChangeSummary[];
  reason: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}>): React.JSX.Element => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="metadata-confirmation-dialog"
      aria-labelledby="metadata-confirmation-title"
      aria-describedby="metadata-confirmation-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id="metadata-confirmation-title">Confirmar alterações de metadados?</h3>
      <p id="metadata-confirmation-description">
        Confira o diff antes de gravar esta revisão no diário editorial.
      </p>
      <dl className="metadata-change-summary">
        {summary.map((change) => (
          <div key={change.field}>
            <dt>{change.label}</dt>
            <dd>
              <span>{change.previous}</span>
              <span aria-hidden="true">→</span>
              <strong>{change.next}</strong>
            </dd>
          </div>
        ))}
      </dl>
      <p>
        <strong>Motivo:</strong> {reason.trim()}
      </p>
      <div className="metadata-dialog-actions">
        <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>
          Voltar à edição
        </button>
        <button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Salvando…' : 'Confirmar e salvar'}
        </button>
      </div>
    </dialog>
  );
};

export type MetadataPanelProps = Readonly<{
  state: MetadataStateDto | null;
  onSave(command: UpdateMetadataCommand): Promise<UpdateMetadataResult>;
  onReload(): Promise<MetadataStateDto | null>;
}>;

export const MetadataPanel = ({
  state,
  onSave,
  onReload,
}: MetadataPanelProps): React.JSX.Element => {
  const [mode, setMode] = useState<MetadataPanelMode>('closed');
  const [baseline, setBaseline] = useState<MetadataStateDto | null>(null);
  const [draft, setDraft] = useState<MetadataDraft | null>(null);
  const [errors, setErrors] = useState<MetadataDraftErrors>({});
  const [statusMessage, setStatusMessage] = useState('Nenhuma edição de metadados em andamento.');
  const [operationError, setOperationError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const errorPrefix = useId();
  const projectChanged = baseline !== null && state?.projectId !== baseline.projectId;
  const activeMode: MetadataPanelMode = projectChanged ? 'closed' : mode;
  const busy = activeMode === 'saving';
  const changes = draft === null || baseline === null ? {} : buildMetadataChanges(draft, baseline);
  const summary = baseline === null ? [] : summarizeMetadataChanges(changes, baseline);

  const focusEditButton = (): void => {
    requestAnimationFrame(() => {
      editButtonRef.current?.focus();
    });
  };
  const openEditor = (): void => {
    if (state === null) return;
    setBaseline(state);
    setDraft(createMetadataDraft(state));
    setErrors({});
    setOperationError(null);
    setStatusMessage('Edição aberta. Revise os campos e registre o motivo da alteração.');
    setMode('editing');
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>('[data-metadata-control]:not(:disabled)')
        ?.focus();
    });
  };
  const closeEditor = (): void => {
    setMode('closed');
    setBaseline(null);
    setDraft(null);
    setErrors({});
    setOperationError(null);
    setStatusMessage('Edição cancelada. Os valores confirmados foram restaurados.');
    focusEditButton();
  };
  const update = <Field extends MetadataDraftField>(
    field: Field,
    value: MetadataDraft[Field],
  ): void => {
    setDraft((current) => (current === null ? current : { ...current, [field]: value }));
    setErrors((current) => {
      if (current[field] === undefined) return current;
      return Object.fromEntries(Object.entries(current).filter(([key]) => key !== field));
    });
    setOperationError(null);
  };
  const error = (field: MetadataDraftField): React.JSX.Element | null =>
    errors[field] === undefined ? null : (
      <small id={`${errorPrefix}-${field}`} className="field-error">
        {errors[field]}
      </small>
    );
  const describedBy = (field: MetadataDraftField, noteId: string): string =>
    errors[field] === undefined ? noteId : `${noteId} ${errorPrefix}-${field}`;
  const review = (): void => {
    if (draft === null || baseline === null) return;
    const nextErrors = validateMetadataDraft(draft, baseline);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setOperationError('Corrija os campos indicados antes de revisar as alterações.');
      setStatusMessage('O formulário contém erros de validação.');
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }
    if (Object.keys(changes).length === 0) {
      setOperationError('Altere pelo menos um campo antes de continuar.');
      setStatusMessage('Nenhuma alteração foi encontrada.');
      return;
    }
    setOperationError(null);
    setStatusMessage('Resumo de alterações aberto para confirmação.');
    setMode('confirming');
  };
  const cancelConfirmation = (): void => {
    setMode('editing');
    setStatusMessage('Confirmação cancelada; o rascunho continua aberto.');
    requestAnimationFrame(() => {
      reviewButtonRef.current?.focus();
    });
  };
  const save = async (): Promise<void> => {
    if (draft === null || baseline === null || Object.keys(changes).length === 0) return;
    setMode('saving');
    setStatusMessage('Salvando metadados no diário local…');
    let result: UpdateMetadataResult;
    try {
      result = await onSave({
        projectId: baseline.projectId,
        expectedRevisionHash: baseline.revisionHash,
        changes,
        reason: draft.reason.trim(),
      });
    } catch {
      setMode('error');
      setOperationError('A integração desktop falhou. O rascunho continua aberto.');
      setStatusMessage('Não foi possível salvar. O rascunho continua aberto.');
      requestAnimationFrame(() => {
        reviewButtonRef.current?.focus();
      });
      return;
    }
    if (!result.ok) {
      if (result.error.code === 'CONFLICT') {
        setMode('conflict');
        setOperationError(
          'A revisão mudou enquanto o formulário estava aberto. O rascunho local foi preservado.',
        );
        setStatusMessage(
          'Conflito de revisão. Carregue a revisão atual antes de confirmar novamente.',
        );
      } else {
        setMode('error');
        setOperationError(result.error.message);
        setStatusMessage('Não foi possível salvar. O rascunho continua aberto.');
      }
      requestAnimationFrame(() => {
        reviewButtonRef.current?.focus();
      });
      return;
    }
    setMode('closed');
    setBaseline(null);
    setDraft(null);
    setErrors({});
    setOperationError(null);
    setStatusMessage('Metadados salvos no diário local e preview atualizado.');
    focusEditButton();
  };
  const reloadCurrent = async (): Promise<void> => {
    setStatusMessage('Carregando a revisão atual sem descartar o rascunho…');
    let current: MetadataStateDto | null;
    try {
      current = await onReload();
    } catch {
      current = null;
    }
    if (current === null) {
      setOperationError('Não foi possível carregar a revisão atual. O rascunho foi mantido.');
      setStatusMessage('Falha ao carregar a revisão atual.');
      return;
    }
    setBaseline(current);
    setErrors({});
    setOperationError(null);
    setMode('editing');
    setStatusMessage(
      'Revisão atual carregada. O rascunho local foi preservado para uma nova comparação.',
    );
    requestAnimationFrame(() => {
      reviewButtonRef.current?.focus();
    });
  };
  const returnToPreview = (): void => {
    const previewTitle = globalThis.document.getElementById('preview-title');
    previewTitle?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    previewTitle?.focus();
  };

  return (
    <section
      className="panel metadata-panel"
      id="metadados"
      data-project-id={state?.projectId}
      aria-labelledby="metadata-title"
    >
      <header className="panel-header metadata-header">
        <div>
          <p className="eyebrow">Frontmatter validado</p>
          <h2 id="metadata-title">Metadados</h2>
        </div>
        <div className="metadata-header-actions">
          <button type="button" className="secondary-button" onClick={returnToPreview}>
            Voltar ao preview
          </button>
          {activeMode === 'closed' ? (
            <button
              ref={editButtonRef}
              type="button"
              disabled={state === null}
              onClick={openEditor}
            >
              Editar metadados
            </button>
          ) : null}
        </div>
      </header>
      <div className="metadata-status" role="status" aria-live="polite">
        {projectChanged
          ? 'A edição anterior foi fechada porque o projeto ativo mudou.'
          : statusMessage}
      </div>
      {state === null ? (
        <div className="metadata-empty">
          <h3>Nenhuma lei carregada</h3>
          <p>Importe uma lei para revisar os metadados projetados do frontmatter.</p>
        </div>
      ) : activeMode === 'closed' || draft === null || baseline === null ? (
        <MetadataOverview state={state} />
      ) : (
        <form
          ref={formRef}
          className="metadata-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
        >
          {operationError === null ? null : (
            <div className="metadata-operation-error" role="alert">
              <p>{operationError}</p>
              {activeMode === 'conflict' ? (
                <button type="button" onClick={() => void reloadCurrent()}>
                  Carregar revisão atual
                </button>
              ) : null}
            </div>
          )}
          <fieldset disabled={busy}>
            <legend>Editorial</legend>
            <div className="metadata-form-grid">
              <label>
                Título
                <input
                  data-metadata-control
                  name="metadata-title"
                  value={draft.titulo}
                  maxLength={500}
                  disabled={!baseline.fields.titulo.editable}
                  aria-invalid={errors.titulo !== undefined}
                  aria-describedby={describedBy('titulo', 'metadata-title-note')}
                  onChange={(event) => {
                    update('titulo', event.currentTarget.value);
                  }}
                />
                <span id="metadata-title-note">
                  <MetadataFieldNote field={baseline.fields.titulo} />
                </span>
                {error('titulo')}
              </label>
              <label>
                Ramo
                <input
                  data-metadata-control
                  name="metadata-branch"
                  value={draft.ramo}
                  maxLength={160}
                  disabled={!baseline.fields.ramo.editable}
                  aria-invalid={errors.ramo !== undefined}
                  aria-describedby={describedBy('ramo', 'metadata-branch-note')}
                  onChange={(event) => {
                    update('ramo', event.currentTarget.value);
                  }}
                />
                <span id="metadata-branch-note">
                  <MetadataFieldNote field={baseline.fields.ramo} />
                </span>
                {error('ramo')}
              </label>
              <label>
                Vigência
                <select
                  data-metadata-control
                  name="metadata-legal-status"
                  value={draft.legalStatus}
                  disabled={!baseline.fields.legalStatus.editable}
                  onChange={(event) => {
                    const value = event.currentTarget.value as MetadataDraft['legalStatus'];
                    update('legalStatus', value);
                    if (value !== 'revogada') update('revogadaPor', '');
                  }}
                >
                  {Object.entries(LEGAL_STATUS_OPTIONS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <MetadataFieldNote field={baseline.fields.legalStatus} />
              </label>
              <label>
                Tags
                <textarea
                  data-metadata-control
                  name="metadata-tags"
                  rows={3}
                  value={draft.tags}
                  disabled={!baseline.fields.tags.editable}
                  aria-invalid={errors.tags !== undefined}
                  aria-describedby={describedBy('tags', 'metadata-tags-note')}
                  placeholder="Separe tags por vírgula ou linha"
                  onChange={(event) => {
                    update('tags', event.currentTarget.value);
                  }}
                />
                <span id="metadata-tags-note" className="metadata-field-note">
                  Separe até 100 tags por vírgula ou linha. Origem:{' '}
                  {ORIGIN_LABELS[baseline.fields.tags.origin]}.
                </span>
                {error('tags')}
              </label>
              <label>
                Norma revogadora
                <input
                  data-metadata-control
                  name="metadata-revoked-by"
                  value={draft.revogadaPor}
                  maxLength={500}
                  disabled={
                    !baseline.fields.revogadaPor.editable || draft.legalStatus !== 'revogada'
                  }
                  aria-invalid={errors.revogadaPor !== undefined}
                  aria-describedby={describedBy('revogadaPor', 'metadata-revoked-by-note')}
                  onChange={(event) => {
                    update('revogadaPor', event.currentTarget.value);
                  }}
                />
                <span id="metadata-revoked-by-note">
                  <MetadataFieldNote field={baseline.fields.revogadaPor} />
                </span>
                {error('revogadaPor')}
              </label>
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Identidade pré-publicação</legend>
            <p className="metadata-group-help">
              Estes campos ficam bloqueados após a primeira publicação ou quando o histórico não
              pode comprovar que a lei nunca foi publicada.
            </p>
            <div className="metadata-form-grid">
              <label>
                Sigla
                <input
                  data-metadata-control
                  name="metadata-acronym"
                  value={draft.sigla}
                  maxLength={80}
                  spellCheck={false}
                  disabled={!baseline.fields.sigla.editable}
                  aria-invalid={errors.sigla !== undefined}
                  aria-describedby={describedBy('sigla', 'metadata-acronym-note')}
                  onChange={(event) => {
                    update('sigla', event.currentTarget.value);
                  }}
                />
                <span id="metadata-acronym-note">
                  <MetadataFieldNote field={baseline.fields.sigla} />
                </span>
                {error('sigla')}
              </label>
              <label>
                Tipo da norma
                <select
                  data-metadata-control
                  name="metadata-law-type"
                  value={draft.tipoNorma}
                  disabled={!baseline.fields.tipoNorma.editable}
                  onChange={(event) => {
                    update('tipoNorma', event.currentTarget.value as MetadataDraft['tipoNorma']);
                  }}
                >
                  {LAW_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <MetadataFieldNote field={baseline.fields.tipoNorma} />
              </label>
              <label>
                Número
                <input
                  data-metadata-control
                  name="metadata-number"
                  value={draft.numero}
                  maxLength={80}
                  disabled={!baseline.fields.numero.editable}
                  aria-invalid={errors.numero !== undefined}
                  aria-describedby={describedBy('numero', 'metadata-number-note')}
                  onChange={(event) => {
                    update('numero', event.currentTarget.value);
                  }}
                />
                <span id="metadata-number-note">
                  <MetadataFieldNote field={baseline.fields.numero} />
                </span>
                {error('numero')}
              </label>
              <label>
                Ano
                <input
                  data-metadata-control
                  name="metadata-year"
                  type="number"
                  min={1000}
                  max={9999}
                  value={draft.ano}
                  disabled={!baseline.fields.ano.editable}
                  aria-invalid={errors.ano !== undefined}
                  aria-describedby={describedBy('ano', 'metadata-year-note')}
                  onChange={(event) => {
                    update('ano', event.currentTarget.value);
                  }}
                />
                <span id="metadata-year-note">
                  <MetadataFieldNote field={baseline.fields.ano} />
                </span>
                {error('ano')}
              </label>
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Proveniência</legend>
            <div className="metadata-form-grid">
              <label>
                Data de publicação
                <input
                  data-metadata-control
                  name="metadata-publication-date"
                  type="date"
                  value={draft.dataPublicacao}
                  disabled={!baseline.fields.dataPublicacao.editable}
                  aria-invalid={errors.dataPublicacao !== undefined}
                  aria-describedby={describedBy('dataPublicacao', 'metadata-publication-date-note')}
                  onChange={(event) => {
                    update('dataPublicacao', event.currentTarget.value);
                  }}
                />
                <span id="metadata-publication-date-note">
                  <MetadataFieldNote field={baseline.fields.dataPublicacao} />
                </span>
                {error('dataPublicacao')}
              </label>
              <label>
                Data de atualização legal
                <input
                  data-metadata-control
                  name="metadata-update-date"
                  type="date"
                  value={draft.dataAtualizacaoLegal}
                  disabled={!baseline.fields.dataAtualizacaoLegal.editable}
                  aria-invalid={errors.dataAtualizacaoLegal !== undefined}
                  aria-describedby={describedBy(
                    'dataAtualizacaoLegal',
                    'metadata-update-date-note',
                  )}
                  onChange={(event) => {
                    update('dataAtualizacaoLegal', event.currentTarget.value);
                  }}
                />
                <span id="metadata-update-date-note">
                  <MetadataFieldNote field={baseline.fields.dataAtualizacaoLegal} />
                </span>
                {error('dataAtualizacaoLegal')}
              </label>
              <ReadOnlyMetadata label="Fonte oficial" field={baseline.fields.fonte} />
              <ReadOnlyMetadata
                label="Fontes secundárias"
                field={baseline.fields.fontesSecundarias}
              />
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Sistema</legend>
            <div className="metadata-value-grid">
              <ReadOnlyMetadata
                label="Data de formatação Vinculex"
                field={baseline.fields.dataFormatacaoVinculex}
              />
              <ReadOnlyMetadata label="Versão Vinculex" field={baseline.fields.versaoVinculex} />
              <ReadOnlyMetadata
                label="Estado de publicação"
                field={baseline.fields.publicationStatus}
              />
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Derivados</legend>
            <div className="metadata-value-grid">
              <ReadOnlyMetadata label="Total de artigos" field={baseline.fields.totalArtigos} />
              <ReadOnlyMetadata
                label="Redações dadas por"
                field={baseline.fields.redacoesDadasPor}
              />
              <ReadOnlyMetadata label="IDs depreciados" field={baseline.fields.idsDepreciados} />
              <ReadOnlyMetadata
                label="Perfil de projeção"
                field={baseline.fields.projectionProfile}
              />
              <ReadOnlyMetadata label="Aliases" field={baseline.fields.aliases} />
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Justificativa</legend>
            <label>
              Motivo da alteração
              <textarea
                data-metadata-control
                name="metadata-reason"
                rows={3}
                value={draft.reason}
                maxLength={2_000}
                aria-invalid={errors.reason !== undefined}
                aria-describedby={describedBy('reason', 'metadata-reason-note')}
                placeholder="Registre por que o frontmatter precisa ser corrigido."
                onChange={(event) => {
                  update('reason', event.currentTarget.value);
                }}
              />
              <small id="metadata-reason-note" className="metadata-field-note">
                Obrigatório quando houver alteração; será registrado no diário editorial.
              </small>
              {error('reason')}
            </label>
          </fieldset>
          <div className="metadata-form-actions">
            <button type="button" disabled={busy} onClick={closeEditor}>
              Cancelar
            </button>
            <button
              ref={reviewButtonRef}
              type="submit"
              disabled={busy || activeMode === 'conflict'}
            >
              Revisar alterações
            </button>
          </div>
          {activeMode === 'confirming' || activeMode === 'saving' ? (
            <MetadataConfirmationDialog
              summary={summary}
              reason={draft.reason}
              busy={busy}
              onCancel={cancelConfirmation}
              onConfirm={() => void save()}
            />
          ) : null}
        </form>
      )}
    </section>
  );
};
