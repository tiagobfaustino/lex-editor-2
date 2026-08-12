// Ponto público do pacote de domínio.
//
// O que sai daqui é contrato para o parser, o reconciliador, o Formatter, a
// validação bloqueante e o worker de atualização. O pacote é puro: não importa
// Electron, React, filesystem, rede nem banco, e a Feature 002 prova isso por
// lint e por teste.

export {
  astPhaseSchema,
  deviceStatusSchema,
  legalStatusSchema,
  parseConfidenceReasonSchema,
  parseConfidenceSchema,
  publicationStatusSchema,
  sourceRoleSchema,
  sourceTypeSchema,
  sourceVariantSchema,
  tipoNormaSchema,
  tipoNoSchema,
  TIPOS_DIVISAO,
  TIPOS_REFERENCIAVEIS,
} from './ast/enums.js';

export type {
  AstPhase,
  DeviceStatus,
  LegalStatus,
  ParseConfidence,
  ParseConfidenceReason,
  PublicationStatus,
  SourceRole,
  SourceType,
  SourceVariant,
  TipoDivisao,
  TipoNo,
  TipoNorma,
  TipoReferenciavel,
} from './ast/enums.js';

export { CODIGOS_PROBLEMA, LIMITE_PROBLEMAS } from './ast/errors.js';

export type {
  CodigoProblema,
  ProblemaValidacao,
  ResultadoValidacao,
  SegmentoCaminho,
} from './ast/errors.js';

export type {
  AlineaNode,
  AnexoNode,
  ArtigoNode,
  AtoTransitorioNode,
  BlockIdDepreciado,
  CapituloNode,
  DispositivoNodeBase,
  DivisaoNodeBase,
  IdentifiedChildNode,
  IdentifiedNormaAST,
  IncisoNode,
  ItemNode,
  LeiNode,
  LivroNode,
  NormaChildNode,
  NormaNode,
  NormaNodeBase,
  ParagrafoNode,
  ParsedChildNode,
  ParsedNormaAST,
  ParseEvidence,
  PenaNode,
  RedacaoAnterior,
  ReferenciaRedacao,
  SecaoNode,
  SlotBlockIdOpcional,
  SlotComBlockId,
  SlotSemBlockId,
  SourceReference,
  SubsecaoNode,
  TabelaNode,
  TituloNode,
} from './ast/nodes.js';

export {
  blockIdDepreciadoSchema,
  identifiedAnexoSchema,
  identifiedAtoTransitorioSchema,
  identifiedArtigoSchema,
  identifiedNormaAstSchema,
  identifiedTabelaSchema,
  normaAstSchema,
  parseEvidenceSchema,
  parsedAnexoSchema,
  parsedAtoTransitorioSchema,
  parsedArtigoSchema,
  parsedNormaAstSchema,
  parsedTabelaSchema,
  redacaoAnteriorSchema,
  referenciaRedacaoSchema,
  sourceReferenceSchema,
} from './ast/schemas.js';

export {
  percorrer,
  validarEstrutura,
  validarIdentifiedNormaAst,
  validarNormaAst,
  validarParsedNormaAst,
} from './ast/validate.js';

export {
  evidenciaAlta,
  evidenciaBaixa,
  identifiedCompleta,
  identifiedMinima,
  origemHistorica,
  origemMinima,
  parsedMinima,
} from './ast/fixtures/minimas.js';

// --- Pipeline (Feature 003) ---

export { montarConjuntoDeFontes, referenciarFragmento } from './source/snapshot.js';
export { mesclarFontes } from './source/mesclar.js';
export type { OpcoesDeMesclagem } from './source/mesclar.js';
export { extrairLinhas, juntarContinuacoes } from './source/planalto.js';
export type { OpcoesDeExtracao } from './source/planalto.js';
export { varrerPedacos } from './source/pedacos.js';
export type { Pedaco } from './source/pedacos.js';
export type { ConjuntoDeFontes, SourceSnapshot } from './source/snapshot.js';

