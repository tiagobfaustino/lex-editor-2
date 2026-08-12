import { z } from 'zod';

import { tipoNormaSchema } from '../ast/enums.js';
import { revisionHashSchema } from '../editorial-commands/index.js';

const textoObrigatorio = (rotulo: string, maximo: number) =>
  z
    .string()
    .max(maximo)
    .check((ctx) => {
      if (ctx.value.trim().length === 0) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: `${rotulo} não pode ser vazio.`,
        });
      }
    });

const blockIdSchema = z
  .string()
  .max(240)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    'Esperado Block ID canônico, sem "^" e com segmentos minúsculos.',
  );

const numeroDesignadorSchema = textoObrigatorio('O número do designador', 80);
const analyzerVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u,
    'Esperada versão semântica do analisador.',
  );

export const legalReferenceSeveritySchema = z.enum(['error', 'warning', 'info']);
export const legalReferenceStateSchema = z.enum([
  'detected',
  'resolved',
  'unresolved',
  'ambiguous',
]);
export const legalReferenceSourceFieldSchema = z.enum(['caput', 'texto']);

/** Identidade jurídica; nome de arquivo, path e sigla não participam dela. */
export const legalNormIdentitySchema = z.strictObject({
  tipoNorma: tipoNormaSchema,
  numero: textoObrigatorio('O número da norma', 80),
  ano: z.int().min(1000).max(9999),
});

/**
 * Offsets usam unidades UTF-16, como String#slice no JavaScript. O trecho
 * literal torna o intervalo autoconsistente antes de compará-lo à NormaAST.
 */
export const legalReferenceSpanSchema = z
  .strictObject({
    encoding: z.literal('utf16'),
    start: z.int().nonnegative(),
    end: z.int().positive(),
    text: textoObrigatorio('O trecho literal da menção', 10_000),
  })
  .superRefine((span, ctx) => {
    if (span.end <= span.start) {
      ctx.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'O fim do span deve ser maior que o início.',
      });
    }
    if (span.text.length !== span.end - span.start) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: 'O trecho literal deve ocupar exatamente o intervalo UTF-16 declarado.',
      });
    }
  });

export const legalReferencePointSchema = z
  .strictObject({
    artigo: numeroDesignadorSchema.optional(),
    caput: z.literal(true).optional(),
    paragrafo: numeroDesignadorSchema.optional(),
    inciso: numeroDesignadorSchema.optional(),
    alinea: numeroDesignadorSchema.optional(),
    item: numeroDesignadorSchema.optional(),
  })
  .superRefine((point, ctx) => {
    const hasDesignator = Object.values(point).some((value) => value !== undefined);
    if (!hasDesignator) {
      ctx.addIssue({
        code: 'custom',
        message: 'O ponto jurídico deve conter ao menos um designador.',
      });
    }
    if (
      point.caput === true &&
      [point.paragrafo, point.inciso, point.alinea, point.item].some((value) => value !== undefined)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['caput'],
        message: 'Caput não pode ser combinado com dispositivo subordinado.',
      });
    }
  });

const pointSelectorSchema = z.strictObject({
  kind: z.literal('point'),
  point: legalReferencePointSchema,
});

const listSelectorSchema = z
  .strictObject({
    kind: z.literal('list'),
    points: z.array(legalReferencePointSchema).min(2).max(100),
  })
  .superRefine((selector, ctx) => {
    const seen = new Set<string>();
    for (const [index, point] of selector.points.entries()) {
      const key = JSON.stringify(point);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['points', index],
          message: 'Uma lista de localizadores não pode repetir o mesmo ponto jurídico.',
        });
      }
      seen.add(key);
    }
  });

const rangeSelectorSchema = z.strictObject({
  kind: z.literal('range'),
  from: legalReferencePointSchema,
  to: legalReferencePointSchema,
});

export const legalReferenceSelectorSchema = z.discriminatedUnion('kind', [
  pointSelectorSchema,
  listSelectorSchema,
  rangeSelectorSchema,
]);

