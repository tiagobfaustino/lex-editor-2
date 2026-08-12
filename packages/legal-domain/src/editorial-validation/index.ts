import { z } from 'zod';

import { formatar } from '../formatter/index.js';
import { validarMarkdownCanonico } from '../formatter/validar-canonico.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { identifiedNormaAstSchema } from '../ast/schemas.js';
import { percorrer, validarIdentifiedNormaAst } from '../ast/validate.js';
import type { ProblemaValidacao, SegmentoCaminho } from '../ast/errors.js';
import {
  calculateRevisionHash,
  editorialJournalSchema,
  revisionHashSchema,
  type RevisionHash,
  type RevisionHashFunction,
} from '../editorial-commands/index.js';

const diagnosticCodeSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/u);

export const editorialDiagnosticSeveritySchema = z.enum(['error', 'warning', 'info']);

export const editorialDiagnosticLocationSchema = z.strictObject({
  astPath: z.array(z.union([z.string(), z.int().nonnegative()])).max(128),
  nodeId: z.string().min(1).max(256).nullable(),
  blockId: z.string().min(1).max(240).nullable(),
});

export const editorialValidationDiagnosticSchema = z.strictObject({
  code: diagnosticCodeSchema,
  severity: editorialDiagnosticSeveritySchema,
  message: z.string().min(1).max(2_000),
  blocksApproval: z.boolean(),
  blocksExport: z.boolean(),
  fingerprint: revisionHashSchema,
  confirmed: z.boolean(),
  location: editorialDiagnosticLocationSchema,
});

export const editorialValidationReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  mode: z.enum(['incremental', 'full']),
  revisionHash: revisionHashSchema.nullable(),
  journalSequence: z.int().nonnegative(),
  validatedAt: z.iso.datetime({ offset: true }),
  checkedNodeIds: z.array(z.string().min(1).max(256)).max(100_000),
  diagnostics: z.array(editorialValidationDiagnosticSchema).max(10_000),
  isComplete: z.boolean(),
  blockingCount: z.int().nonnegative(),
  warningCount: z.int().nonnegative(),
  unconfirmedWarningCount: z.int().nonnegative(),
  canApprove: z.boolean(),
});

export const editorialApprovalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  approvalId: z.uuid(),
  revisionHash: revisionHashSchema,
  journalSequence: z.int().nonnegative(),
  localActorId: z.string().trim().min(1).max(160),
  approvedAt: z.iso.datetime({ offset: true }),
});

export type EditorialValidationDiagnostic = z.infer<typeof editorialValidationDiagnosticSchema>;
export type EditorialValidationReport = z.infer<typeof editorialValidationReportSchema>;
export type EditorialApproval = z.infer<typeof editorialApprovalSchema>;

export type RunEditorialValidationOptions = Readonly<{
  mode: 'incremental' | 'full';
  journalSequence: number;
  validatedAt: string;
  sha256: RevisionHashFunction;
  changedNodeIds?: readonly string[];
  renderedMarkdown?: string;
  confirmedWarningFingerprints?: ReadonlySet<string>;
}>;

type NodeRecord = Record<string, unknown>;

type IndexedNode = Readonly<{
  node: NodeRecord;
  path: readonly SegmentoCaminho[];
}>;

const indexNodes = (ast: unknown): ReadonlyMap<string, IndexedNode> => {
  const result = new Map<string, IndexedNode>();
  percorrer(
    ast,
    ({ no, caminho }) => {
      if (typeof no['id'] === 'string' && !result.has(no['id'])) {
        result.set(no['id'], { node: no, path: caminho });
      }
    },
    () => undefined,
  );
  return result;
};

const locationFor = (
  nodeIndex: ReadonlyMap<string, IndexedNode>,
  path: readonly SegmentoCaminho[],
  nodeId?: string,
): EditorialValidationDiagnostic['location'] => {
  const indexed = nodeId === undefined ? undefined : nodeIndex.get(nodeId);
  const blockId = indexed?.node['blockId'];
  return {
    astPath: [...path],
    nodeId: nodeId ?? null,
    blockId: typeof blockId === 'string' ? blockId : null,
  };
};

const makeDiagnostic = (
  input: Omit<EditorialValidationDiagnostic, 'fingerprint' | 'confirmed'>,
  revisionHash: RevisionHash | null,
  confirmedWarnings: ReadonlySet<string>,
  sha256: RevisionHashFunction,
): EditorialValidationDiagnostic => {
  const fingerprint = revisionHashSchema.parse(
    sha256(
      JSON.stringify({
        revisionHash,
        code: input.code,
        severity: input.severity,
        location: input.location,
        message: input.message,
      }),
    ),
  );
  return {
    ...input,
    fingerprint,
    confirmed: input.severity === 'warning' && confirmedWarnings.has(fingerprint),
  };
};