// --- Detecção de atualização (Feature 008) ---

export {
  calculateNormativeHash,
  canonicalizeNormativeProjection,
  createLegislativeDetectionHashes,
  legislativeDetectionHashesSchema,
  normalizeEditorialReferenceText,
  normalizeNormativeText,
  normativeDeviceProjectionSchema,
  normativeProjectionSchema,
  projectNormativeAst,
  sourceArtifactHashSchema,
} from './normative-projection/index.js';
export type {
  LegislativeDetectionHashes,
  NormativeDeviceProjection,
  NormativeProjection,
  NormativeSha256Function,
  SourceArtifactHash,
} from './normative-projection/index.js';

// --- Referências jurídicas resolvidas (Feature 010) ---

export {
  legalNormIdentitySchema,
  legalNormCatalogAliasSchema,
  legalNormCatalogCollisionSchema,
  legalNormCatalogDeviceSchema,
  legalNormCatalogEntrySchema,
  legalNormCatalogSchema,
  legalNormIdentityKey,
  legalReferenceAmbiguousReasonSchema,
  legalReferenceDecisionSchema,
  legalReferenceDecisionSetSchema,
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
  detectLegalReferenceMentions,
  detectLegalReferences,
  createLegalNormCatalog,
  normalizeLegalNormAlias,
  resolveLegalReferences,
  createVincuLexLayout,
  slugifyVincuLexSegment,
  vincuLexLayoutEntrySchema,
  vincuLexLayoutSchema,
  vincuLexWikiPathSchema,
  createVincuLexPackage,
  validateVincuLexPackage,
  vincuLexPackageFileSchema,
  vincuLexPackageSchema,
} from './legal-reference/index.js';
export type {
  CreateLegalNormCatalogOptions,
  DetectedLegalReferenceMention,
  DetectLegalReferencesOptions,
  LegalNormCatalog,
  LegalNormCatalogAlias,
  LegalNormCatalogCollision,
  LegalNormCatalogDevice,
  LegalNormCatalogEntry,
  LegalNormCatalogInput,
  LegalNormIdentity,
  LegalReference,
  LegalReferenceAmbiguousReason,
  LegalReferenceDecision,
  LegalReferenceDecisionSet,
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
  ResolveLegalReferencesInput,
  ResolveLegalReferencesOptions,
  CreateVincuLexLayoutOptions,
  VincuLexLayout,
  VincuLexLayoutDocument,
  VincuLexLayoutEntry,
  CreateVincuLexPackageInput,
  VincuLexPackage,
  VincuLexPackageCrypto,
  VincuLexPackageDocument,
  VincuLexPackageFile,
} from './legal-reference/index.js';

// --- Diff estrutural de atualização (Feature 008) ---

export {
  createLegislativeStructuralDiff,
  explicitRenumberingSchema,
  legislativeDiffCategorySchema,
  legislativeDiffEntrySchema,
  legislativeDiffSideSchema,
  legislativeDiffSummarySchema,
  legislativePathSegmentSchema,
  legislativeStructuralDiffSchema,
} from './diff/index.js';
export type {
  ExplicitRenumbering,
  LegislativeDiffCategory,
  LegislativeDiffEntry,
  LegislativeDiffSide,
  LegislativeDiffSummary,
  LegislativePathSegment,
  LegislativeStructuralDiff,
} from './diff/index.js';

export { analisar, DIVISOES, reconhecer } from './parser/index.js';
export type { EntradaDoParser, MetadadosDaNorma } from './parser/index.js';
export { aplicarDecisoesEditoriais } from './parser/decisoes-editoriais.js';
export type { DecisaoEditorial } from './parser/decisoes-editoriais.js';

export { contarBlockIds, identificar } from './block-id/index.js';

export { formatar } from './formatter/index.js';
export type { FormatLegalReferencesOptions } from './formatter/legal-references.js';
export { validarMarkdownCanonico } from './formatter/validar-canonico.js';

// --- Projeções completa e somente vigente (Feature 009) ---

