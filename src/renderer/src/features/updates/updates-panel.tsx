import { useCallback, useEffect, useState } from 'react';

import type {
  LegislativeUpdateCountsDto,
  LegislativeUpdateDetailDto,
  LegislativeUpdateItemDto,
  UpdateDiffEntryDto,
  UpdateReviewStatusDto,
} from '../../../../shared/ipc/updates.js';

const STATUS_LABELS: Readonly<Record<UpdateReviewStatusDto, string>> = Object.freeze({
  pending: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  superseded: 'Superada',
  error: 'Erro técnico',
});

const CATEGORY_LABELS = Object.freeze({
  unchanged: 'Inalterado',
  amended: 'Alterado',
  included: 'Incluído',
  revoked: 'Revogado',
  renumbered: 'Renumerado',
});

const formatTimestamp = (value: string): string =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );

const Summary = ({ item }: { item: LegislativeUpdateItemDto }): React.JSX.Element => (
  <span className="update-summary">
    {String(item.summary.amended)} alterado(s) · {String(item.summary.included)} incluído(s) ·{' '}
    {String(item.summary.revoked)} revogado(s) · {String(item.summary.renumbered)} renumerado(s)
  </span>
);

const DiffSide = ({
  title,
  side,
}: Readonly<{
  title: string;
  side: UpdateDiffEntryDto['before'];
}>): React.JSX.Element => (
  <article className="update-diff-side">
    <h5>{title}</h5>
    {side === null ? (
      <p className="update-empty-side">Não existe neste lado.</p>
    ) : (
      <>
        <p className="update-path">{side.path.join(' › ')}</p>
        <p>{side.text}</p>
        <code>^{side.blockId}</code>
      </>
    )}
  </article>
);

const DiffEntry = ({ entry }: { entry: UpdateDiffEntryDto }): React.JSX.Element => (
  <li className={`update-diff-entry category-${entry.category}`}>
    <header>
      <strong>{CATEGORY_LABELS[entry.category]}</strong>
      <span>Confiança {entry.confidence}</span>
      {entry.requiresHumanReview ? <em>Revisão obrigatória</em> : null}
    </header>
    <div className="update-diff-columns">
      <DiffSide title="Versão publicada" side={entry.before} />
      <DiffSide title="Texto candidato" side={entry.after} />
    </div>
    {entry.renumberingEvidence === null ? null : (
      <p className="update-renumbering-evidence">Evidência: {entry.renumberingEvidence}</p>
    )}
  </li>
);

const EMPTY_COUNTS: LegislativeUpdateCountsDto = Object.freeze({
  pending: 0,
  approved: 0,
  rejected: 0,
  superseded: 0,
  error: 0,
  actionable: 0,
});

