import { z } from 'zod';

import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema } from '../ast/schemas.js';
import { formatar } from '../formatter/index.js';
import { validarMarkdownCanonico } from '../formatter/validar-canonico.js';
import {
  createLegalNormCatalog,
  createVincuLexLayout,
  detectLegalReferences,
  resolveLegalReferences,
  type LegalNormCatalog,
  type LegalReferenceDecisionSet,
  type LegalReferenceIndex,
  type VincuLexLayout,
} from '../legal-reference/index.js';
import { calculateRevisionHash, type RevisionHashFunction } from './index.js';

const documentIdSchema = z.string().trim().min(1).max(256);
const aliasesSchema = z.array(z.string().trim().min(1).max(500)).max(500);

export interface MetadataWorkspaceDocument {
  readonly documentId: string;
  readonly ast: unknown;
  readonly aliases?: readonly string[];
  readonly referenceDecisions?: LegalReferenceDecisionSet;
}

export interface MetadataWorkspaceContext {
  readonly currentDocumentId: string;
  readonly documents: readonly MetadataWorkspaceDocument[];
}

export interface MetadataDerivedDocument {
  readonly documentId: string;
  readonly ast: IdentifiedNormaAST;
  readonly revisionHash: string;
  readonly referenceIndex: Readonly<LegalReferenceIndex>;
  readonly markdown: Readonly<{
    completeWithHistory: string;
    currentOnly: string;
  }>;
}

export interface MetadataWorkspaceDerivatives {
  readonly catalog: Readonly<LegalNormCatalog>;
  readonly layouts: Readonly<{
    completeWithHistory: Readonly<VincuLexLayout>;
    currentOnly: Readonly<VincuLexLayout>;
  }>;
  readonly documents: readonly MetadataDerivedDocument[];
  readonly invalidatedReferenceDecisionDocumentIds: readonly string[];
}

export type MetadataWorkspaceDerivationResult =
  | Readonly<{ ok: true; value: MetadataWorkspaceDerivatives }>
  | Readonly<{ ok: false; message: string }>;

type ValidatedDocument = Readonly<{
  documentId: string;
  ast: IdentifiedNormaAST;
  aliases: readonly string[];
  referenceDecisions?: LegalReferenceDecisionSet;
}>;

const fail = (message: string): MetadataWorkspaceDerivationResult => ({ ok: false, message });

/**
 * Regenera catálogo, índices, layouts e Markdown a partir de ASTs já
 * identificadas. Nenhum parser ou fonte externa participa desta transação.
 */
