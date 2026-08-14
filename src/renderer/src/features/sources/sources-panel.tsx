import { useCallback, useEffect, useId, useRef, useState } from 'react';

import {
  CreateLawSourceBindingRevisionCommandSchema,
  CreateSourceProviderRevisionCommandSchema,
  type ActivateSourceBindingCommand,
  type SourceCatalogListItemDto,
} from '../../../../shared/ipc/sources.js';
import {
  validateSourceDraft,
  type AdapterCapability,
  type DraftErrors,
  type DraftField,
  type SourceDraft,
} from './source-form-validation.js';

type PendingActivationBase = Readonly<{
  input: ActivateSourceBindingCommand;
  description: string;
}>;

type PendingConfirmation =
  | (PendingActivationBase & Readonly<{ mode: 'activate' }>)
  | (PendingActivationBase & Readonly<{ mode: 'restore' }>)
  | Readonly<{
      mode: 'pause';
      item: SourceCatalogListItemDto;
      description: string;
    }>
  | Readonly<{
      mode: 'archive';
      item: SourceCatalogListItemDto;
      description: string;
    }>;

const INITIAL_DRAFT: SourceDraft = Object.freeze({
  providerKey: '',
  providerName: '',
  lawId: '',
  scheme: 'https',
  host: 'www.planalto.gov.br',
  pathPrefix: '/ccivil_03/',
  monitoringIntervalHours: '24',
  primaryVariant: 'compiled',
  primaryUrl: '',
  auxiliaryEnabled: false,
  auxiliaryRole: 'historical_auxiliary',
  auxiliaryVariant: 'annotated',
  auxiliaryUrl: '',
  detectionParameters: {},
});

const ACTIVATION_LABELS = Object.freeze({
  draft: 'Rascunho',
  active: 'Ativa',
  paused: 'Pausada',
  archived: 'Arquivada',
});

const HEALTH_LABELS = Object.freeze({
  unknown: 'Sem verificação',
  healthy: 'Saudável',
  degraded: 'Degradada',
  suspended: 'Suspensa temporariamente',
});

const ROLE_LABELS = Object.freeze({
  primary_current: 'Primária atual',
  historical_auxiliary: 'Histórica auxiliar',
  cross_check: 'Conferência',
});

const VARIANT_LABELS = Object.freeze({
  compiled: 'Compilada',
  annotated: 'Anotada',
  other: 'Outra',
});

const formatTimestamp = (value: string | null): string =>
  value === null
    ? 'Nunca'
    : new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value));

const formatFrequency = (milliseconds: number): string => {
  const hours = milliseconds / (60 * 60 * 1_000);
  return hours % 24 === 0 ? `A cada ${String(hours / 24)} dia(s)` : `A cada ${String(hours)} h`;
};

const friendlyFailure = (fallback: string): string =>
  `${fallback} Atualize a lista antes de tentar novamente.`;

