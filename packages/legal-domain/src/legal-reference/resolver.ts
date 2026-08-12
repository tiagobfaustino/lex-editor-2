import { z } from 'zod';

import {
  criarProblema,
  falha,
  problemasDoZod,
  type ResultadoValidacao,
  sucesso,
} from '../ast/errors.js';
import type { IdentifiedNormaAST } from '../ast/nodes.js';
import { percorrer, validarIdentifiedNormaAst } from '../ast/validate.js';
import { calculateRevisionHash, type RevisionHashFunction } from '../editorial-commands/index.js';
import {
  createCatalogEntry,
  legalNormCatalogSchema,
  legalNormIdentityKey,
  normalizeLegalNormAlias,
  type LegalNormCatalog,
  type LegalNormCatalogDevice,
  type LegalNormCatalogEntry,
} from './catalog.js';
import {
  legalReferenceIndexSchema,
  type LegalReference,
  type LegalReferenceEvidence,
  type LegalReferenceIndex,
  type LegalReferencePoint,
  type LegalReferenceTarget,
} from './contracts.js';
import { legalReferenceDecisionSetSchema, type LegalReferenceDecision } from './decisions.js';

export interface ResolveLegalReferencesInput {
  readonly sourceAst: unknown;
  readonly index: unknown;
  readonly catalog: unknown;
  readonly decisions?: readonly unknown[];
}

export interface ResolveLegalReferencesOptions {
  readonly sha256: RevisionHashFunction;
}

const sameIdentity = (
  left: LegalReferenceTarget['law'],
  right: LegalReferenceTarget['law'],
): boolean => legalNormIdentityKey(left) === legalNormIdentityKey(right);

const targetKey = (target: LegalReferenceTarget): string =>
  `${legalNormIdentityKey(target.law)}\u0000${target.revisionHash}\u0000${target.blockId}`;

const sourceFieldsByBlockId = (
  ast: IdentifiedNormaAST,
): ReadonlyMap<string, Readonly<Record<string, string>>> => {
  const fields = new Map<string, Readonly<Record<string, string>>>();
  percorrer(
    ast,
    ({ no }) => {
      const blockId = no['blockId'];
      if (typeof blockId !== 'string') return;
      const available: Record<string, string> = {};
      if (typeof no['caput'] === 'string') available['caput'] = no['caput'];
      if (typeof no['texto'] === 'string') available['texto'] = no['texto'];
      fields.set(blockId, available);
    },
    () => undefined,
  );
  return fields;
};

type LegalReferenceTerminalKey = 'artigo' | 'paragrafo' | 'inciso' | 'alinea' | 'item';

const terminalKey = (point: LegalReferencePoint): LegalReferenceTerminalKey => {
  if (point.item !== undefined) return 'item';
  if (point.alinea !== undefined) return 'alinea';
  if (point.inciso !== undefined) return 'inciso';
  if (point.paragrafo !== undefined) return 'paragrafo';
  return 'artigo';
};

const deviceMatches = (device: LegalNormCatalogDevice, point: LegalReferencePoint): boolean => {
  const terminal = terminalKey(point);
  const hierarchy = ['artigo', 'paragrafo', 'inciso', 'alinea', 'item'] as const;
  const terminalIndex = hierarchy.indexOf(terminal);
  if (hierarchy.slice(terminalIndex + 1).some((key) => device.point[key] !== undefined)) {
    return false;
  }
  for (const key of hierarchy) {
    const expected = point[key];
    if (expected !== undefined && device.point[key] !== expected) return false;
  }
  return device.point[terminal] !== undefined;
};

const targetsFor = (
  entry: LegalNormCatalogEntry,
  point: LegalReferencePoint,
): LegalReferenceTarget[] =>
  entry.devices
    .filter((device) => deviceMatches(device, point))
    .map((device) => ({
      law: entry.law,
      revisionHash: entry.revisionHash,
      blockId: device.blockId,
    }));