const fromValidationProblem = (
  problem: ProblemaValidacao,
  nodeIndex: ReadonlyMap<string, IndexedNode>,
  revisionHash: RevisionHash | null,
  confirmedWarnings: ReadonlySet<string>,
  sha256: RevisionHashFunction,
): EditorialValidationDiagnostic =>
  makeDiagnostic(
    {
      code: problem.codigo,
      severity: 'error',
      message: problem.mensagem,
      blocksApproval: true,
      blocksExport: true,
      location: locationFor(nodeIndex, problem.caminho, problem.noId),
    },
    revisionHash,
    confirmedWarnings,
    sha256,
  );

const humanReviewDiagnostics = (
  nodeIndex: ReadonlyMap<string, IndexedNode>,
  nodeIds: ReadonlySet<string> | null,
  revisionHash: RevisionHash,
  confirmedWarnings: ReadonlySet<string>,
  sha256: RevisionHashFunction,
): readonly EditorialValidationDiagnostic[] => {
  const diagnostics: EditorialValidationDiagnostic[] = [];
  for (const [nodeId, indexed] of nodeIndex) {
    if (nodeIds !== null && !nodeIds.has(nodeId)) continue;
    const evidence = indexed.node['parseEvidence'];
    if (
      typeof evidence === 'object' &&
      evidence !== null &&
      (evidence as NodeRecord)['confidence'] === 'low' &&
      (evidence as NodeRecord)['requiresHumanReview'] === true
    ) {
      diagnostics.push(
        makeDiagnostic(
          {
            code: 'human_review_required',
            severity: 'error',
            message: 'A interpretação de baixa confiança exige decisão editorial explícita.',
            blocksApproval: true,
            blocksExport: true,
            location: locationFor(nodeIndex, indexed.path, nodeId),
          },
          revisionHash,
          confirmedWarnings,
          sha256,
        ),
      );
    }
  }
  return diagnostics;
};

const articleNumber = (node: NodeRecord): number | null => {
  if (node['tipo'] !== 'artigo' || typeof node['numero'] !== 'string') return null;
  const matched = /^\d+/u.exec(node['numero']);
  return matched === null ? null : Number(matched[0]);
};

const articleNumbersBelow = (node: NodeRecord): readonly number[] => {
  const result: number[] = [];
  percorrer(
    node,
    ({ no }) => {
      if (no === node) return;
      const number = articleNumber(no);
      if (number !== null) result.push(number);
    },
    () => undefined,
  );
  return result;
};

const divisionRangeDiagnostics = (
  nodeIndex: ReadonlyMap<string, IndexedNode>,
  revisionHash: RevisionHash,
  confirmedWarnings: ReadonlySet<string>,
  sha256: RevisionHashFunction,
): readonly EditorialValidationDiagnostic[] => {
  const diagnostics: EditorialValidationDiagnostic[] = [];
  for (const [nodeId, indexed] of nodeIndex) {
    if (typeof indexed.node['titulo'] !== 'string' || indexed.node['tipo'] === 'lei') continue;
    const range = /\b(?:arts?\.?|artigos?)\s+(\d+)\s+(?:a|ao)\s+(\d+)\b/iu.exec(
      indexed.node['titulo'],
    );
    if (range === null) continue;
    const expectedStart = Number(range[1]);
    const expectedEnd = Number(range[2]);
    const actual = articleNumbersBelow(indexed.node);
    if (
      actual.length === 0 ||
      Math.min(...actual) !== expectedStart ||
      Math.max(...actual) !== expectedEnd
    ) {
      diagnostics.push(
        makeDiagnostic(
          {
            code: 'division_article_range',
            severity: 'warning',
            message: `O intervalo declarado (${String(expectedStart)}–${String(expectedEnd)}) não corresponde aos artigos aninhados.`,
            blocksApproval: false,
            blocksExport: false,
            location: locationFor(nodeIndex, indexed.path, nodeId),
          },
          revisionHash,
          confirmedWarnings,
          sha256,
        ),
      );
    }
  }
  return diagnostics;
};

const markdownDiagnostics = (
  ast: IdentifiedNormaAST,
  renderedMarkdown: string | undefined,
  nodeIndex: ReadonlyMap<string, IndexedNode>,
  revisionHash: RevisionHash,
  confirmedWarnings: ReadonlySet<string>,
  sha256: RevisionHashFunction,
): readonly EditorialValidationDiagnostic[] => {
  const formatted = renderedMarkdown === undefined ? formatar(ast) : undefined;
  if (formatted !== undefined && !formatted.ok) {
    return formatted.problemas.map((problem) =>
      fromValidationProblem(problem, nodeIndex, revisionHash, confirmedWarnings, sha256),
    );
  }
  const markdown = renderedMarkdown ?? (formatted?.ok === true ? formatted.valor : '');
  return validarMarkdownCanonico(markdown, ast).map((problem) =>
    fromValidationProblem(problem, nodeIndex, revisionHash, confirmedWarnings, sha256),
  );
};

export const collectConfirmedWarningFingerprints = (
  rawJournal: unknown,
  revisionHash: RevisionHash,
): ReadonlySet<string> => {
  const journal = editorialJournalSchema.parse(rawJournal);
  return new Set(
    journal.entries.flatMap(({ command }) =>
      command.expectedRevisionHash === revisionHash && command.operation.kind === 'confirm_warning'
        ? [command.operation.warningFingerprint]
        : [],
    ),
  );
};