const sameLawLocatorSchema = z.strictObject({
  scope: z.literal('same_law'),
  context: z.enum(['same_article', 'same_law']),
  selector: legalReferenceSelectorSchema,
});

const externalLawLocatorSchema = z.strictObject({
  scope: z.literal('external_law'),
  lawMention: textoObrigatorio('A menção literal à norma externa', 500),
  selector: legalReferenceSelectorSchema,
});

export const legalReferenceLocatorSchema = z.discriminatedUnion('scope', [
  sameLawLocatorSchema,
  externalLawLocatorSchema,
]);

export const legalReferenceEvidenceKindSchema = z.enum([
  'grammar_match',
  'structural_context',
  'canonical_identity',
  'catalog_alias',
  'editorial_confirmation',
]);

export const legalReferenceEvidenceSchema = z.strictObject({
  kind: legalReferenceEvidenceKindSchema,
  detail: textoObrigatorio('O detalhe da evidência', 2_000).optional(),
});

export const legalReferenceTargetSchema = z.strictObject({
  law: legalNormIdentitySchema,
  revisionHash: revisionHashSchema,
  blockId: blockIdSchema,
});

export const legalReferenceUnresolvedReasonSchema = z.enum([
  'law_not_imported',
  'device_not_found',
  'insufficient_context',
  'unsupported_locator',
  'stale_target',
  'editorially_unlinked',
]);

export const legalReferenceAmbiguousReasonSchema = z.enum(['alias_collision', 'multiple_targets']);

const referenceBaseShape = {
  referenceId: revisionHashSchema,
  sourceBlockId: blockIdSchema,
  sourceField: legalReferenceSourceFieldSchema,
  span: legalReferenceSpanSchema,
  locator: legalReferenceLocatorSchema,
  evidence: z.array(legalReferenceEvidenceSchema).min(1).max(20),
} as const;

const detectedReferenceSchema = z.strictObject({
  ...referenceBaseShape,
  state: z.literal('detected'),
  severity: z.literal('info'),
});

const resolvedReferenceSchema = z.strictObject({
  ...referenceBaseShape,
  state: z.literal('resolved'),
  severity: z.literal('info'),
  target: legalReferenceTargetSchema,
});

const unresolvedReferenceSchema = z
  .strictObject({
    ...referenceBaseShape,
    state: z.literal('unresolved'),
    severity: z.enum(['error', 'warning']),
    reason: legalReferenceUnresolvedReasonSchema,
  })
  .superRefine((reference, ctx) => {
    const expected = reference.reason === 'stale_target' ? 'error' : 'warning';
    if (reference.severity !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: `A razão "${reference.reason}" exige severidade "${expected}".`,
      });
    }
  });

const ambiguousReferenceSchema = z
  .strictObject({
    ...referenceBaseShape,
    state: z.literal('ambiguous'),
    severity: z.enum(['error', 'warning']),
    reason: legalReferenceAmbiguousReasonSchema,
    candidates: z.array(legalReferenceTargetSchema).min(2).max(50),
  })
  .superRefine((reference, ctx) => {
    const expected = reference.reason === 'alias_collision' ? 'error' : 'warning';
    if (reference.severity !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['severity'],
        message: `A razão "${reference.reason}" exige severidade "${expected}".`,
      });
    }

    const seen = new Set<string>();
    for (const [index, candidate] of reference.candidates.entries()) {
      const key = JSON.stringify(candidate);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['candidates', index],
          message: 'Uma referência ambígua exige candidatos distintos.',
        });
      }
      seen.add(key);
    }
  });

export const legalReferenceSchema = z.discriminatedUnion('state', [
  detectedReferenceSchema,
  resolvedReferenceSchema,
  unresolvedReferenceSchema,
  ambiguousReferenceSchema,
]);

const sameLaw = (
  left: z.infer<typeof legalNormIdentitySchema>,
  right: z.infer<typeof legalNormIdentitySchema>,
) => left.tipoNorma === right.tipoNorma && left.numero === right.numero && left.ano === right.ano;

