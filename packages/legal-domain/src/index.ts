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
  identifiedArtigoSchema,
  identifiedNormaAstSchema,
  identifiedTabelaSchema,
  normaAstSchema,
  parseEvidenceSchema,
  parsedAnexoSchema,
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
export { extrairLinhas, juntarContinuacoes } from './source/planalto.js';
export type { OpcoesDeExtracao } from './source/planalto.js';
export { varrerPedacos } from './source/pedacos.js';
export type { Pedaco } from './source/pedacos.js';
export type { ConjuntoDeFontes, SourceSnapshot } from './source/snapshot.js';

export { analisar, DIVISOES, reconhecer } from './parser/index.js';
export type { EntradaDoParser, MetadadosDaNorma } from './parser/index.js';

export { contarBlockIds, identificar } from './block-id/index.js';

export { formatar } from './formatter/index.js';
export { validarMarkdownCanonico } from './formatter/validar-canonico.js';

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
export type {
  LinhaDeDispositivo,
  LinhaDeLei,
  LinhaDeVersao,
  Projecao,
} from './postgres-projection/index.js';

export { processar } from './pipeline/processar.js';
export type { ResultadoDoPipeline } from './pipeline/processar.js';