export const runEditorialValidation = (
  rawAst: unknown,
  options: RunEditorialValidationOptions,
): EditorialValidationReport => {
  const parsed = identifiedNormaAstSchema.safeParse(rawAst);
  const nodeIndex = indexNodes(rawAst);
  const confirmedWarnings = options.confirmedWarningFingerprints ?? new Set<string>();
  let revisionHash: RevisionHash | null = null;
  const diagnostics: EditorialValidationDiagnostic[] = [];

  if (!parsed.success) {
    const validation = validarIdentifiedNormaAst(rawAst);
    if (!validation.ok) {
      diagnostics.push(
        ...validation.problemas.map((problem) =>
          fromValidationProblem(problem, nodeIndex, null, confirmedWarnings, options.sha256),
        ),
      );
    }
  } else {
    revisionHash = calculateRevisionHash(parsed.data, options.sha256);
    if (options.mode === 'full') {
      const structural = validarIdentifiedNormaAst(parsed.data);
      if (!structural.ok) {
        diagnostics.push(
          ...structural.problemas.map((problem) =>
            fromValidationProblem(
              problem,
              nodeIndex,
              revisionHash,
              confirmedWarnings,
              options.sha256,
            ),
          ),
        );
      }
      diagnostics.push(
        ...humanReviewDiagnostics(nodeIndex, null, revisionHash, confirmedWarnings, options.sha256),
        ...divisionRangeDiagnostics(nodeIndex, revisionHash, confirmedWarnings, options.sha256),
        ...markdownDiagnostics(
          parsed.data,
          options.renderedMarkdown,
          nodeIndex,
          revisionHash,
          confirmedWarnings,
          options.sha256,
        ),
      );
    } else {
      const changedNodeIds = new Set(options.changedNodeIds ?? []);
      diagnostics.push(
        ...humanReviewDiagnostics(
          nodeIndex,
          changedNodeIds,
          revisionHash,
          confirmedWarnings,
          options.sha256,
        ),
      );
    }
  }

  const unique = [...new Map(diagnostics.map((item) => [item.fingerprint, item])).values()];
  const blockingCount = unique.filter((item) => item.blocksApproval).length;
  const warningCount = unique.filter((item) => item.severity === 'warning').length;
  const unconfirmedWarningCount = unique.filter(
    (item) => item.severity === 'warning' && !item.confirmed,
  ).length;
  const isComplete = options.mode === 'full';
  return editorialValidationReportSchema.parse({
    schemaVersion: 1,
    mode: options.mode,
    revisionHash,
    journalSequence: options.journalSequence,
    validatedAt: options.validatedAt,
    checkedNodeIds:
      options.mode === 'full' ? [...nodeIndex.keys()] : [...new Set(options.changedNodeIds ?? [])],
    diagnostics: unique,
    isComplete,
    blockingCount,
    warningCount,
    unconfirmedWarningCount,
    canApprove:
      isComplete && revisionHash !== null && blockingCount === 0 && unconfirmedWarningCount === 0,
  });
};

export type ApproveEditorialRevisionResult =
  | Readonly<{ ok: true; approval: EditorialApproval }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        code:
          | 'validation_incomplete'
          | 'invalid_revision'
          | 'blocking_diagnostics'
          | 'unconfirmed_warnings';
        message: string;
      }>;
    }>;

export const approveEditorialRevision = (
  rawReport: unknown,
  approvalId: string,
  localActorId: string,
  approvedAt: string,
): ApproveEditorialRevisionResult => {
  const report = editorialValidationReportSchema.parse(rawReport);
  if (!report.isComplete) {
    return {
      ok: false,
      error: { code: 'validation_incomplete', message: 'Execute a validação completa antes.' },
    };
  }
  if (report.revisionHash === null) {
    return {
      ok: false,
      error: { code: 'invalid_revision', message: 'A revisão atual não possui hash válido.' },
    };
  }
  if (report.blockingCount > 0) {
    return {
      ok: false,
      error: { code: 'blocking_diagnostics', message: 'Existem erros bloqueantes pendentes.' },
    };
  }
  if (report.unconfirmedWarningCount > 0) {
    return {
      ok: false,
      error: { code: 'unconfirmed_warnings', message: 'Confirme todos os avisos pendentes.' },
    };
  }
  return {
    ok: true,
    approval: editorialApprovalSchema.parse({
      schemaVersion: 1,
      approvalId,
      revisionHash: report.revisionHash,
      journalSequence: report.journalSequence,
      localActorId,
      approvedAt,
    }),
  };
};

export const isEditorialApprovalCurrent = (
  rawApproval: unknown,
  revisionHash: RevisionHash,
  journalSequence: number,
): boolean => {
  const approval = editorialApprovalSchema.safeParse(rawApproval);
  return (
    approval.success &&
    approval.data.revisionHash === revisionHash &&
    approval.data.journalSequence === journalSequence
  );
};
