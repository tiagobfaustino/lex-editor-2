import { z } from 'zod';
import { DesktopErrorDtoSchema } from './desktop-api.js';
import { EditorialStateDtoSchema } from './editorial.js';
import { UpdateDiffEntryDtoSchema } from './updates.js';
import { SourceSummaryDtoSchema } from './import.js';

export const LIBRARY_LIST_CHANNEL = 'library:list' as const;
export const LIBRARY_DELETE_CHANNEL = 'library:delete' as const;
export const LIBRARY_OPEN_CHANNEL = 'library:open' as const;
export const DESKTOP_LIBRARY_LIMITS = Object.freeze({
  commandBytes: 2048,
  pageBytes: 96 * 1024,
  pageItems: 25,
});
export const ListLocalLawsCommandSchema = z.strictObject({
  query: z.string().max(160),
  offset: z.int().min(0).max(1_000_000),
  limit: z.int().min(1).max(DESKTOP_LIBRARY_LIMITS.pageItems),
});
export const OpenLocalLawCommandSchema = z.strictObject({ projectId: z.uuid() });
export const LocalLawSummaryDtoSchema = z.discriminatedUnion('recoveryState', [
  z.strictObject({
    recoveryState: z.literal('ready'),
    projectId: z.uuid(),
    title: z.string().min(1).max(500),
    sigla: z.string().min(1).max(80),
    lawType: z.string().min(1).max(80),
    number: z.string().min(1).max(80),
    year: z.int().min(1000).max(9999),
    totalArticles: z.int().nonnegative(),
    importedAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    sourceUrl: z.string().max(2048),
    sourceVariant: z.enum(['compiled', 'annotated', 'other']),
    revisionHash: z.string().regex(/^[0-9a-f]{64}$/u),
    journalSequence: z.int().nonnegative(),
  }),
  z.strictObject({
    recoveryState: z.literal('unavailable'),
    projectId: z.uuid(),
    title: z.literal('Importação indisponível'),
  }),
]);
export const LocalLawPageDtoSchema = z.strictObject({
  items: z.array(LocalLawSummaryDtoSchema).max(DESKTOP_LIBRARY_LIMITS.pageItems),
  nextOffset: z.int().nonnegative().nullable(),
  totalItems: z.int().nonnegative(),
});
export const OpenLocalLawDtoSchema = z.strictObject({
  projectId: z.uuid(),
  source: SourceSummaryDtoSchema,
});
const result = <Value extends z.ZodType>(value: Value) =>
  z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), value }),
    z.strictObject({ ok: z.literal(false), error: DesktopErrorDtoSchema }),
  ]);
export const ListLocalLawsResultSchema = result(LocalLawPageDtoSchema);
export const OpenLocalLawResultSchema = result(OpenLocalLawDtoSchema);
export type ListLocalLawsCommand = z.infer<typeof ListLocalLawsCommandSchema>;
export type OpenLocalLawCommand = z.infer<typeof OpenLocalLawCommandSchema>;
export type LocalLawSummaryDto = z.infer<typeof LocalLawSummaryDtoSchema>;
export type LocalLawPageDto = z.infer<typeof LocalLawPageDtoSchema>;
export type OpenLocalLawDto = z.infer<typeof OpenLocalLawDtoSchema>;
export type ListLocalLawsResult = z.infer<typeof ListLocalLawsResultSchema>;
export type OpenLocalLawResult = z.infer<typeof OpenLocalLawResultSchema>;

export const DeleteLocalLawCommandSchema = z.strictObject({ projectId: z.uuid() });
export const DeleteLocalLawDtoSchema = z.strictObject({
  projectId: z.uuid(),
  deleted: z.literal(true),
});
export const DeleteLocalLawResultSchema = result(DeleteLocalLawDtoSchema);
export type DeleteLocalLawCommand = z.infer<typeof DeleteLocalLawCommandSchema>;
export type DeleteLocalLawDto = z.infer<typeof DeleteLocalLawDtoSchema>;
export type DeleteLocalLawResult = z.infer<typeof DeleteLocalLawResultSchema>;

export const LIBRARY_CHECK_SOURCE_CHANNEL = 'library:check-source' as const;
export const LIBRARY_APPLY_SOURCE_UPDATE_CHANNEL = 'library:apply-source-update' as const;
export const CheckLocalSourceCommandSchema = z.strictObject({ projectId: z.uuid() });
export const ApplyLocalSourceUpdateCommandSchema = z.strictObject({
  projectId: z.uuid(),
  checkId: z.uuid(),
  expectedRevisionHash: z.string().regex(/^[0-9a-f]{64}$/u),
  acknowledged: z.literal(true),
  overwriteConflicts: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});
export const LocalSourceCheckDtoSchema = z.strictObject({
  projectId: z.uuid(),
  checkId: z.uuid(),
  expectedRevisionHash: z.string().regex(/^[0-9a-f]{64}$/u),
  checkedAt: z.iso.datetime({ offset: true }),
  sourceUrl: z.url().max(2048),
  hasChanges: z.boolean(),
  canApply: z.boolean(),
  conflictingBlockIds: z.array(z.string().max(240)).max(5000),
  missingBlockIds: z.array(z.string().max(240)).max(5000),
  entries: z.array(UpdateDiffEntryDtoSchema).max(5000),
});
export const CheckLocalSourceResultSchema = result(LocalSourceCheckDtoSchema);
export const ApplyLocalSourceUpdateResultSchema = result(EditorialStateDtoSchema);
export type CheckLocalSourceCommand = z.infer<typeof CheckLocalSourceCommandSchema>;
export type ApplyLocalSourceUpdateCommand = z.infer<typeof ApplyLocalSourceUpdateCommandSchema>;
export type LocalSourceCheckDto = z.infer<typeof LocalSourceCheckDtoSchema>;
export type CheckLocalSourceResult = z.infer<typeof CheckLocalSourceResultSchema>;
export type ApplyLocalSourceUpdateResult = z.infer<typeof ApplyLocalSourceUpdateResultSchema>;
