export {
  legalNormIdentitySchema,
  legalReferenceAmbiguousReasonSchema,
  legalReferenceEvidenceKindSchema,
  legalReferenceEvidenceSchema,
  legalReferenceIndexSchema,
  legalReferenceLocatorSchema,
  legalReferencePointSchema,
  legalReferenceSchema,
  legalReferenceSelectorSchema,
  legalReferenceSeveritySchema,
  legalReferenceSourceFieldSchema,
  legalReferenceSpanSchema,
  legalReferenceStateSchema,
  legalReferenceTargetSchema,
  legalReferenceUnresolvedReasonSchema,
} from './contracts.js';

export type {
  LegalNormIdentity,
  LegalReference,
  LegalReferenceAmbiguousReason,
  LegalReferenceEvidence,
  LegalReferenceEvidenceKind,
  LegalReferenceIndex,
  LegalReferenceLocator,
  LegalReferencePoint,
  LegalReferenceSelector,
  LegalReferenceSeverity,
  LegalReferenceSourceField,
  LegalReferenceSpan,
  LegalReferenceState,
  LegalReferenceTarget,
  LegalReferenceUnresolvedReason,
} from './contracts.js';

export {
  createLegalNormCatalog,
  legalNormCatalogAliasSchema,
  legalNormCatalogCollisionSchema,
  legalNormCatalogDeviceSchema,
  legalNormCatalogEntrySchema,
  legalNormCatalogSchema,
  legalNormIdentityKey,
  normalizeLegalNormAlias,
} from './catalog.js';

export {
  createVincuLexLayout,
  slugifyVincuLexSegment,
  vincuLexLayoutEntrySchema,
  vincuLexLayoutSchema,
  vincuLexWikiPathSchema,
} from './layout.js';

export {
  createVincuLexPackage,
  validateVincuLexPackage,
  vincuLexPackageFileSchema,
  vincuLexPackageSchema,
} from './package.js';
export type {
  CreateVincuLexPackageInput,
  VincuLexPackage,
  VincuLexPackageCrypto,
  VincuLexPackageDocument,
  VincuLexPackageFile,
} from './package.js';
export type {
  CreateVincuLexLayoutOptions,
  VincuLexLayout,
  VincuLexLayoutDocument,
  VincuLexLayoutEntry,
} from './layout.js';
export type {
  CreateLegalNormCatalogOptions,
  LegalNormCatalog,
  LegalNormCatalogAlias,
  LegalNormCatalogCollision,
  LegalNormCatalogDevice,
  LegalNormCatalogEntry,
  LegalNormCatalogInput,
} from './catalog.js';

export { legalReferenceDecisionSchema, legalReferenceDecisionSetSchema } from './decisions.js';
export type { LegalReferenceDecision, LegalReferenceDecisionSet } from './decisions.js';

export { resolveLegalReferences } from './resolver.js';
export type { ResolveLegalReferencesInput, ResolveLegalReferencesOptions } from './resolver.js';

export { detectLegalReferenceMentions, detectLegalReferences } from './detector.js';
export type { DetectedLegalReferenceMention, DetectLegalReferencesOptions } from './detector.js';