export { contentProjectionProfileSchema, projectContent } from './content-projection/index.js';
export type { ContentProjection, ContentProjectionProfile } from './content-projection/index.js';

export { descreverRelatorio, ETAPAS, situarProblemas } from './pipeline/relatorio.js';
export type {
  Etapa,
  MetricasDoPipeline,
  ProblemaDeEtapa,
  Relatorio,
} from './pipeline/relatorio.js';

export {
  reconciliar,
  registrarPublicacao,
  REGISTRO_VAZIO,
  verificarAliases,
} from './reconciliation/index.js';
export type { RegistroPublicado, ResultadoDaReconciliacao } from './reconciliation/index.js';

export { projetar, reconstruir } from './postgres-projection/index.js';
export {
  legalReferenceSqlEdgeSchema,
  legalReferenceSqlTargetSchema,
  projectLegalReferenceSqlEdges,
} from './postgres-projection/legal-references.js';
export type {
  LinhaDeDispositivo,
  LinhaDeLei,
  LinhaDeVersao,
  Projecao,
} from './postgres-projection/index.js';
export type {
  LegalReferenceSqlEdge,
  LegalReferenceSqlTarget,
} from './postgres-projection/legal-references.js';

export { processar } from './pipeline/processar.js';
export type { ResultadoDoPipeline } from './pipeline/processar.js';

// --- Estado editorial (Feature 006) ---

export {
  calculateRevisionHash,
  canonicalizeRevision,
  editableLawMetadataChangesSchema,
  editorialCheckpointSchema,
  editorialCommandSchema,
  editorialJournalEntrySchema,
  editorialJournalSchema,
  editorialOperationSchema,
  parseEditorialJournal,
  revisionHashSchema,
  revisionSnapshotSchema,
} from './editorial-commands/index.js';

export type {
  EditableLawMetadataChanges,
  EditorialCheckpoint,
  EditorialCommand,
  EditorialJournal,
  EditorialJournalEntry,
  EditorialOperation,
  RevisionHash,
  RevisionHashFunction,
  RevisionSnapshot,
} from './editorial-commands/index.js';

export {
  applyEditorialCommand,
  editorialCommandErrorCodeSchema,
} from './editorial-commands/apply.js';

export {
  appendEditorialJournalEntry,
  createEditorialCheckpoint,
  currentJournalRevisionHash,
  replayEditorialJournal,
} from './editorial-commands/replay.js';
export type {
  EditorialReplayErrorCode,
  EditorialReplayResult,
} from './editorial-commands/replay.js';
export { reconcileEditorialReprocessing } from './editorial-commands/reprocessing.js';
export type { EditorialReprocessingResult } from './editorial-commands/reprocessing.js';

// --- Validação editorial (Feature 006) ---

export {
  approveEditorialRevision,
  collectConfirmedWarningFingerprints,
  editorialApprovalSchema,
  editorialDiagnosticLocationSchema,
  editorialDiagnosticSeveritySchema,
  editorialValidationDiagnosticSchema,
  editorialValidationReportSchema,
  isEditorialApprovalCurrent,
  runEditorialValidation,
} from './editorial-validation/index.js';
export type {
  ApproveEditorialRevisionResult,
  EditorialApproval,
  EditorialValidationDiagnostic,
  EditorialValidationReport,
  RunEditorialValidationOptions,
} from './editorial-validation/index.js';
export type {
  EditorialCommandErrorCode,
  EditorialCommandResult,
} from './editorial-commands/apply.js';

// --- Changelog estruturado (Feature 006) ---

export {
  blockChangeSchema,
  deriveStructuredChanges,
  generateUpdateMarkdown,
  publicationKindSchema,
  renumberedBlockChangeSchema,
  structuredChangesSchema,
  updateDocumentSchema,
  updateEntrySchema,
} from './changelog/index.js';
export type {
  BlockChange,
  PublicationKind,
  RenumberedBlockChange,
  StructuredChanges,
  UpdateEntry,
} from './changelog/index.js';
