import { useCallback, useEffect, useState } from 'react';

import type {
  PublicationAttemptDto,
  PublicationConfirmationDto,
  PublicationDiffDto,
  PublicationHistoryItemDto,
} from '../../../../shared/ipc/publication.js';

const PUBLICATION_KIND_LABELS = Object.freeze({
  initial: 'Publicação inicial',
  legislative_update: 'Atualização legislativa',
  editorial_correction: 'Correção editorial',
  rollback: 'Rollback para frente',
});

const ATTEMPT_LABELS = Object.freeze({
  prepared: 'Artefatos preparados; ainda não publicados',
  committed_local: 'Commit local criado; ainda não publicado',
  pushed: 'Candidate enviado; publicação ainda não confirmada',
  syncing: 'SHA promovido; sincronização transacional em andamento',
  published: 'Publicado e confirmado pelo banco',
  failed: 'A tentativa falhou e não foi marcada como publicada',
});

type PublicationPanelProps = Readonly<{
  projectId: string | null;
  lawTitle: string | null;
  sigla: string | null;
  deviceCount: number;
  canPublish: boolean;
}>;

const statusClass = (attempt: PublicationAttemptDto): string =>
  attempt.publicationAttemptStatus === 'published'
    ? 'is-published'
    : attempt.publicationAttemptStatus === 'failed'
      ? 'is-failed'
      : 'is-pending';

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));

const ConfirmationCard = ({
  confirmation,
  busy,
  onCancel,
  onConfirm,
}: Readonly<{
  confirmation: PublicationConfirmationDto;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}>): React.JSX.Element => {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <section className="publication-confirmation" aria-labelledby="publication-confirmation-title">
      <div className="publication-confirmation-heading">
        <div>
          <p className="eyebrow">Confirmação humana</p>
          <h3 id="publication-confirmation-title">Revise o release antes de publicar</h3>
        </div>
        <span>v{confirmation.version}</span>
      </div>
      <dl className="publication-summary-grid">
        <div>
          <dt>Lei</dt>
          <dd>{confirmation.lawTitle}</dd>
        </div>
        <div>
          <dt>Tipo</dt>
          <dd>{PUBLICATION_KIND_LABELS[confirmation.publicationKind]}</dd>
        </div>
        <div>
          <dt>Publicação</dt>
          <dd>#{String(confirmation.publicationNumber)}</dd>
        </div>
        <div>
          <dt>Dispositivos</dt>
          <dd>{confirmation.deviceCount.toLocaleString('pt-BR')}</dd>
        </div>
      </dl>
      <p>{confirmation.sourceSummary}</p>
      <p className="publication-evidence">
        {String(confirmation.artifactKinds.length)} artefatos congelados ·{' '}
        {String(confirmation.changes.included)} incluído(s) · {String(confirmation.changes.amended)}{' '}
        alterado(s) · {String(confirmation.changes.revoked)} revogado(s)
      </p>
      {confirmation.restoredVersion === null ? null : (
        <p className="rollback-warning">
          Esta operação restaura a versão {confirmation.restoredVersion} como uma nova publicação;
          nenhuma versão anterior será apagada.
        </p>
      )}
      <label className="publication-acknowledgement">
        <input
          type="checkbox"
          checked={acknowledged}
          disabled={busy}
          onChange={(event) => {
            setAcknowledged(event.currentTarget.checked);
          }}
        />
        Confirmo que este resumo corresponde ao conteúdo jurídico revisado.
      </label>
      <div className="publication-actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          Voltar
        </button>
        <button type="button" disabled={busy || !acknowledged} onClick={onConfirm}>
          {busy ? 'Publicando…' : 'Confirmar e publicar'}
        </button>
      </div>
    </section>
  );
};

const AttemptCard = ({
  attempt,
  busy,
  onQuery,
  onRetry,
}: Readonly<{
  attempt: PublicationAttemptDto;
  busy: boolean;
  onQuery(): void;
  onRetry(): void;
}>): React.JSX.Element => (
  <section className={`publication-attempt ${statusClass(attempt)}`} aria-live="polite">
    <div>
      <p className="eyebrow">Estado confirmado</p>
      <h3>{ATTEMPT_LABELS[attempt.publicationAttemptStatus]}</h3>
      <p>{attempt.message}</p>
    </div>
    <dl>
      <div>
        <dt>Versão</dt>
        <dd>v{attempt.version}</dd>
      </div>
      <div>
        <dt>Atualizado</dt>
        <dd>{formatTimestamp(attempt.updatedAt)}</dd>
      </div>
      <div>
        <dt>SHA candidato</dt>
        <dd>
          {attempt.candidateSha === null ? 'Ainda não criado' : attempt.candidateSha.slice(0, 12)}
        </dd>
      </div>
    </dl>
    <div className="publication-actions">
      <button type="button" disabled={busy} onClick={onQuery}>
        Consultar estado
      </button>
      {attempt.retryable ? (
        <button type="button" disabled={busy} onClick={onRetry}>
          Retomar mesma tentativa
        </button>
      ) : null}
    </div>
  </section>
);