export const deriveMetadataWorkspace = (
  currentAstInput: unknown,
  candidateAstInput: unknown,
  context: MetadataWorkspaceContext,
  sha256: RevisionHashFunction,
): MetadataWorkspaceDerivationResult => {
  const currentAst = identifiedNormaAstSchema.safeParse(currentAstInput);
  const candidateAst = identifiedNormaAstSchema.safeParse(candidateAstInput);
  const currentDocumentId = documentIdSchema.safeParse(context.currentDocumentId);
  if (!currentAst.success || !candidateAst.success || !currentDocumentId.success) {
    return fail('A transação de metadados recebeu AST ou documento inválido.');
  }
  if (!Array.isArray(context.documents) || context.documents.length === 0) {
    return fail('O workspace precisa conter ao menos a norma alterada.');
  }
  const rawDocuments = context.documents as readonly MetadataWorkspaceDocument[];

  const seenDocumentIds = new Set<string>();
  const documents: ValidatedDocument[] = [];
  for (const rawDocument of rawDocuments) {
    const documentId = documentIdSchema.safeParse(rawDocument.documentId);
    const ast = identifiedNormaAstSchema.safeParse(rawDocument.ast);
    const aliases = aliasesSchema.safeParse(rawDocument.aliases ?? []);
    if (
      !documentId.success ||
      !ast.success ||
      !aliases.success ||
      seenDocumentIds.has(documentId.data)
    ) {
      return fail('O workspace contém documento, AST, aliases ou ID duplicado inválido.');
    }
    seenDocumentIds.add(documentId.data);
    documents.push({
      documentId: documentId.data,
      ast: ast.data,
      aliases: aliases.data,
      ...(rawDocument.referenceDecisions === undefined
        ? {}
        : { referenceDecisions: rawDocument.referenceDecisions }),
    });
  }

  const currentIndex = documents.findIndex(
    ({ documentId }) => documentId === currentDocumentId.data,
  );
  if (currentIndex < 0) return fail('A norma alterada não existe no workspace informado.');
  try {
    if (
      calculateRevisionHash(documents[currentIndex]?.ast, sha256) !==
      calculateRevisionHash(currentAst.data, sha256)
    ) {
      return fail('A norma corrente do workspace não corresponde à revisão alterada.');
    }
  } catch {
    return fail('Não foi possível validar a revisão corrente do workspace.');
  }

  const currentDocument = documents[currentIndex];
  const invalidatedReferenceDecisionDocumentIds =
    currentDocument?.referenceDecisions === undefined ? [] : [currentDocument.documentId];
  const candidateDocuments = documents.map((document, index) =>
    index === currentIndex
      ? {
          documentId: document.documentId,
          ast: candidateAst.data,
          aliases: document.aliases,
        }
      : document,
  );
  const catalog = createLegalNormCatalog(
    candidateDocuments.map(({ ast, aliases }) => ({ ast, aliases })),
    { sha256 },
  );
  if (!catalog.ok) return fail('A alteração produziria um catálogo jurídico inválido.');

  const completeLayout = createVincuLexLayout(
    catalog.valor,
    candidateDocuments,
    'complete_with_history',
    { sha256 },
  );
  const currentLayout = createVincuLexLayout(catalog.valor, candidateDocuments, 'current_only', {
    sha256,
  });
  if (!completeLayout.ok || !currentLayout.ok) {
    return fail('A alteração produziria um layout VincuLex inválido.');
  }

  const derivedDocuments: MetadataDerivedDocument[] = [];
  for (const document of candidateDocuments) {
    const detected = detectLegalReferences(document.ast, { sha256 });
    if (!detected.ok) return fail('As menções jurídicas não puderam ser reindexadas.');
    const resolved = resolveLegalReferences(
      {
        sourceAst: document.ast,
        index: detected.valor,
        catalog: catalog.valor,
        ...(document.referenceDecisions === undefined
          ? {}
          : { decisions: document.referenceDecisions }),
      },
      { sha256 },
    );
    if (!resolved.ok) return fail('As referências jurídicas não puderam ser re-resolvidas.');
    const completeMarkdown = formatar(document.ast, 'complete_with_history', {
      referenceIndex: resolved.valor,
      layout: completeLayout.valor,
      sha256,
    });
    const currentMarkdown = formatar(document.ast, 'current_only', {
      referenceIndex: resolved.valor,
      layout: currentLayout.valor,
      sha256,
    });
    if (
      !completeMarkdown.ok ||
      !currentMarkdown.ok ||
      validarMarkdownCanonico(completeMarkdown.valor, document.ast, 'complete_with_history', {
        referenceIndex: resolved.valor,
        layout: completeLayout.valor,
        sha256,
      }).length > 0 ||
      validarMarkdownCanonico(currentMarkdown.valor, document.ast, 'current_only', {
        referenceIndex: resolved.valor,
        layout: currentLayout.valor,
        sha256,
      }).length > 0
    ) {
      return fail('A alteração produziria preview ou Markdown canônico inválido.');
    }
    derivedDocuments.push({
      documentId: document.documentId,
      ast: document.ast,
      revisionHash: calculateRevisionHash(document.ast, sha256),
      referenceIndex: resolved.valor,
      markdown: {
        completeWithHistory: completeMarkdown.valor,
        currentOnly: currentMarkdown.valor,
      },
    });
  }

  return {
    ok: true,
    value: {
      catalog: catalog.valor,
      layouts: {
        completeWithHistory: completeLayout.valor,
        currentOnly: currentLayout.valor,
      },
      documents: derivedDocuments,
      invalidatedReferenceDecisionDocumentIds,
    },
  };
};