export const UpdatesPanel = (): React.JSX.Element => {
  const [items, setItems] = useState<readonly LegislativeUpdateItemDto[]>([]);
  const [counts, setCounts] = useState<LegislativeUpdateCountsDto>(EMPTY_COUNTS);
  const [detail, setDetail] = useState<LegislativeUpdateDetailDto | null>(null);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    const [list, totals] = await Promise.all([
      api.updates.list({ updateReviewStatus: null, cursor: null, limit: 100 }),
      api.updates.getCounts({}),
    ]);
    if (list.ok && totals.ok) {
      setItems(list.value.items);
      setCounts(totals.value);
      setUnavailable(false);
    } else setUnavailable(true);
  }, []);

  useEffect(() => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    let active = true;
    void Promise.all([
      api.updates.list({ updateReviewStatus: null, cursor: null, limit: 100 }),
      api.updates.getCounts({}),
    ]).then(([list, totals]) => {
      if (!active) return;
      if (list.ok && totals.ok) {
        setItems(list.value.items);
        setCounts(totals.value);
        setUnavailable(false);
      } else setUnavailable(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const openDetail = useCallback(async (updateId: string): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await api.updates.getDetail({ updateId });
    setBusy(false);
    if (result.ok) {
      setDetail(result.value);
      setAcknowledged(false);
      setReason('');
    } else setError(result.error.message);
  }, []);

  const decide = useCallback(
    async (action: 'approve' | 'reject' | 'reprocess'): Promise<void> => {
      const api = window.lexDesktop;
      if (api === undefined || detail === null) return;
      setBusy(true);
      setError(null);
      setMessage(null);
      const result = await (action === 'approve'
        ? api.updates.approve({ updateId: detail.updateId, acknowledged: true })
        : action === 'reject'
          ? api.updates.reject({ updateId: detail.updateId, reason })
          : api.updates.reprocess({ updateId: detail.updateId }));
      setBusy(false);
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setMessage(
        action === 'approve'
          ? 'Atualização aprovada e encaminhada ao fluxo seguro de publicação.'
          : action === 'reject'
            ? 'Atualização rejeitada; o motivo foi preservado na auditoria.'
            : 'Reprocessamento solicitado ao worker.',
      );
      setDetail(null);
      await refresh();
    },
    [detail, reason, refresh],
  );

  return (
    <section className="panel updates-panel" id="atualizacoes" aria-labelledby="updates-title">
      <header className="panel-header">
        <div>
          <p className="eyebrow">Monitoramento oficial</p>
          <h2 id="updates-title">Fila de atualizações</h2>
        </div>
        <span className="update-count" aria-label={`${String(counts.actionable)} itens acionáveis`}>
          {String(counts.actionable)}
        </span>
      </header>
      <div className="panel-content updates-content">
        <div className="update-counts" aria-label="Resumo da fila">
          <span>{String(counts.pending)} pendente(s)</span>
          <span>{String(counts.error)} erro(s)</span>
          <span>{String(counts.approved)} aprovada(s)</span>
        </div>
        {unavailable ? (
          <p className="update-unavailable">
            A fila depende da conexão autenticada com o serviço de atualizações.
          </p>
        ) : null}
        {error === null ? null : (
          <p className="operation-error" role="alert">
            {error}
          </p>
        )}
        {message === null ? null : (
          <p className="operation-success" role="status">
            {message}
          </p>
        )}
        {items.length === 0 ? (
          <div className="updates-empty">
            <h3>Nenhuma atualização na fila</h3>
            <p>As verificações do worker aparecerão aqui sem alterar a versão pública.</p>
          </div>
        ) : (
          <ul className="updates-list">
            {items.map((item) => (
              <li key={item.updateId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void openDetail(item.updateId)}
                >
                  <span>
                    <strong>{item.lawTitle}</strong>
                    <small>
                      {item.lawSigla} · detectada em {formatTimestamp(item.detectedAt)}
                    </small>
                  </span>
                  <Summary item={item} />
                  <span className={`update-status status-${item.updateReviewStatus}`}>
                    {item.reprocessRequested
                      ? 'Reprocessamento solicitado'
                      : STATUS_LABELS[item.updateReviewStatus]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {detail === null ? null : (
          <section className="update-detail" aria-labelledby="update-detail-title">
            <header>
              <div>
                <p className="eyebrow">Comparação por dispositivo</p>
                <h3 id="update-detail-title">{detail.lawTitle}</h3>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDetail(null);
                }}
              >
                Fechar
              </button>
            </header>
            <p className="update-source">Fonte oficial: {detail.sourceUrl}</p>
            {detail.errorCode === null ? null : (
              <p className="operation-error" role="alert">
                Falha técnica: {detail.errorCode}
              </p>
            )}
            {detail.missingPublishedBlockIds.length === 0 ? null : (
              <p className="update-warning">
                {String(detail.missingPublishedBlockIds.length)} dispositivo(s) publicado(s) estão
                ausentes; nenhuma revogação foi inferida automaticamente.
              </p>
            )}
            <ol className="update-diff-list">
              {detail.entries.map((entry, index) => (
                <DiffEntry
                  key={`${entry.affectedBlockId ?? 'new'}:${String(index)}`}
                  entry={entry}
                />
              ))}
            </ol>
            {detail.truncated ? <p>O DTO foi limitado; a aprovação usa o diff integral.</p> : null}
            {detail.updateReviewStatus === 'pending' ? (
              <div className="update-decision">
                <label>
                  Motivo obrigatório para rejeição
                  <textarea
                    value={reason}
                    maxLength={2_000}
                    disabled={busy}
                    onChange={(event) => {
                      setReason(event.currentTarget.value);
                    }}
                  />
                </label>
                <label className="publication-acknowledgement">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={busy}
                    onChange={(event) => {
                      setAcknowledged(event.currentTarget.checked);
                    }}
                  />
                  Confirmo a correspondência entre a versão publicada e a candidata.
                </label>
                <div className="publication-actions">
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 10}
                    onClick={() => void decide('reject')}
                  >
                    Rejeitar com motivo
                  </button>
                  <button
                    type="button"
                    disabled={busy || !acknowledged}
                    onClick={() => void decide('approve')}
                  >
                    Aprovar e preparar publicação
                  </button>
                </div>
              </div>
            ) : null}
            {detail.updateReviewStatus === 'error' || detail.updateReviewStatus === 'rejected' ? (
              <button
                type="button"
                disabled={busy || detail.reprocessRequested}
                onClick={() => void decide('reprocess')}
              >
                {detail.reprocessRequested
                  ? 'Reprocessamento já solicitado'
                  : 'Solicitar reprocessamento'}
              </button>
            ) : null}
          </section>
        )}
      </div>
    </section>
  );
};
