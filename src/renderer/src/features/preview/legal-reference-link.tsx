import { useRef, useState } from 'react';

import type {
  LegalReferencePreviewDto,
  PreviewLegalReferenceDto,
} from '../../../../shared/ipc/import.js';

type PreviewState =
  | Readonly<{ kind: 'idle' | 'loading' }>
  | Readonly<{ kind: 'ready'; preview: LegalReferencePreviewDto }>
  | Readonly<{ kind: 'error' }>;

const legalReferenceElementId = (previewNodeId: string, referenceId: string): string =>
  `legal-reference-${previewNodeId}-${referenceId}`;

type LegalReferenceLinkProps = Readonly<{
  projectId: string;
  previewNodeId: string;
  reference: PreviewLegalReferenceDto;
  onNavigate(referenceId: string, originPreviewNodeId: string, originElementId: string): void;
}>;

export const LegalReferenceLink = ({
  projectId,
  previewNodeId,
  reference,
  onNavigate,
}: LegalReferenceLinkProps): React.JSX.Element => {
  const [open, setOpen] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>({ kind: 'idle' });
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipId = `legal-reference-preview-${reference.referenceId}`;
  const elementId = legalReferenceElementId(previewNodeId, reference.referenceId);

  const openPreview = (): void => {
    setOpen(true);
    if (previewState.kind === 'ready') return;
    if (previewState.kind === 'loading') return;
    const api = window.lexDesktop;
    if (api === undefined) {
      setPreviewState({ kind: 'error' });
      return;
    }
    setPreviewState({ kind: 'loading' });
    void api.preview
      .getLegalReference({ projectId, referenceId: reference.referenceId })
      .then((result) => {
        if (!result.ok) {
          setPreviewState({ kind: 'error' });
          return;
        }
        setPreviewState({ kind: 'ready', preview: result.value });
      });
  };

  const closePreview = (): void => {
    setOpen(false);
  };

  return (
    <span
      className="legal-reference"
      ref={wrapperRef}
      onMouseEnter={openPreview}
      onMouseLeave={closePreview}
      onFocus={openPreview}
      onBlur={(event) => {
        if (!wrapperRef.current?.contains(event.relatedTarget)) closePreview();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          closePreview();
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        id={elementId}
        ref={buttonRef}
        className="legal-reference-link"
        type="button"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={() => {
          closePreview();
          onNavigate(reference.referenceId, previewNodeId, elementId);
        }}
      >
        {reference.label}
      </button>
      {open && (
        <span className="legal-reference-popover" id={tooltipId} role="tooltip">
          {previewState.kind === 'ready' ? (
            <>
              <span className="legal-reference-popover-header">
                <strong>{previewState.preview.targetTitle}</strong>
                <small>{previewState.preview.external ? 'Outra lei' : 'Nesta lei'}</small>
              </span>
              <span className="legal-reference-path">
                {previewState.preview.targetLegalPath}
                {previewState.preview.targetDeviceStatus === null
                  ? ''
                  : ` · ${previewState.preview.targetDeviceStatus}`}
              </span>
              <span className="legal-reference-text">{previewState.preview.targetPlainText}</span>
            </>
          ) : previewState.kind === 'error' ? (
            <span>Não foi possível carregar este trecho.</span>
          ) : (
            <span>Carregando trecho…</span>
          )}
        </span>
      )}
    </span>
  );
};

type LegalReferenceTextProps = Readonly<{
  projectId: string;
  node: Readonly<{
    previewNodeId: string;
    plainText: string;
    legalReferences: readonly PreviewLegalReferenceDto[];
  }>;
  onNavigate(referenceId: string, originPreviewNodeId: string, originElementId: string): void;
}>;

export const LegalReferenceText = ({
  projectId,
  node,
  onNavigate,
}: LegalReferenceTextProps): React.JSX.Element => {
  const references = [...node.legalReferences].sort((left, right) => left.start - right.start);
  const segments: React.ReactNode[] = [];
  let offset = 0;
  for (const reference of references) {
    if (reference.start < offset || reference.end > node.plainText.length) continue;
    if (reference.start > offset) segments.push(node.plainText.slice(offset, reference.start));
    segments.push(
      reference.state === 'resolved' ? (
        <LegalReferenceLink
          key={reference.referenceId}
          projectId={projectId}
          previewNodeId={node.previewNodeId}
          reference={reference}
          onNavigate={onNavigate}
        />
      ) : (
        <span
          className={`legal-reference-unavailable severity-${reference.severity}`}
          key={reference.referenceId}
          title={
            reference.state === 'ambiguous'
              ? 'Referência com mais de um destino possível'
              : 'Lei ou dispositivo ainda não disponível'
          }
        >
          {reference.label}
        </span>
      ),
    );
    offset = reference.end;
  }
  if (offset < node.plainText.length) segments.push(node.plainText.slice(offset));
  return <>{segments}</>;
};