const unqualifiedMainTextBlockId = (
  entry: LegalNormCatalogEntry,
  point: LegalReferencePoint,
): string | undefined => {
  if (point.artigo === undefined) return undefined;
  const segments = [entry.acronym.trim().toLocaleLowerCase('pt-BR'), `art-${point.artigo}`];
  if (point.paragrafo !== undefined) segments.push(`par-${point.paragrafo}`);
  if (point.inciso !== undefined) segments.push(`inc-${point.inciso.toLocaleLowerCase('pt-BR')}`);
  if (point.alinea !== undefined) segments.push(`ali-${point.alinea}`);
  if (point.item !== undefined) segments.push(`item-${point.item}`);
  return segments.join('-');
};

const sourcePointFor = (
  sourceEntry: LegalNormCatalogEntry,
  sourceBlockId: string,
): LegalReferencePoint | undefined =>
  sourceEntry.devices.find(({ blockId }) => blockId === sourceBlockId)?.point;

const pointWithContext = (
  point: LegalReferencePoint,
  reference: LegalReference,
  sourceEntry: LegalNormCatalogEntry,
): LegalReferencePoint | undefined => {
  if (reference.locator.scope !== 'same_law' || reference.locator.context !== 'same_article') {
    return point;
  }
  if (point.artigo !== undefined) return point;
  const sourcePoint = sourcePointFor(sourceEntry, reference.sourceBlockId);
  return sourcePoint?.artigo === undefined ? undefined : { ...point, artigo: sourcePoint.artigo };
};

const baseOf = (reference: LegalReference) => ({
  referenceId: reference.referenceId,
  sourceBlockId: reference.sourceBlockId,
  sourceField: reference.sourceField,
  span: reference.span,
  locator: reference.locator,
  evidence: reference.evidence,
});

const uniqueEvidence = (
  evidence: readonly LegalReferenceEvidence[],
  added: readonly LegalReferenceEvidence[],
): LegalReferenceEvidence[] => {
  const result: LegalReferenceEvidence[] = [];
  const seen = new Set<string>();
  for (const item of [...evidence, ...added]) {
    const key = JSON.stringify(item);
    if (!seen.has(key)) result.push(item);
    seen.add(key);
  }
  return result;
};

const unresolved = (
  reference: LegalReference,
  reason:
    | 'law_not_imported'
    | 'device_not_found'
    | 'insufficient_context'
    | 'unsupported_locator'
    | 'stale_target',
  evidence: readonly LegalReferenceEvidence[] = [],
): LegalReference => ({
  ...baseOf(reference),
  evidence: uniqueEvidence(reference.evidence, evidence),
  state: 'unresolved',
  severity: reason === 'stale_target' ? 'error' : 'warning',
  reason,
});