const referenceOrderKey = (reference: z.infer<typeof legalReferenceSchema>): string =>
  [
    reference.sourceBlockId,
    reference.sourceField,
    String(reference.span.start).padStart(12, '0'),
    String(reference.span.end).padStart(12, '0'),
    reference.referenceId,
  ].join('\u0000');

export const legalReferenceIndexSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    law: legalNormIdentitySchema,
    revisionHash: revisionHashSchema,
    analyzerVersion: analyzerVersionSchema,
    references: z.array(legalReferenceSchema).max(100_000),
  })
  .superRefine((index, ctx) => {
    const ids = new Set<string>();
    const previousEndByField = new Map<string, number>();
    let previousOrderKey: string | undefined;

    for (const [position, reference] of index.references.entries()) {
      if (ids.has(reference.referenceId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['references', position, 'referenceId'],
          message: 'referenceId deve ser único dentro do índice.',
        });
      }
      ids.add(reference.referenceId);

      const orderKey = referenceOrderKey(reference);
      if (previousOrderKey !== undefined && orderKey < previousOrderKey) {
        ctx.addIssue({
          code: 'custom',
          path: ['references', position],
          message: 'As referências devem estar em ordem canônica de origem e span.',
        });
      }
      previousOrderKey = orderKey;

      const fieldKey = `${reference.sourceBlockId}\u0000${reference.sourceField}`;
      const previousEnd = previousEndByField.get(fieldKey);
      if (previousEnd !== undefined && reference.span.start < previousEnd) {
        ctx.addIssue({
          code: 'custom',
          path: ['references', position, 'span'],
          message: 'Referências no mesmo campo de origem não podem se sobrepor.',
        });
      }
      previousEndByField.set(fieldKey, reference.span.end);

      if (reference.state === 'resolved') {
        const targetIsSameLaw = sameLaw(index.law, reference.target.law);
        if (reference.locator.scope === 'same_law' && !targetIsSameLaw) {
          ctx.addIssue({
            code: 'custom',
            path: ['references', position, 'target', 'law'],
            message: 'Uma referência same_law deve apontar para a lei do índice.',
          });
        }
        if (reference.locator.scope === 'external_law' && targetIsSameLaw) {
          ctx.addIssue({
            code: 'custom',
            path: ['references', position, 'target', 'law'],
            message: 'Uma referência external_law deve apontar para outra lei.',
          });
        }
      }
    }
  });

export type LegalReferenceSeverity = z.infer<typeof legalReferenceSeveritySchema>;
export type LegalReferenceState = z.infer<typeof legalReferenceStateSchema>;
export type LegalReferenceSourceField = z.infer<typeof legalReferenceSourceFieldSchema>;
export type LegalNormIdentity = z.infer<typeof legalNormIdentitySchema>;
export type LegalReferenceSpan = z.infer<typeof legalReferenceSpanSchema>;
export type LegalReferencePoint = z.infer<typeof legalReferencePointSchema>;
export type LegalReferenceSelector = z.infer<typeof legalReferenceSelectorSchema>;
export type LegalReferenceLocator = z.infer<typeof legalReferenceLocatorSchema>;
export type LegalReferenceEvidenceKind = z.infer<typeof legalReferenceEvidenceKindSchema>;
export type LegalReferenceEvidence = z.infer<typeof legalReferenceEvidenceSchema>;
export type LegalReferenceTarget = z.infer<typeof legalReferenceTargetSchema>;
export type LegalReferenceUnresolvedReason = z.infer<typeof legalReferenceUnresolvedReasonSchema>;
export type LegalReferenceAmbiguousReason = z.infer<typeof legalReferenceAmbiguousReasonSchema>;
export type LegalReference = z.infer<typeof legalReferenceSchema>;
export type LegalReferenceIndex = z.infer<typeof legalReferenceIndexSchema>;