const DiffView = ({ diff }: { diff: PublicationDiffDto }): React.JSX.Element => (
  <section className="publication-diff" aria-labelledby="rollback-diff-title">
    <h4 id="rollback-diff-title">
      Diff v{diff.fromVersion} → v{diff.toVersion}
    </h4>
    <p>
      {String(diff.changes.included)} incluído(s), {String(diff.changes.amended)} alterado(s),{' '}
      {String(diff.changes.revoked)} revogado(s) e {String(diff.changes.renumbered)} renumerado(s).
    </p>
    <ul>
      {diff.changes.items.map((item) => (
        <li key={`${item.changeKind}:${item.blockId}`}>
          <code>^{item.blockId}</code>
          {item.destinationBlockId === null ? null : <span> → ^{item.destinationBlockId}</span>}
          <span>{item.description}</span>
        </li>
      ))}
    </ul>
    {diff.changes.truncated ? <p>O resumo foi limitado; a validação usa o diff integral.</p> : null}
  </section>
);

export const PublicationPanel = ({
  projectId,
  lawTitle,
  sigla,
  deviceCount,
  canPublish,
}: PublicationPanelProps): React.JSX.Element => {
  const [sourceSummary, setSourceSummary] = useState('Importação conferida em fonte oficial.');
  const [confirmation, setConfirmation] = useState<PublicationConfirmationDto | null>(null);
  const [attempt, setAttempt] = useState<PublicationAttemptDto | null>(null);
  const [history, setHistory] = useState<readonly PublicationHistoryItemDto[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [diff, setDiff] = useState<PublicationDiffDto | null>(null);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const api = window.lexDesktop;
    if (api === undefined || projectId === null) return;
    const result = await api.publication.listHistory({ projectId, cursor: null, limit: 100 });
    if (result.ok) setHistory(result.value.items);
  }, [projectId]);

  useEffect(() => {
    const api = window.lexDesktop;
    if (api === undefined || projectId === null) return;
    let active = true;
    void api.publication.listHistory({ projectId, cursor: null, limit: 100 }).then((result) => {
      if (active && result.ok) setHistory(result.value.items);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const runAttemptAction = useCallback(
    async (action: 'execute' | 'query' | 'retry') => {
      const api = window.lexDesktop;
      const publicationId = confirmation?.publicationId ?? attempt?.publicationId;
      if (api === undefined || publicationId === undefined) return;
      setBusy(true);
      setError(null);
      const result = await (action === 'execute'
        ? api.publication.execute({ publicationId })
        : action === 'retry'
          ? api.publication.retry({ publicationId })
          : api.publication.getAttempt({ publicationId }));
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setAttempt(result.value);
      if (result.value.publicationAttemptStatus === 'published') {
        setConfirmation(null);
        await loadHistory();
      }
    },
    [attempt?.publicationId, confirmation?.publicationId, loadHistory],
  );

  const prepare = useCallback(async () => {
    const api = window.lexDesktop;
    if (api === undefined || projectId === null) return;
    setBusy(true);
    setError(null);
    const result = await api.publication.prepare({ projectId, sourceSummary });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setConfirmation(result.value);
  }, [projectId, sourceSummary]);

  const selectHistory = useCallback(
    async (versionId: string) => {
      const api = window.lexDesktop;
      const current = history.find((item) => item.isCurrent);
      if (api === undefined || projectId === null || current === undefined) return;
      setSelectedVersionId(versionId);
      setError(null);
      const result = await api.publication.getDiff({
        projectId,
        fromVersionId: current.versionId,
        toVersionId: versionId,
      });
      if (result.ok) setDiff(result.value);
      else setError(result.error.message);
    },
    [history, projectId],
  );

  const prepareRollback = useCallback(async () => {
    const api = window.lexDesktop;
    if (api === undefined || projectId === null || selectedVersionId === null) return;
    setBusy(true);
    setError(null);
    const result = await api.publication.prepareRollback({
      projectId,
      restoreVersionId: selectedVersionId,
      justification,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setConfirmation(result.value);
  }, [justification, projectId, selectedVersionId]);

  const historicalVersions = history.filter((item) => !item.isCurrent);
  return (
    <section
      className="panel publication-panel"
      id="publicacao"
      aria-labelledby="publication-title"
    >
      <header className="panel-header">
        <div>
          <p className="eyebrow">Release controlado</p>
          <h2 id="publication-title">Publicação</h2>
        </div>
        <span className="panel-step" aria-label="Etapa 3 de 3">
          03
        </span>
      </header>
      <div className="panel-content publication-content">
        {projectId === null ? (
          <div className="publication-empty">
            <h3>Nenhuma revisão pronta</h3>
            <p>Importe, valide e aprove uma lei antes de iniciar um release.</p>
          </div>
        ) : (
          <>
            <div className="publication-intro">
              <div>
                <p className="empty-kicker">{sigla}</p>
                <h3>{lawTitle}</h3>
                <p>{deviceCount.toLocaleString('pt-BR')} dispositivos no snapshot revisado.</p>
              </div>
              <div className="publication-prepare-form">
                <label htmlFor="publication-summary">Resumo público da publicação</label>
                <input
                  id="publication-summary"
                  value={sourceSummary}
                  maxLength={500}
                  disabled={busy || confirmation !== null}
                  onChange={(event) => {
                    setSourceSummary(event.currentTarget.value);
                  }}
                />
                <button
                  type="button"
                  disabled={
                    !canPublish ||
                    busy ||
                    confirmation !== null ||
                    sourceSummary.trim().length === 0
                  }
                  onClick={() => void prepare()}
                >
                  Preparar release
                </button>
                {!canPublish ? <small>A revisão precisa estar validada e aprovada.</small> : null}
              </div>
            </div>

            {confirmation === null ? null : (
              <ConfirmationCard
                key={confirmation.publicationId}
                confirmation={confirmation}
                busy={busy}
                onCancel={() => {
                  setConfirmation(null);
                }}
                onConfirm={() => void runAttemptAction('execute')}
              />
            )}
            {attempt === null ? null : (
              <AttemptCard
                attempt={attempt}
                busy={busy}
                onQuery={() => void runAttemptAction('query')}
                onRetry={() => void runAttemptAction('retry')}
              />
            )}
            {error === null ? null : (
              <p className="operation-error" role="alert">
                {error}
              </p>
            )}

            <section className="publication-history" aria-labelledby="publication-history-title">
              <div className="publication-history-heading">
                <div>
                  <p className="eyebrow">Auditoria</p>
                  <h3 id="publication-history-title">Histórico de versões</h3>
                </div>
                <button type="button" disabled={busy} onClick={() => void loadHistory()}>
                  Atualizar histórico
                </button>
              </div>
              {history.length === 0 ? (
                <p>Nenhuma publicação concluída encontrada para esta lei.</p>
              ) : (
                <ol className="publication-history-list">
                  {history.map((item) => (
                    <li key={item.versionId} className={item.isCurrent ? 'is-current' : ''}>
                      <div>
                        <strong>v{item.version}</strong>
                        <span>
                          #{String(item.publicationNumber)} ·{' '}
                          {PUBLICATION_KIND_LABELS[item.publicationKind]}
                        </span>
                        <small>{formatTimestamp(item.publishedAt)}</small>
                      </div>
                      {item.isCurrent ? (
                        <span className="current-version-badge">Versão pública</span>
                      ) : (
                        <button type="button" onClick={() => void selectHistory(item.versionId)}>
                          Comparar
                        </button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {diff === null ? null : <DiffView diff={diff} />}
              {diff === null || historicalVersions.length === 0 ? null : (
                <div className="rollback-form">
                  <label htmlFor="rollback-justification">Justificativa obrigatória</label>
                  <textarea
                    id="rollback-justification"
                    rows={3}
                    value={justification}
                    maxLength={1_000}
                    placeholder="Explique por que a versão histórica deve ser restaurada."
                    onChange={(event) => {
                      setJustification(event.currentTarget.value);
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || justification.trim().length < 10}
                    onClick={() => void prepareRollback()}
                  >
                    Preparar rollback para frente
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </section>
  );
};