const ConfirmationDialog = ({
  confirmation,
  busy,
  onCancel,
  onConfirm,
}: Readonly<{
  confirmation: PendingConfirmation;
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
  const destructive = confirmation.mode === 'archive';
  return (
    <dialog
      ref={dialogRef}
      className="source-confirmation-dialog"
      aria-labelledby="source-confirmation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id="source-confirmation-title">
        {destructive ? 'Arquivar configuração?' : 'Confirmar alteração da fonte?'}
      </h3>
      <p>{confirmation.description}</p>
      <div className="source-dialog-actions">
        <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>
          Voltar
        </button>
        <button
          className={destructive ? 'danger-button' : undefined}
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Aplicando…' : destructive ? 'Arquivar fonte' : 'Confirmar alteração'}
        </button>
      </div>
    </dialog>
  );
};

const SourceRevisionForm = ({
  capabilities,
  busy,
  errors,
  onSubmit,
  onCancel,
}: Readonly<{
  capabilities: readonly AdapterCapability[];
  busy: boolean;
  errors: DraftErrors;
  onSubmit(draft: SourceDraft, capability: AdapterCapability): void;
  onCancel(): void;
}>): React.JSX.Element => {
  const [draft, setDraft] = useState<SourceDraft>(INITIAL_DRAFT);
  const [adapterIndex, setAdapterIndex] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const providerKeyRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const capability = capabilities[adapterIndex] ?? null;
  useEffect(() => {
    providerKeyRef.current?.focus();
  }, []);
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  const update = <Field extends DraftField>(field: Field, value: SourceDraft[Field]): void => {
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const selectCapability = (index: number): void => {
    const selected = capabilities[index];
    if (selected === undefined) return;
    const scheme = selected.allowedSchemes[0];
    const host = selected.allowedHosts[0];
    const variant = selected.supportedSourceVariants[0];
    if (scheme === undefined || host === undefined || variant === undefined) return;
    setAdapterIndex(index);
    setDraft((current) => ({
      ...current,
      scheme,
      host,
      primaryVariant: variant,
      auxiliaryVariant: variant,
      detectionParameters: Object.fromEntries(
        selected.detectionFields.map((field) => [field.key, field.defaultValue]),
      ),
    }));
  };
  const updateDetectionParameter = (key: string, value: boolean): void => {
    setDraft((current) => ({
      ...current,
      detectionParameters: { ...current.detectionParameters, [key]: value },
    }));
  };
  const error = (field: DraftField): React.JSX.Element | null =>
    errors[field] === undefined ? null : (
      <small id={`${errorId}-${field}`} className="field-error">
        {errors[field]}
      </small>
    );
  const describedBy = (field: DraftField): string | undefined =>
    errors[field] === undefined ? undefined : `${errorId}-${field}`;
  if (capability === null)
    return <p className="operation-error">Nenhum adaptador instalado está disponível.</p>;
  return (
    <form
      ref={formRef}
      className="source-revision-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(draft, capability);
      }}
    >
      <header>
        <div>
          <p className="eyebrow">Nova revisão</p>
          <h3>Configurar origem oficial</h3>
        </div>
        <button type="button" disabled={busy} onClick={onCancel}>
          Fechar formulário
        </button>
      </header>
      <fieldset disabled={busy}>
        <legend>Adaptador instalado</legend>
        <label htmlFor="source-adapter">Adaptador</label>
        <select
          id="source-adapter"
          name="source-adapter"
          value={adapterIndex}
          autoComplete="off"
          onChange={(event) => {
            selectCapability(Number(event.currentTarget.value));
          }}
        >
          {capabilities.map((candidate, index) => (
            <option
              key={`${candidate.adapterId}:${String(candidate.contractVersion)}`}
              value={index}
            >
              {candidate.displayName} · contrato {String(candidate.contractVersion)}
            </option>
          ))}
        </select>
        <p className="field-help">
          Tipos aceitos: {capability.supportedSourceTypes.join(', ')} · até{' '}
          {String(capability.maximumArtifacts)} artefato(s).
        </p>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Identidade e lei</legend>
        <div className="source-form-grid">
          <label>
            Chave do provedor
            <input
              ref={providerKeyRef}
              name="provider-key"
              value={draft.providerKey}
              autoComplete="off"
              spellCheck={false}
              placeholder="planalto-oficial…"
              aria-invalid={errors.providerKey !== undefined}
              aria-describedby={describedBy('providerKey')}
              onChange={(event) => {
                update('providerKey', event.currentTarget.value);
              }}
            />
            {error('providerKey')}
          </label>
          <label>
            Nome do provedor
            <input
              name="provider-name"
              value={draft.providerName}
              autoComplete="off"
              placeholder="Portal oficial de legislação…"
              aria-invalid={errors.providerName !== undefined}
              aria-describedby={describedBy('providerName')}
              onChange={(event) => {
                update('providerName', event.currentTarget.value);
              }}
            />
            {error('providerName')}
          </label>
          <label>
            UUID da lei
            <input
              name="law-id"
              value={draft.lawId}
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-4000-8000-000000000000…"
              aria-invalid={errors.lawId !== undefined}
              aria-describedby={describedBy('lawId')}
              onChange={(event) => {
                update('lawId', event.currentTarget.value);
              }}
            />
            {error('lawId')}
          </label>
          <label>
            Frequência em horas
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="744"
              name="monitoring-interval-hours"
              value={draft.monitoringIntervalHours}
              autoComplete="off"
              aria-invalid={errors.monitoringIntervalHours !== undefined}
              aria-describedby={describedBy('monitoringIntervalHours')}
              onChange={(event) => {
                update('monitoringIntervalHours', event.currentTarget.value);
              }}
            />
            {error('monitoringIntervalHours')}
          </label>
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Origem exata</legend>
        <div className="source-origin-grid">
          <label>
            Esquema
            <select
              name="origin-scheme"
              value={draft.scheme}
              autoComplete="off"
              aria-invalid={errors.scheme !== undefined}
              aria-describedby={describedBy('scheme')}
              onChange={(event) => {
                update('scheme', event.currentTarget.value as 'http' | 'https');
              }}
            >
              {capability.allowedSchemes.map((scheme) => (
                <option key={scheme} value={scheme}>
                  {scheme}
                </option>
              ))}
            </select>
            {error('scheme')}
          </label>
          <label>
            Host oficial
            <select
              name="origin-host"
              value={draft.host}
              autoComplete="off"
              aria-invalid={errors.host !== undefined}
              aria-describedby={describedBy('host')}
              onChange={(event) => {
                update('host', event.currentTarget.value);
              }}
            >
              {capability.allowedHosts.map((host) => (
                <option key={host} value={host}>
                  {host}
                </option>
              ))}
            </select>
            {error('host')}
          </label>
          <label>
            Prefixo de caminho
            <input
              name="origin-path-prefix"
              value={draft.pathPrefix}
              autoComplete="off"
              spellCheck={false}
              placeholder="/ccivil_03/…"
              aria-invalid={errors.pathPrefix !== undefined}
              aria-describedby={describedBy('pathPrefix')}
              onChange={(event) => {
                update('pathPrefix', event.currentTarget.value);
              }}
            />
            {error('pathPrefix')}
          </label>
        </div>
        {capability.detectionFields.map((field) => (
          <label className="source-checkbox" key={field.key}>
            <input
              type="checkbox"
              name={field.key}
              checked={draft.detectionParameters[field.key] ?? field.defaultValue}
              onChange={(event) => {
                updateDetectionParameter(field.key, event.currentTarget.checked);
              }}
            />
            {field.label}
          </label>
        ))}
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Conjunto de artefatos</legend>
        <div className="source-artifact-editor">
          <div>
            <strong>Fonte primária atual</strong>
            <label>
              Variante
              <select
                name="primary-variant"
                value={draft.primaryVariant}
                autoComplete="off"
                onChange={(event) => {
                  update(
                    'primaryVariant',
                    event.currentTarget.value as SourceDraft['primaryVariant'],
                  );
                }}
              >
                {capability.supportedSourceVariants.map((variant) => (
                  <option key={variant} value={variant}>
                    {VARIANT_LABELS[variant]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              URL oficial
              <input
                type="url"
                name="primary-url"
                value={draft.primaryUrl}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://www.planalto.gov.br/ccivil_03/leis/…"
                aria-invalid={errors.primaryUrl !== undefined}
                aria-describedby={describedBy('primaryUrl')}
                onChange={(event) => {
                  update('primaryUrl', event.currentTarget.value);
                }}
              />
              {error('primaryUrl')}
            </label>
          </div>
          {capability.maximumArtifacts > 1 ? (
            <div>
              <label className="source-checkbox">
                <input
                  type="checkbox"
                  checked={draft.auxiliaryEnabled}
                  onChange={(event) => {
                    update('auxiliaryEnabled', event.currentTarget.checked);
                  }}
                />
                Adicionar fonte auxiliar
              </label>
              {draft.auxiliaryEnabled ? (
                <>
                  <label>
                    Função
                    <select
                      name="auxiliary-role"
                      value={draft.auxiliaryRole}
                      autoComplete="off"
                      onChange={(event) => {
                        update(
                          'auxiliaryRole',
                          event.currentTarget.value as SourceDraft['auxiliaryRole'],
                        );
                      }}
                    >
                      {capability.supportedSourceRoles
                        .filter((role) => role !== 'primary_current')
                        .map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Variante
                    <select
                      name="auxiliary-variant"
                      value={draft.auxiliaryVariant}
                      autoComplete="off"
                      onChange={(event) => {
                        update(
                          'auxiliaryVariant',
                          event.currentTarget.value as SourceDraft['auxiliaryVariant'],
                        );
                      }}
                    >
                      {capability.supportedSourceVariants.map((variant) => (
                        <option key={variant} value={variant}>
                          {VARIANT_LABELS[variant]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    URL auxiliar
                    <input
                      type="url"
                      name="auxiliary-url"
                      value={draft.auxiliaryUrl}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="https://www.planalto.gov.br/ccivil_03/leis/…"
                      aria-invalid={errors.auxiliaryUrl !== undefined}
                      aria-describedby={describedBy('auxiliaryUrl')}
                      onChange={(event) => {
                        update('auxiliaryUrl', event.currentTarget.value);
                      }}
                    />
                    {error('auxiliaryUrl')}
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </fieldset>
      <p className="source-form-note">
        Salvar cria revisões imutáveis e executa o teste seguro. A ativação exige uma confirmação
        separada depois do resultado.
      </p>
      <button type="submit" disabled={busy}>
        {busy ? 'Criando e testando…' : 'Criar revisão e testar'}
      </button>
    </form>
  );
};

const CatalogItem = ({
  item,
  busy,
  onTest,
  onRequestCheck,
  onConfirm,
}: Readonly<{
  item: SourceCatalogListItemDto;
  busy: boolean;
  onTest(item: SourceCatalogListItemDto): void;
  onRequestCheck(item: SourceCatalogListItemDto): void;
  onConfirm(confirmation: PendingConfirmation): void;
}>): React.JSX.Element => {
  const activationInput =
    item.lastTestEvidenceId === null
      ? null
      : {
          providerId: item.providerId,
          providerRevisionId: item.providerRevisionId,
          expectedProviderLockVersion: item.providerLockVersion,
          bindingId: item.bindingId,
          bindingRevisionId: item.bindingRevisionId,
          expectedBindingLockVersion: item.bindingLockVersion,
          testEvidenceId: item.lastTestEvidenceId,
        };
  return (
    <article className="source-catalog-card">
      <header>
        <div className="source-card-title">
          <p className="eyebrow">{item.providerName}</p>
          <h3>{item.lawTitle}</h3>
          <small>
            Provedor r{String(item.providerRevisionNumber)} · vínculo r
            {String(item.bindingRevisionNumber)} · {item.adapterId} v
            {String(item.adapterContractVersion)}
          </small>
        </div>
        <div className="source-state-badges">
          <span className={`activation-${item.sourceActivationState}`}>
            {ACTIVATION_LABELS[item.sourceActivationState]}
          </span>
          <span className={`health-${item.sourceHealthState}`}>
            {HEALTH_LABELS[item.sourceHealthState]}
          </span>
        </div>
      </header>
      <dl className="source-card-metadata">
        <div>
          <dt>Frequência</dt>
          <dd>{formatFrequency(item.monitoringIntervalMs)}</dd>
        </div>
        <div>
          <dt>Último teste</dt>
          <dd>{formatTimestamp(item.lastTestedAt)}</dd>
        </div>
        <div>
          <dt>Última verificação</dt>
          <dd>{formatTimestamp(item.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>Resultado do teste</dt>
          <dd>
            {item.lastSourceTestOutcome === null
              ? 'Não testada'
              : item.lastSourceTestOutcome === 'success'
                ? 'Aprovado'
                : `Falhou${item.lastErrorCode === null ? '' : ` · ${item.lastErrorCode}`}`}
          </dd>
        </div>
      </dl>
      <ul className="source-artifact-list">
        {item.artifacts.map((artifact) => (
          <li key={artifact.sourceUrl}>
            <span>
              <strong>{ROLE_LABELS[artifact.sourceRole]}</strong>
              <small>{VARIANT_LABELS[artifact.sourceVariant]}</small>
            </span>
            <code translate="no" className="source-artifact-url">
              {artifact.sourceUrl}
            </code>
          </li>
        ))}
      </ul>
      <div className="source-card-actions">
        {item.sourceActivationState === 'draft' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onTest(item);
            }}
          >
            Testar revisão
          </button>
        ) : null}
        {item.sourceActivationState === 'draft' &&
        item.lastSourceTestOutcome === 'success' &&
        activationInput !== null ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onConfirm({
                mode: 'activate',
                input: activationInput,
                description: `Ativar a revisão ${String(item.bindingRevisionNumber)} para ${item.lawTitle}?`,
              });
            }}
          >
            Ativar revisão testada
          </button>
        ) : null}
        {item.sourceActivationState === 'active' ? (
          <>
            <button
              type="button"
              disabled={busy || item.sourceHealthState === 'suspended'}
              title={
                item.sourceHealthState === 'suspended'
                  ? 'Aguarde o fim da suspensão operacional'
                  : 'Solicitar verificação imediata deduplicada'
              }
              onClick={() => {
                onRequestCheck(item);
              }}
            >
              Verificar agora
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                onConfirm({
                  mode: 'pause',
                  item,
                  description: `Pausar novos jobs e importações de ${item.lawTitle}? Jobs já capturados poderão terminar.`,
                });
              }}
            >
              Pausar
            </button>
          </>
        ) : null}
        {['paused', 'archived'].includes(item.sourceActivationState) &&
        activationInput !== null &&
        item.lastSourceTestOutcome === 'success' ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onConfirm({
                mode: 'restore',
                input: activationInput,
                description: `Restaurar a revisão testada ${String(item.bindingRevisionNumber)} para ${item.lawTitle}?`,
              });
            }}
          >
            Restaurar revisão
          </button>
        ) : null}
        {item.sourceActivationState !== 'archived' ? (
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={() => {
              onConfirm({
                mode: 'archive',
                item,
                description: `Arquivar ${item.lawTitle}? A revisão e a auditoria serão preservadas, mas novos jobs e importações ficarão bloqueados.`,
              });
            }}
          >
            Arquivar
          </button>
        ) : null}
      </div>
    </article>
  );
};

export const SourcesPanel = (): React.JSX.Element => {
  const [items, setItems] = useState<readonly SourceCatalogListItemDto[]>([]);
  const [capabilities, setCapabilities] = useState<readonly AdapterCapability[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formErrors, setFormErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (cursor: string | null = null): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await api.sources.list({ cursor, limit: 25 });
    setLoading(false);
    if (!result.ok) {
      setError(
        result.error.code === 'NOT_ALLOWED'
          ? 'Entre com uma conta administradora para configurar fontes oficiais.'
          : 'Não foi possível carregar o catálogo. Verifique a conexão e tente novamente.',
      );
      return;
    }
    setError(null);
    setCapabilities(result.value.adapterCapabilities);
    setNextCursor(result.value.nextCursor);
    setItems((current) =>
      cursor === null ? result.value.items : [...current, ...result.value.items],
    );
  }, []);

  useEffect(() => {
    const timeout = globalThis.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [load]);

  const perform = useCallback(
    async (pending: PendingConfirmation): Promise<void> => {
      const api = window.lexDesktop;
      if (api === undefined) return;
      setBusy(true);
      setError(null);
      const result =
        pending.mode === 'activate'
          ? await api.sources.activate(pending.input)
          : pending.mode === 'restore'
            ? await api.sources.restore(pending.input)
            : pending.mode === 'pause'
              ? await api.sources.pause({
                  bindingId: pending.item.bindingId,
                  expectedBindingLockVersion: pending.item.bindingLockVersion,
                })
              : await api.sources.archive({
                  bindingId: pending.item.bindingId,
                  expectedBindingLockVersion: pending.item.bindingLockVersion,
                });
      setBusy(false);
      setConfirmation(null);
      if (!result.ok) {
        setError(friendlyFailure(result.error.message));
        headingRef.current?.focus();
        await load();
        return;
      }
      setMessage(
        pending.mode === 'activate'
          ? 'Revisão testada ativada.'
          : pending.mode === 'restore'
            ? 'Revisão testada restaurada.'
            : pending.mode === 'pause'
              ? 'Fonte pausada; novos jobs foram bloqueados.'
              : 'Fonte arquivada com o histórico preservado.',
      );
      await load();
      headingRef.current?.focus();
    },
    [load],
  );

  const testExisting = useCallback(
    async (item: SourceCatalogListItemDto): Promise<void> => {
      const api = window.lexDesktop;
      if (api === undefined) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      const result = await api.sources.dryRun({
        providerRevisionId: item.providerRevisionId,
        bindingRevisionId: item.bindingRevisionId,
      });
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      if (result.value.sourceTestOutcome === 'failure') {
        setError(
          `Teste falhou na etapa ${result.value.completedStage}: ${result.value.errorCode ?? 'falha sem código'}. Corrija a configuração antes de ativar.`,
        );
        await load();
        return;
      }
      setMessage('Teste seguro concluído com sucesso. Confirme para ativar a revisão.');
      setConfirmation({
        mode: 'activate',
        description: `O teste da revisão ${String(item.bindingRevisionNumber)} foi aprovado. Ativar para ${item.lawTitle}?`,
        input: {
          providerId: item.providerId,
          providerRevisionId: item.providerRevisionId,
          expectedProviderLockVersion: item.providerLockVersion,
          bindingId: item.bindingId,
          bindingRevisionId: item.bindingRevisionId,
          expectedBindingLockVersion: item.bindingLockVersion,
          testEvidenceId: result.value.testEvidenceId,
        },
      });
    },
    [load],
  );

  const createAndTest = useCallback(
    async (draft: SourceDraft, capability: AdapterCapability): Promise<void> => {
      const api = window.lexDesktop;
      if (api === undefined) return;
      const errors = validateSourceDraft(draft, capability);
      setFormErrors(errors);
      if (Object.keys(errors).length > 0) return;
      const providerInput = CreateSourceProviderRevisionCommandSchema.parse({
        providerKey: draft.providerKey,
        expectedLockVersion: 0,
        providerName: draft.providerName.trim(),
        sourceType: capability.supportedSourceTypes[0],
        adapterId: capability.adapterId,
        adapterContractVersion: capability.contractVersion,
        origin: {
          scheme: draft.scheme,
          host: draft.host,
          port: null,
          pathPrefix: draft.pathPrefix,
        },
        detectionParameters: Object.fromEntries(
          capability.detectionFields.map((field) => [
            field.key,
            draft.detectionParameters[field.key] ?? field.defaultValue,
          ]),
        ),
      });
      setBusy(true);
      setError(null);
      setMessage(null);
      const provider = await api.sources.createProviderRevision(providerInput);
      if (!provider.ok) {
        setBusy(false);
        setError(friendlyFailure(provider.error.message));
        return;
      }
      const artifacts = [
        {
          order: 0,
          sourceRole: 'primary_current' as const,
          sourceVariant: draft.primaryVariant,
          sourceUrl: draft.primaryUrl,
        },
        ...(draft.auxiliaryEnabled
          ? [
              {
                order: 1,
                sourceRole: draft.auxiliaryRole,
                sourceVariant: draft.auxiliaryVariant,
                sourceUrl: draft.auxiliaryUrl,
              },
            ]
          : []),
      ];
      const bindingInput = CreateLawSourceBindingRevisionCommandSchema.parse({
        lawId: draft.lawId,
        providerRevisionId: provider.value.providerRevisionId,
        expectedLockVersion: 0,
        artifacts,
        monitoringIntervalMs: Number(draft.monitoringIntervalHours) * 60 * 60 * 1_000,
      });
      const binding = await api.sources.createBindingRevision(bindingInput);
      if (!binding.ok) {
        setBusy(false);
        setError(friendlyFailure(binding.error.message));
        return;
      }
      const tested = await api.sources.dryRun({
        providerRevisionId: provider.value.providerRevisionId,
        bindingRevisionId: binding.value.bindingRevisionId,
      });
      setBusy(false);
      if (!tested.ok) {
        setError(tested.error.message);
        await load();
        return;
      }
      if (tested.value.sourceTestOutcome === 'failure') {
        setError(
          `A revisão foi preservada como rascunho, mas o teste falhou na etapa ${tested.value.completedStage}: ${tested.value.errorCode ?? 'falha sem código'}.`,
        );
        setFormOpen(false);
        await load();
        return;
      }
      setFormOpen(false);
      setMessage('Revisões criadas e testadas. Confirme a ativação.');
      setConfirmation({
        mode: 'activate',
        description: `O teste seguro foi aprovado. Ativar ${draft.providerName.trim()} para a lei informada?`,
        input: {
          providerId: provider.value.providerId,
          providerRevisionId: provider.value.providerRevisionId,
          expectedProviderLockVersion: provider.value.providerLockVersion,
          bindingId: binding.value.bindingId,
          bindingRevisionId: binding.value.bindingRevisionId,
          expectedBindingLockVersion: binding.value.bindingLockVersion,
          testEvidenceId: tested.value.testEvidenceId,
        },
      });
      await load();
    },
    [load],
  );

  const requestCheck = useCallback(async (item: SourceCatalogListItemDto): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    setBusy(true);
    setError(null);
    const result = await api.sources.requestCheck({
      bindingId: item.bindingId,
      idempotencyKey: globalThis.crypto.randomUUID(),
    });
    setBusy(false);
    if (!result.ok) {
      setError(
        `${result.error.message} A fonte pode estar suspensa ou ter sido alterada; atualize a lista antes de repetir.`,
      );
      return;
    }
    setMessage(
      result.value.deduplicated
        ? 'Já existe uma verificação em andamento para esta fonte.'
        : 'Verificação adicionada à fila.',
    );
  }, []);

  return (
    <section className="panel sources-panel" id="fontes" aria-labelledby="sources-title">
      <header className="panel-header sources-header">
        <div>
          <p className="eyebrow">Administração técnica</p>
          <h2 id="sources-title" ref={headingRef} tabIndex={-1}>
            Configuração de fontes
          </h2>
        </div>
        <button
          type="button"
          disabled={busy || capabilities.length === 0}
          onClick={() => {
            setFormErrors({});
            setFormOpen(true);
            setError(null);
          }}
        >
          Nova fonte oficial
        </button>
      </header>
      <div className="panel-content sources-content">
        <p className="panel-description">
          Cadastre somente origens compatíveis com adaptadores instalados. Revisões, testes e
          mudanças de ativação permanecem auditáveis.
        </p>
        <div className="source-live-region" aria-live="polite" aria-atomic="true">
          {message === null ? null : (
            <p className="operation-success" role="status">
              {message}
            </p>
          )}
          {error === null ? null : (
            <p className="operation-error" role="alert">
              {error}
            </p>
          )}
        </div>
        {formOpen ? (
          <SourceRevisionForm
            capabilities={capabilities}
            busy={busy}
            errors={formErrors}
            onCancel={() => {
              setFormOpen(false);
            }}
            onSubmit={(draft, capability) => void createAndTest(draft, capability)}
          />
        ) : null}
        {loading && items.length === 0 ? (
          <p className="source-loading">Carregando fontes…</p>
        ) : null}
        {!loading && error === null && items.length === 0 ? (
          <div className="sources-empty">
            <h3>Nenhuma fonte configurada</h3>
            <p>Crie uma revisão, execute o teste seguro e confirme a ativação.</p>
          </div>
        ) : null}
        <div className="source-catalog-list">
          {items.map((item) => (
            <CatalogItem
              key={item.bindingId}
              item={item}
              busy={busy}
              onTest={(candidate) => void testExisting(candidate)}
              onRequestCheck={(candidate) => void requestCheck(candidate)}
              onConfirm={setConfirmation}
            />
          ))}
        </div>
        {nextCursor === null ? null : (
          <button
            className="secondary-button source-load-more"
            type="button"
            disabled={loading || busy}
            onClick={() => void load(nextCursor)}
          >
            {loading ? 'Carregando…' : 'Carregar mais fontes'}
          </button>
        )}
      </div>
      {confirmation === null ? null : (
        <ConfirmationDialog
          confirmation={confirmation}
          busy={busy}
          onCancel={() => {
            setConfirmation(null);
          }}
          onConfirm={() => void perform(confirmation)}
        />
      )}
    </section>
  );
};