const resolveAutomatically = (
  reference: LegalReference,
  sourceEntry: LegalNormCatalogEntry,
  catalog: LegalNormCatalog,
): LegalReference => {
  if (reference.locator.selector.kind !== 'point') {
    return unresolved(reference, 'unsupported_locator');
  }

  const point = pointWithContext(reference.locator.selector.point, reference, sourceEntry);
  if (point === undefined) return unresolved(reference, 'insufficient_context');

  let entries: LegalNormCatalogEntry[];
  let evidence: LegalReferenceEvidence[];
  if (reference.locator.scope === 'same_law') {
    entries = [sourceEntry];
    evidence = [{ kind: 'canonical_identity' }, { kind: 'structural_context' }];
  } else {
    const normalizedAlias = normalizeLegalNormAlias(reference.locator.lawMention);
    entries = catalog.entries.filter(
      (entry) =>
        !sameIdentity(entry.law, sourceEntry.law) &&
        entry.aliases.some((alias) => alias.normalized === normalizedAlias),
    );
    evidence = [{ kind: 'catalog_alias', detail: normalizedAlias }];
    if (entries.length === 0) {
      return unresolved(
        reference,
        reference.state === 'resolved' ? 'stale_target' : 'law_not_imported',
        evidence,
      );
    }
  }

  const candidates = entries.flatMap((entry) => targetsFor(entry, point));
  const uniqueCandidates = [
    ...new Map(candidates.map((target) => [targetKey(target), target])).values(),
  ];
  if (uniqueCandidates.length === 0) {
    return unresolved(
      reference,
      reference.state === 'resolved' ? 'stale_target' : 'device_not_found',
      evidence,
    );
  }
  const mainTextCandidates = uniqueCandidates.filter((target) => {
    const entry = entries.find(
      (candidate) =>
        sameIdentity(candidate.law, target.law) && candidate.revisionHash === target.revisionHash,
    );
    return entry !== undefined && target.blockId === unqualifiedMainTextBlockId(entry, point);
  });
  const effectiveCandidates =
    mainTextCandidates.length === 1 ? mainTextCandidates : uniqueCandidates;
  if (mainTextCandidates.length === 1 && uniqueCandidates.length > 1) {
    evidence = uniqueEvidence(evidence, [{ kind: 'structural_context', detail: 'main_text' }]);
  }
  if (effectiveCandidates.length > 1) {
    const aliasCollision = reference.locator.scope === 'external_law' && entries.length > 1;
    return {
      ...baseOf(reference),
      evidence: uniqueEvidence(reference.evidence, evidence),
      state: 'ambiguous',
      severity: aliasCollision ? 'error' : 'warning',
      reason: aliasCollision ? 'alias_collision' : 'multiple_targets',
      candidates: effectiveCandidates.sort((left, right) =>
        targetKey(left).localeCompare(targetKey(right), 'en'),
      ),
    };
  }

  const target = effectiveCandidates[0];
  if (target === undefined) return unresolved(reference, 'device_not_found', evidence);
  return {
    ...baseOf(reference),
    evidence: uniqueEvidence(reference.evidence, evidence),
    state: 'resolved',
    severity: 'info',
    target,
  };
};

const decisionMatchesReference = (
  decision: LegalReferenceDecision,
  reference: LegalReference,
  sourceRevisionHash: string,
): boolean =>
  decision.sourceRevisionHash === sourceRevisionHash &&
  decision.sourceBlockId === reference.sourceBlockId &&
  decision.sourceField === reference.sourceField &&
  JSON.stringify(decision.sourceSpan) === JSON.stringify(reference.span);

const findTarget = (
  target: LegalReferenceTarget,
  sourceEntry: LegalNormCatalogEntry,
  catalog: LegalNormCatalog,
): LegalReferenceTarget | undefined => {
  const entry = [sourceEntry, ...catalog.entries].find(
    (candidate) =>
      sameIdentity(candidate.law, target.law) && candidate.revisionHash === target.revisionHash,
  );
  return entry?.devices.some(({ blockId }) => blockId === target.blockId) === true
    ? target
    : undefined;
};

const applyDecision = (
  automatic: LegalReference,
  decision: LegalReferenceDecision,
  sourceEntry: LegalNormCatalogEntry,
  catalog: LegalNormCatalog,
): LegalReference => {
  const editorialEvidence: LegalReferenceEvidence = {
    kind: 'editorial_confirmation',
    detail: decision.justification.trim(),
  };
  if (decision.action === 'keep_unlinked') {
    return {
      ...baseOf(automatic),
      evidence: uniqueEvidence(automatic.evidence, [editorialEvidence]),
      state: 'unresolved',
      severity: 'warning',
      reason: 'editorially_unlinked',
    };
  }

  const target = findTarget(decision.target, sourceEntry, catalog);
  if (target === undefined) {
    return {
      ...baseOf(automatic),
      evidence: uniqueEvidence(automatic.evidence, [editorialEvidence]),
      state: 'unresolved',
      severity: 'error',
      reason: 'stale_target',
    };
  }
  return {
    ...baseOf(automatic),
    evidence: uniqueEvidence(automatic.evidence, [editorialEvidence]),
    state: 'resolved',
    severity: 'info',
    target,
  };
};

const compareReferences = (left: LegalReference, right: LegalReference): number =>
  left.sourceBlockId.localeCompare(right.sourceBlockId, 'en') ||
  left.sourceField.localeCompare(right.sourceField, 'en') ||
  left.span.start - right.span.start ||
  left.span.end - right.span.end ||
  left.referenceId.localeCompare(right.referenceId, 'en');

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

