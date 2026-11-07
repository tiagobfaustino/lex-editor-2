import { useEffect, useRef, useState } from 'react';
import type {
  LocalLawPageDto,
  LocalLawSummaryDto,
  LocalSourceCheckDto,
} from '../../../../shared/ipc/library.js';

const dates = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const variants = { compiled: 'Compilada', annotated: 'Anotada', other: 'Arquivo local' } as const;
type Props = Readonly<{
  active: boolean;
  revisionHash: string | null;
  onOpen(projectId: string): Promise<string | null>;
  onDeleted(projectId: string): void;
}>;

export const LibraryPanel = ({
  active,
  revisionHash,
  onOpen,
  onDeleted,
}: Props): React.JSX.Element => {
  const [draftQuery, setDraftQuery] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState<LocalLawPageDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [sourceCheck, setSourceCheck] = useState<LocalSourceCheckDto | null>(null);
  const busy =
    openingId !== null || checkingId !== null || exportingId !== null || applying || deleting;
  const [deleteTarget, setDeleteTarget] = useState<LocalLawSummaryDto | null>(null);
  const focusAfterDelete = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (deleteTarget === null && focusAfterDelete.current) {
      globalThis.document.getElementById('library-title')?.focus();
      focusAfterDelete.current = false;
    }
  }, [deleteTarget]);
  useEffect(() => {
    if (!active) return;
    const request = new AbortController();
    const api = window.lexDesktop;
    if (api === undefined) return;
    // A lista vem do diário durável; não depende de estado de uma sessão anterior.
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.library.list({ query, offset, limit: 25 });
        if (request.signal.aborted) return;
        if (result.ok) setPage(result.value);
        else {
          setPage(null);
          setError(result.error.message);
        }
      } catch {
        if (!request.signal.aborted) {
          setPage(null);
          setError('Não foi possível carregar as leis salvas.');
        }
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      request.abort();
    };
  }, [active, revisionHash, query, offset, reload]);

  const open = async (projectId: string): Promise<void> => {
    setOpeningId(projectId);
    setError(null);
    try {
      setError(await onOpen(projectId));
    } catch {
      setError('Não foi possível abrir esta importação. Sua revisão atual foi preservada.');
    } finally {
      setOpeningId(null);
    }
  };

  const remove = async (): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined || deleteTarget === null) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await api.library.delete({ projectId: deleteTarget.projectId });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      onDeleted(result.value.projectId);
      focusAfterDelete.current = true;
      setDeleteTarget(null);
      setNotice('Lei excluída da biblioteca local.');
      setOffset(0);
      setReload((value) => value + 1);
    } catch {
      setError('Não foi possível excluir a lei. Tente novamente.');
    } finally {
      setDeleting(false);
    }
  };

  const checkSource = async (projectId: string): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    setCheckingId(projectId);
    setError(null);
    setNotice(null);
    try {
      const result = await api.library.checkSource({ projectId });
      if (result.ok) setSourceCheck(result.value);
      else setError(result.error.message);
    } catch {
      setError('Não foi possível verificar a fonte. A lei salva foi preservada.');
    } finally {
      setCheckingId(null);
    }
  };

  const applySource = async (reason: string, overwriteConflicts: boolean): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined || sourceCheck === null) return;
    setApplying(true);
    setError(null);
    try {
      const result = await api.library.applySourceUpdate({
        projectId: sourceCheck.projectId,
        checkId: sourceCheck.checkId,
        expectedRevisionHash: sourceCheck.expectedRevisionHash,
        acknowledged: true,
        overwriteConflicts,
        reason,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      const projectId = sourceCheck.projectId;
      setSourceCheck(null);
      setReload((value) => value + 1);
      setNotice(
        'Lei atualizada. Na aba Edição, valide a revisão e aprove o preview antes de exportar.',
      );
      setError(await onOpen(projectId));
    } catch {
      setError(
        'Não foi possível concluir a atualização. Reabra a lei para conferir a revisão salva.',
      );
    } finally {
      setApplying(false);
    }
  };

  const exportLaw = async (projectId: string): Promise<void> => {
    const api = window.lexDesktop;
    if (api === undefined) return;
    setExportingId(projectId);
    setError(null);
    setNotice(null);
    const approvalHint =
      ' Abra a lei na aba Edição, valide a revisão e aprove o preview antes de exportar.';
    try {
      const destination = await api.export.chooseBatchDestination({ projectIds: [projectId] });
      if (!destination.ok) {
        setError(destination.error.message + approvalHint);
        return;
      }
      if (destination.value === null) return;
      const result = await api.export.writeBatch({
        destinationId: destination.value.destinationId,
      });
      if (!result.ok) {
        setError(result.error.message + approvalHint);
        return;
      }
      const item = result.value.results[0];
      if (item === undefined || item.batchExportStatus === 'failed') {
        setError('Não foi possível exportar o pacote.' + approvalHint);
        return;
      }
      setNotice(
        `Pacote exportado em ${item.directoryName}: ${item.markdownFileName}, ${item.updateFileName}${item.changeReportFileName === undefined ? '' : ` e ${item.changeReportFileName}`}. Pronto para envio posterior ao Vinculex.`,
      );
    } catch {
      setError('Não foi possível exportar o pacote. Tente novamente.');
    } finally {
      setExportingId(null);
    }
  };

  return (
    <section
      className="panel library-panel"
      id="minhas-leis"
      aria-labelledby="library-title"
      aria-busy={loading || busy}
    >
      <header className="panel-header">
        <div>
          <p className="eyebrow">Biblioteca local</p>
          <h2 id="library-title" tabIndex={-1}>
            Minhas leis
          </h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={loading || busy}
          onClick={() => {
            setReload((value) => value + 1);
          }}
        >
          Atualizar lista
        </button>
      </header>
      <div className="panel-content">
        <p className="panel-description">
          Consulte as leis salvas, confira alterações na fonte e exporte a lei integral com o
          relatório local.
        </p>
        <form
          className="library-search"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(draftQuery.trim());
            setOffset(0);
            setReload((value) => value + 1);
          }}
        >
          <label htmlFor="library-search">Buscar por título ou sigla</label>
          <div>
            <input
              id="library-search"
              type="search"
              value={draftQuery}
              maxLength={160}
              onChange={(event) => {
                setDraftQuery(event.currentTarget.value);
              }}
            />
            <button type="submit" disabled={loading || busy}>
              Buscar
            </button>
          </div>
        </form>
        {notice === null ? null : <p role="status">{notice}</p>}
        {deleteTarget === null ? null : (
          <DeleteConfirmation
            law={deleteTarget}
            busy={deleting}
            error={error}
            onCancel={() => {
              setDeleteTarget(null);
              setError(null);
            }}
            onConfirm={() => void remove()}
          />
        )}
        {sourceCheck === null ? null : (
          <SourceReview
            check={sourceCheck}
            busy={applying}
            error={error}
            onCancel={() => {
              setSourceCheck(null);
              setError(null);
            }}
            onConfirm={(reason, overwriteConflicts) => void applySource(reason, overwriteConflicts)}
          />
        )}
        {error === null || deleteTarget !== null || sourceCheck !== null ? null : (
          <p role="alert" className="library-error">
            {error}
          </p>
        )}
        <p role="status" aria-live="polite">
          {loading
            ? 'Carregando leis salvas…'
            : page === null
              ? 'A lista ainda não está disponível.'
              : `${String(page.totalItems)} importação(ões) encontrada(s).`}
        </p>
        {!loading && page?.items.length === 0 ? (
          <div className="library-empty">
            <h3>{query ? 'Nenhuma lei encontrada' : 'Sua biblioteca está vazia'}</h3>
            <p>
              {query
                ? 'Tente outro título ou sigla.'
                : 'Importe e processe uma lei na aba Edição para adicioná-la aqui.'}
            </p>
          </div>
        ) : null}
        {page === null || loading ? null : (
          <ul className="library-list">
            {page.items.map((law) => (
              <li key={law.projectId} className="library-card">
                <div>
                  <h3>{law.title}</h3>
                  {law.recoveryState === 'ready' ? (
                    <>
                      <p className="library-identity">
                        {law.sigla} · {law.lawType} nº {law.number}/{String(law.year)} ·{' '}
                        {String(law.totalArticles)} artigos
                      </p>
                      <p>
                        <span className="library-variant">{variants[law.sourceVariant]}</span> ·
                        Formatada · {String(law.journalSequence)} alteração(ões) salva(s)
                      </p>
                      <dl className="library-dates">
                        <div>
                          <dt>Importada</dt>
                          <dd>{dates.format(new Date(law.importedAt))}</dd>
                        </div>
                        <div>
                          <dt>Última edição</dt>
                          <dd>{dates.format(new Date(law.updatedAt))}</dd>
                        </div>
                      </dl>
                      <p className="library-source" title={law.sourceUrl}>
                        {law.sourceUrl}
                      </p>
                      <small>Importação {law.projectId.slice(0, 8)}</small>
                    </>
                  ) : (
                    <p>
                      O diário desta importação está ausente ou inválido. Os arquivos foram
                      preservados.
                    </p>
                  )}
                </div>
                <div className="library-card-actions">
                  <button
                    type="button"
                    disabled={busy || law.recoveryState !== 'ready'}
                    aria-label={`Abrir ${law.title}, importação ${law.projectId.slice(0, 8)}`}
                    onClick={() => void open(law.projectId)}
                  >
                    {openingId === law.projectId ? 'Abrindo…' : 'Abrir'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || law.recoveryState !== 'ready'}
                    id={`library-check-${law.projectId}`}
                    aria-label={`Verificar alterações de ${law.title}`}
                    onClick={() => void checkSource(law.projectId)}
                  >
                    {checkingId === law.projectId ? 'Verificando…' : 'Verificar alterações'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy || law.recoveryState !== 'ready'}
                    aria-label={`Exportar lei e relatório de ${law.title}`}
                    onClick={() => void exportLaw(law.projectId)}
                  >
                    {exportingId === law.projectId ? 'Exportando…' : 'Exportar lei e relatório'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button danger-button"
                    disabled={busy}
                    aria-label={`Excluir ${law.title}, importação ${law.projectId.slice(0, 8)}`}
                    onClick={() => {
                      setError(null);
                      setNotice(null);
                      setDeleteTarget(law);
                    }}
                  >
                    Excluir
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {page === null ? null : (
          <nav className="library-pagination" aria-label="Páginas de leis salvas">
            <button
              type="button"
              className="secondary-button"
              disabled={loading || busy || offset === 0}
              onClick={() => {
                setOffset(Math.max(0, offset - 25));
              }}
            >
              Anterior
            </button>
            <span>Página {String(Math.floor(offset / 25) + 1)}</span>
            <button
              type="button"
              className="secondary-button"
              disabled={loading || busy || page.nextOffset === null}
              onClick={() => {
                if (page.nextOffset !== null) setOffset(page.nextOffset);
              }}
            >
              Próxima
            </button>
          </nav>
        )}
      </div>
    </section>
  );
};

const DeleteConfirmation = ({
  law,
  busy,
  error,
  onCancel,
  onConfirm,
}: Readonly<{
  law: LocalLawSummaryDto;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(): void;
}>): React.JSX.Element => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previousFocus = globalThis.document.activeElement;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="metadata-confirmation-dialog"
      aria-labelledby="delete-law-title"
      aria-describedby="delete-law-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id="delete-law-title">Excluir esta lei?</h3>
      <p id="delete-law-description">
        <strong>{law.title}</strong> será removida da biblioteca local, com suas alterações salvas.
        Para voltar a editá-la, será necessário importar novamente. Publicações e arquivos
        exportados permanecem disponíveis.
      </p>
      <p>Os snapshots e registros internos de auditoria serão preservados.</p>
      {error === null ? null : <p role="alert">{error}</p>}
      <div className="metadata-dialog-actions">
        <button type="button" ref={cancelRef} disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" disabled={busy} onClick={onConfirm}>
          {busy ? 'Excluindo…' : 'Confirmar exclusão'}
        </button>
      </div>
    </dialog>
  );
};

const changeLabels = {
  unchanged: 'Sem alteração',
  amended: 'Redação alterada',
  included: 'Incluído',
  revoked: 'Revogado',
  renumbered: 'Renumerado',
} as const;

const SourceReview = ({
  check,
  busy,
  error,
  onCancel,
  onConfirm,
}: Readonly<{
  check: LocalSourceCheckDto;
  busy: boolean;
  error: string | null;
  onCancel(): void;
  onConfirm(reason: string, overwriteConflicts: boolean): void;
}>): React.JSX.Element => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [overwriteConflicts, setOverwriteConflicts] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const previousFocus = globalThis.document.getElementById(`library-check-${check.projectId}`);
    dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [check.projectId]);
  return (
    <dialog
      ref={dialogRef}
      className="metadata-confirmation-dialog source-review-dialog"
      aria-labelledby="source-review-title"
      aria-describedby="source-review-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h3 id="source-review-title">Conferência da fonte</h3>
      <p id="source-review-description">
        {check.hasChanges
          ? 'Revise os dispositivos antes de atualizar a lei salva.'
          : 'Nenhuma alteração jurídica encontrada na fonte.'}
      </p>
      <p>Conferida em {dates.format(new Date(check.checkedAt))}</p>
      <p className="library-source">{check.sourceUrl}</p>
      {check.missingBlockIds.length === 0 ? null : (
        <p role="status">
          Dispositivos ausentes na fonte serão preservados e exigirão revisão editorial:{' '}
          {check.missingBlockIds.join(', ')}. Ausência não significa revogação.
        </p>
      )}
      {check.conflictingBlockIds.length === 0 ? null : (
        <p role="status">
          A fonte diverge de correções locais nestes dispositivos:{' '}
          {check.conflictingBlockIds.join(', ')}.
        </p>
      )}
      {check.entries
        .filter((entry) => entry.category !== 'unchanged')
        .map((entry, index) => (
          <article
            className="source-review-entry"
            key={`${entry.affectedBlockId ?? 'entry'}-${String(index)}`}
          >
            <h4>
              {check.missingBlockIds.includes(entry.affectedBlockId ?? '')
                ? 'Ausente na fonte; preservado'
                : changeLabels[entry.category]}{' '}
              · {entry.affectedBlockId}
            </h4>
            <div className="source-review-sides">
              <div>
                <h5>Versão local</h5>
                <p>{entry.before?.path.join(' / ')}</p>
                <pre>{entry.before?.text ?? 'Dispositivo inexistente na fonte anterior.'}</pre>
              </div>
              <div>
                <h5>Fonte consultada</h5>
                <p>{entry.after?.path.join(' / ')}</p>
                <pre>{entry.after?.text ?? 'Sem redação na fonte consultada.'}</pre>
              </div>
            </div>
          </article>
        ))}
      {check.hasChanges ? (
        <>
          <label className="source-review-choice">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(event) => {
                setAcknowledged(event.currentTarget.checked);
              }}
            />
            Conferi as alterações e os avisos de dispositivos ausentes.
          </label>
          {check.conflictingBlockIds.length === 0 ? null : (
            <label className="source-review-choice">
              <input
                type="checkbox"
                checked={overwriteConflicts}
                disabled={busy}
                onChange={(event) => {
                  setOverwriteConflicts(event.currentTarget.checked);
                }}
              />
              Aceito substituir as correções locais conflitantes pela fonte consultada, preservando
              a redação anterior no histórico.
            </label>
          )}
          <label htmlFor="source-update-reason">Motivo da atualização</label>
          <textarea
            id="source-update-reason"
            value={reason}
            maxLength={500}
            disabled={busy}
            onChange={(event) => {
              setReason(event.currentTarget.value);
            }}
          />
          <p>
            A atualização mantém o histórico e exige nova validação e aprovação antes da exportação.
          </p>
          {check.canApply ? null : (
            <p role="alert">
              Esta proposta não pode ser aplicada. Faça uma nova conferência ou revise a lei na aba
              Edição.
            </p>
          )}
        </>
      ) : null}
      {error === null ? null : <p role="alert">{error}</p>}
      <div className="metadata-dialog-actions">
        <button type="button" ref={cancelRef} disabled={busy} onClick={onCancel}>
          {check.hasChanges ? 'Cancelar' : 'Fechar'}
        </button>
        {check.hasChanges ? (
          <button
            type="button"
            disabled={
              busy ||
              !check.canApply ||
              !acknowledged ||
              reason.trim().length === 0 ||
              (check.conflictingBlockIds.length > 0 && !overwriteConflicts)
            }
            onClick={() => {
              onConfirm(reason.trim(), overwriteConflicts);
            }}
          >
            {busy ? 'Atualizando…' : 'Confirmar atualização'}
          </button>
        ) : null}
      </div>
    </dialog>
  );
};
