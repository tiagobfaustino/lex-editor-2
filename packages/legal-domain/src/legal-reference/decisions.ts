import { z } from 'zod';

import { revisionHashSchema } from '../editorial-commands/index.js';
import {
  legalReferenceSourceFieldSchema,
  legalReferenceSpanSchema,
  legalReferenceTargetSchema,
} from './contracts.js';

const requiredText = (label: string, maximum: number) =>
  z
    .string()
    .max(maximum)
    .check((ctx) => {
      if (ctx.value.trim().length === 0) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: `${label} não pode ser vazio.`,
        });
      }
    });

const blockIdSchema = z
  .string()
  .max(240)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Esperado Block ID canônico, sem "^".');

const decisionBase = {
  schemaVersion: z.literal(1),
  referenceId: revisionHashSchema,
  sourceRevisionHash: revisionHashSchema,
  sourceBlockId: blockIdSchema,
  sourceField: legalReferenceSourceFieldSchema,
  sourceSpan: legalReferenceSpanSchema,
  justification: requiredText('A justificativa editorial', 2_000),
} as const;

const confirmTargetDecisionSchema = z.strictObject({
  ...decisionBase,
  action: z.literal('confirm_target'),
  target: legalReferenceTargetSchema,
});

const keepUnlinkedDecisionSchema = z.strictObject({
  ...decisionBase,
  action: z.literal('keep_unlinked'),
});

export const legalReferenceDecisionSchema = z.discriminatedUnion('action', [
  confirmTargetDecisionSchema,
  keepUnlinkedDecisionSchema,
]);

export const legalReferenceDecisionSetSchema = z
  .array(legalReferenceDecisionSchema)
  .max(100_000)
  .superRefine((decisions, ctx) => {
    const referenceIds = new Set<string>();
    for (const [index, decision] of decisions.entries()) {
      if (referenceIds.has(decision.referenceId)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'referenceId'],
          message: 'Só pode existir uma decisão editorial ativa por menção.',
        });
      }
      referenceIds.add(decision.referenceId);
    }
  });

export type LegalReferenceDecision = z.infer<typeof legalReferenceDecisionSchema>;
export type LegalReferenceDecisionSet = z.infer<typeof legalReferenceDecisionSetSchema>;