/** Recalcula estados e alvos sem reparsear nem modificar a NormaAST de origem. */
export const resolveLegalReferences = (
  input: ResolveLegalReferencesInput,
  options: ResolveLegalReferencesOptions,
): ResultadoValidacao<Readonly<LegalReferenceIndex>> => {
  const sourceValidation = validarIdentifiedNormaAst(input.sourceAst);
  if (!sourceValidation.ok) return sourceValidation;
  const indexValidation = legalReferenceIndexSchema.safeParse(input.index);
  if (!indexValidation.success) return falha(problemasDoZod(indexValidation.error));
  const catalogValidation = legalNormCatalogSchema.safeParse(input.catalog);
  if (!catalogValidation.success) return falha(problemasDoZod(catalogValidation.error));
  const decisionValidation = legalReferenceDecisionSetSchema.safeParse(input.decisions ?? []);
  if (!decisionValidation.success) {
    return falha(
      problemasDoZod(decisionValidation.error).map((problem) => ({
        ...problem,
        codigo: 'decisao_referencia_invalida' as const,
      })),
    );
  }

  let sourceRevisionHash: string;
  try {
    sourceRevisionHash = calculateRevisionHash(sourceValidation.valor, options.sha256);
  } catch {
    return falha([
      criarProblema(
        'schema_invalido',
        ['revisionHash'],
        'Não foi possível calcular um hash SHA-256 válido para a revisão de origem.',
      ),
    ]);
  }
  if (
    sourceRevisionHash !== indexValidation.data.revisionHash ||
    legalNormIdentityKey(indexValidation.data.law) !==
      legalNormIdentityKey({
        tipoNorma: sourceValidation.valor.tipoNorma,
        numero: sourceValidation.valor.numero,
        ano: sourceValidation.valor.ano,
      })
  ) {
    return falha([
      criarProblema(
        'schema_invalido',
        ['index', 'revisionHash'],
        'O índice não pertence à identidade e à revisão da NormaAST de origem.',
      ),
    ]);
  }

  const sourceFields = sourceFieldsByBlockId(sourceValidation.valor);
  for (const [index, reference] of indexValidation.data.references.entries()) {
    const text = sourceFields.get(reference.sourceBlockId)?.[reference.sourceField];
    if (text?.slice(reference.span.start, reference.span.end) !== reference.span.text) {
      return falha([
        criarProblema(
          'schema_invalido',
          ['index', 'references', index, 'span'],
          'A origem ou o trecho literal da referência não existe mais nesta revisão.',
          undefined,
          reference.sourceBlockId,
        ),
      ]);
    }
  }

  const referencesById = new Map(
    indexValidation.data.references.map((reference) => [reference.referenceId, reference]),
  );
  for (const [index, decision] of decisionValidation.data.entries()) {
    const reference = referencesById.get(decision.referenceId);
    if (
      reference === undefined ||
      !decisionMatchesReference(decision, reference, sourceRevisionHash)
    ) {
      return falha([
        criarProblema(
          'decisao_referencia_invalida',
          ['decisions', index],
          'A decisão editorial não corresponde exatamente à menção nesta revisão.',
        ),
      ]);
    }
  }

  try {
    const sourceEntry = createCatalogEntry(sourceValidation.valor, sourceRevisionHash);
    const decisionByReferenceId = new Map(
      decisionValidation.data.map((decision) => [decision.referenceId, decision]),
    );
    const references = indexValidation.data.references
      .map((reference) => {
        const automatic = resolveAutomatically(reference, sourceEntry, catalogValidation.data);
        const decision = decisionByReferenceId.get(reference.referenceId);
        return decision === undefined
          ? automatic
          : applyDecision(automatic, decision, sourceEntry, catalogValidation.data);
      })
      .sort(compareReferences);

    const resolved = legalReferenceIndexSchema.parse({
      ...indexValidation.data,
      references,
    });
    return sucesso(deepFreeze(resolved));
  } catch (error) {
    return falha(
      error instanceof z.ZodError
        ? problemasDoZod(error)
        : [
            criarProblema(
              'schema_invalido',
              ['references'],
              'O resolvedor não conseguiu produzir um índice válido.',
            ),
          ],
    );
  }
};
