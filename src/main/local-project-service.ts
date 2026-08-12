import { createHash, randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { lstat, mkdir, open, readFile, realpath, rename, rm, unlink } from 'node:fs/promises';

import {
  analisar,
  appendEditorialJournalEntry,
  applyEditorialCommand,
  approveEditorialRevision,
  calculateRevisionHash,
  collectConfirmedWarningFingerprints,
  createLegalNormCatalog,
  detectLegalReferences,
  contarBlockIds,
  deriveStructuredChanges,
  extrairLinhas,
  formatar,
  generateUpdateMarkdown,
  identificar,
  juntarContinuacoes,
  legalNormIdentityKey,
  mesclarFontes,
  normalizeLegalNormAlias,
  percorrer,
  projectContent,
  processar,
  reconhecer,
  resolveLegalReferences,
  runEditorialValidation,
  situarProblemas,
  validarIdentifiedNormaAst,
  validarMarkdownCanonico,
  type IdentifiedNormaAST,
  type EditorialApproval,
  type EditorialCommand,
  type EditorialJournal,
  type EditorialValidationReport,
  type MetadadosDaNorma,
  type LegalReference,
  type LegalReferenceIndex,
  type NormaChildNode,
  type ProblemaDeEtapa,
  type ResultadoDoPipeline,
  type SourceRole,
  type SourceVariant,
  type ContentProjectionProfile,
} from '@lex-editor/legal-domain';
import type { BrowserWindow, OpenDialogOptions, SaveDialogOptions } from 'electron';

import {
  DESKTOP_IMPORT_LIMITS,
  type DiagnosticDto,
  type BatchExportFailureCode,
  type BatchExportItemResultDto,
  type BatchExportResultDto,
  type DiagnosticPageDto,
  type ExportResultDto,
  type LegalReferenceNavigationDto,
  type LegalReferencePreviewDto,
  type ProjectionPreferenceDto,
  type PreviewDocumentDto,
  type PreviewNodeDto,
  type PreviewNodePathDto,
  type PreviewPageDto,
  type ProgressDto,
  type SourceSummaryDto,
} from '../shared/ipc/import.js';
import { DESKTOP_EDITORIAL_LIMITS } from '../shared/ipc/editorial.js';
import type {
  EditorialDiagnosticDto,
  EditorialReviewTargetDto,
  EditorialStateDto,
} from '../shared/ipc/editorial.js';
import type { DesktopImportIpcCapabilities } from './ipc/register.js';
import { defuddleSnapshot, SourceExtractionError } from './import/defuddle.js';
import {
  fetchPlanaltoSourceSet,
  PlanaltoNetworkError,
  type PlanaltoNetworkPorts,
} from './import/planalto-source.js';
import { createEditorialProjectStore } from './projects/editorial-project-store.js';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

type DialogPort = Readonly<{
  showOpenDialog(
    window: BrowserWindow,
    options: OpenDialogOptions,
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(
    window: BrowserWindow,
    options: SaveDialogOptions,
  ): Promise<{ canceled: boolean; filePath?: string }>;
}>;

type SourceArtifactRecord = Readonly<{
  sourceArtifactId: string;
  snapshotPath: string;
  finalUrl: string;
  sourceRole: SourceRole;
  sourceVariant: SourceVariant;
  sourceArtifactSha256: string;
}>;

type SourceRecord = Readonly<{
  summary: SourceSummaryDto;
  primary: SourceArtifactRecord;
  artifacts: readonly SourceArtifactRecord[];
}>;

type PreviewRecord = Readonly<{
  dto: PreviewNodeDto;
  children: readonly string[];
  domainNodeId: string;
}>;

interface ProjectRecord {
  readonly projectId: string;
  readonly source: SourceRecord;
  markdown?: string;
  projectionProfile: ContentProjectionProfile;
  document?: PreviewDocumentDto;
  readonly nodes: Map<string, PreviewRecord>;
  readonly roots: string[];
  diagnostics: DiagnosticDto[];
  ast?: IdentifiedNormaAST;
  detectedReferenceIndex?: LegalReferenceIndex;
  referenceIndex?: LegalReferenceIndex;
  referenceIndexDigest?: string;
  journal?: EditorialJournal;
  validation?: EditorialValidationReport;
  approval?: EditorialApproval;
  approvalWasInvalidated: boolean;
  readonly editorialDiagnosticIds: Map<string, string>;
}

interface JobRecord {
  readonly jobId: string;
  readonly projectId: string;
  cancelled: boolean;
  sequence: number;
}

type CursorRecord = Readonly<{
  projectId: string;
  kind: 'preview' | 'diagnostics';
  parentPreviewNodeId: string | null;
  offset: number;
}>;

export type LocalProjectServiceOptions = Readonly<{
  storageRoot: string;
  dialog: DialogPort;
  getMainWindow(): BrowserWindow | null;
  sendProgress(progress: ProgressDto): void;
  now?(): Date;
  networkPorts?: PlanaltoNetworkPorts;
}>;

const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

const conventionalLegalAliases = (ast: IdentifiedNormaAST): readonly string[] => {
  if (ast.tipoNorma === 'constituição' && ast.ano === 1988) {
    return ['Constituição Federal', 'CF', 'CF/88', 'CF1988'];
  }
  return [];
};

const slugifyExportName = (value: string, fallback: string): string => {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80)
    .replace(/-+$/gu, '');
  return slug.length === 0 ? fallback : slug;
};

const safeSourceSummary = (value: string): string =>
  value
    .replace(/[\r\n`]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);

const decodeText = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
};

const jsonScalar = (value: string): string => {
  try {
    const parsed: unknown = JSON.parse(value);

    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value.replace(/^['"]|['"]$/gu, '');
  }
};

const readFrontmatter = (markdown: string): Readonly<Record<string, string>> => {
  if (!markdown.startsWith('---\n')) {
    return {};
  }

  const end = markdown.indexOf('\n---\n', 4);
  const result: Record<string, string> = {};

  if (end < 0) {
    return result;
  }

  for (const line of markdown.slice(4, end).split('\n')) {
    const match = /^(?<key>[a-z_]+):\s*(?<value>.*)$/u.exec(line);

    if (match?.groups?.['value']?.length) {
      result[match.groups['key'] ?? ''] = jsonScalar(match.groups['value']);
    }
  }

  return result;
};

const normalizeCanonicalMarkdown = (markdown: string): string => {
  const frontmatterEnd = markdown.startsWith('---\n') ? markdown.indexOf('\n---\n', 4) : -1;
  const body = frontmatterEnd >= 0 ? markdown.slice(frontmatterEnd + 5) : markdown;
  const result: string[] = [];

  for (const rawLine of body.split(/\r?\n/u)) {
    const trimmed = rawLine.trim();

    if (trimmed.length === 0 || trimmed.startsWith('>')) {
      continue;
    }

    if (/^-\s+~~.*~~(?:\s+\*.*\*)?$/u.test(trimmed)) {
      continue;
    }

    const heading = /^#{1,5}\s+(?<label>.+)$/u.exec(trimmed)?.groups?.['label'];

    if (heading !== undefined) {
      const division =
        /^(?<kind>Ato das Disposições Constitucionais Transitórias|Livro|Título|Capítulo|Seção|Subseção|Anexo)(?:\s+(?<number>[^\s-]+))?(?:\s+-\s+(?<title>.*))?$/iu.exec(
          heading.replace(/\s+\^[a-z0-9-]+$/u, ''),
        );

      if (division?.groups !== undefined) {
        const kind = division.groups['kind'] ?? '';
        const number = division.groups['number'] ?? '';
        const title = division.groups['title'] ?? '';
        result.push(
          `${kind}${number.length > 0 ? ` ${number}` : ''}${title.length > 0 ? ` - ${title}` : ''}`,
        );
      }

      continue;
    }

    const withoutList = trimmed.replace(/^[-*+]\s+/u, '');
    const withoutPersonalBlockId = withoutList.replace(/\s+\^[a-z0-9-]+$/u, '');
    const withoutPersonalDecoration = withoutPersonalBlockId
      .replace(/<!--[\s\S]*?-->/gu, ' ')
      .replace(/!?\[\[[^\]|]+\|([^\]]+)\]\]/gu, '$1')
      .replace(/!?\[\[([^\]]+)\]\]/gu, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/<[^>]*>/gu, ' ')
      .replace(/(?:\*\*|__|==|`)/gu, '')
      .replace(/\s+/gu, ' ')
      .trim();

    if (withoutPersonalDecoration.length > 0) {
      result.push(withoutPersonalDecoration);
    }
  }

  return result.join('\n');
};

const slug = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 24) || 'norma';

const metadataFor = (
  text: string,
  displayName: string,
  mediaType: SourceSummaryDto['mediaType'],
  date: string,
  sourceUrl?: string,
): MetadadosDaNorma => {
  const frontmatter = mediaType === 'text/markdown' ? readFrontmatter(text) : {};
  const plain = text.replace(/<[^>]+>/gu, ' ');
  const header =
    /(?<type>DECRETO-LEI|LEI COMPLEMENTAR|LEI|DECRETO)\s+(?:N[º°o]\s*)?(?<number>[\d.]+)[^\d]{0,80}(?<year>19\d{2}|20\d{2})/iu.exec(
      plain,
    );
  const hrefIdentity = /(?:DEL|LEI)%20(?<number>[\d.]+)-(?<year>19\d{2}|20\d{2})/iu.exec(text);
  const titleFromHtml = /<title[^>]*>(?<title>[^<]+)<\/title>/iu.exec(text)?.groups?.['title'];
  const number =
    frontmatter['numero'] ??
    header?.groups?.['number'] ??
    hrefIdentity?.groups?.['number'] ??
    's-n';
  const year = Number(
    frontmatter['ano'] ??
      header?.groups?.['year'] ??
      hrefIdentity?.groups?.['year'] ??
      date.slice(0, 4),
  );
  const typeLabel = (frontmatter['tipo'] ?? header?.groups?.['type'] ?? 'lei').toLocaleLowerCase(
    'pt-BR',
  );
  const tipoNorma: MetadadosDaNorma['tipoNorma'] = typeLabel.includes('complementar')
    ? 'lei complementar'
    : typeLabel.includes('constitui')
      ? 'constituição'
      : typeLabel.includes('emenda constitucional')
        ? 'emenda constitucional'
        : typeLabel.includes('medida provisória')
          ? 'medida provisória'
          : typeLabel.includes('código')
            ? 'código'
            : typeLabel.includes('decreto-lei')
              ? 'decreto-lei'
              : typeLabel === 'decreto'
                ? 'decreto'
                : 'lei ordinária';
  const fallbackTitle =
    titleFromHtml?.replace(/compilado/giu, '').trim() ??
    basename(displayName, extname(displayName));
  const titulo = frontmatter['title'] ?? fallbackTitle;
  const sigla = frontmatter['sigla'] ?? slug(titulo);
  const publicationDate = frontmatter['data_publicacao'] ?? `${String(year)}-01-01`;
  let tags: string[] | undefined;
  if (frontmatter['tags'] !== undefined) {
    try {
      const parsed: unknown = JSON.parse(frontmatter['tags']);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) tags = parsed;
    } catch {
      tags = undefined;
    }
  }

  return {
    titulo,
    sigla,
    tipoNorma,
    numero: number,
    ano: year,
    ramo: frontmatter['ramo'] ?? 'geral',
    fonte:
      frontmatter['fonte'] ??
      sourceUrl ??
      `https://local.lex-editor.invalid/snapshot/${encodeURIComponent(displayName)}`,
    dataPublicacao: publicationDate,
    dataAtualizacaoLegal: frontmatter['data_atualizacao_legal'] ?? publicationDate,
    dataFormatacaoVinculex: frontmatter['data_formatacao_vinculex'] ?? date,
    dataVerificacaoIntegridade: date,
    versaoVinculex: frontmatter['versao_vinculex'] ?? '1.0.0',
    legalStatus: frontmatter['legal_status'] === 'revogada' ? 'revogada' : 'vigente',
    publicationStatus: 'draft',
    ...(tags === undefined ? {} : { tags }),
  };
};

type LoadedArtifact = Readonly<{
  record: SourceArtifactRecord;
  original: string;
  content: string;
}>;

const extractLegalContent = async (
  original: string,
  artifact: SourceArtifactRecord,
): Promise<string> => {
  const defuddled = await defuddleSnapshot(original, artifact.finalUrl);
  const lines = extrairLinhas(defuddled.cleanedHtml, { reconhecer });
  const first = lines.findIndex((line) => reconhecer(line) !== undefined);

  if (first < 0) throw new SourceExtractionError();

  const content = juntarContinuacoes(
    lines.slice(first),
    (line) => reconhecer(line) !== undefined,
  ).join('\n');

  if (content.trim().length === 0) throw new SourceExtractionError();
  return content;
};

const successfulReport = (
  tree: IdentifiedNormaAST,
  linesRead: number,
): ResultadoDoPipeline['relatorio'] => {
  let devices = 0;
  let revoked = 0;
  let review = 0;
  percorrer(
    tree,
    ({ no }) => {
      if (no['tipo'] !== 'lei') devices += 1;
      if (no['deviceStatus'] === 'revoked') revoked += 1;
      const evidence = no['parseEvidence'];
      if (
        typeof evidence === 'object' &&
        evidence !== null &&
        (evidence as { requiresHumanReview?: unknown }).requiresHumanReview === true
      ) {
        review += 1;
      }
    },
    () => undefined,
  );

  return {
    ok: true,
    etapaFinal: 'formatacao',
    problemas: [],
    metricas: {
      linhasLidas: linesRead,
      artigos: tree.totalArtigos,
      dispositivos: devices,
      blockIdsAtribuidos: contarBlockIds(tree),
      dispositivosRevogados: revoked,
      nosExigindoRevisaoHumana: review,
    },
  };
};

const processHtmlSourceSet = (
  loaded: readonly LoadedArtifact[],
  displayName: string,
  date: string,
): ResultadoDoPipeline => {
  const primary = loaded.find(({ record }) => record.sourceRole === 'primary_current');
  if (primary === undefined) throw new SourceExtractionError();

  const parsed = loaded.map(({ record, original, content }) => {
    const result = analisar({
      conteudo: content,
      referenciaBase: {
        sourceType: 'planalto_html',
        sourceRole: record.sourceRole,
        sourceVariant: record.sourceVariant,
        sourceArtifactSha256: record.sourceArtifactSha256,
        fragmentSha256: record.sourceArtifactSha256,
      },
      hashDaLinha: sha256,
      metadados: metadataFor(original, displayName, 'text/html', date, record.finalUrl),
    });
    return { record, content, result };
  });
  const failedParsing = parsed.find(({ result }) => !result.ok);
  if (failedParsing !== undefined && !failedParsing.result.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'parsing',
        problemas: situarProblemas('parsing', failedParsing.result.problemas),
      },
    };
  }
  const primaryParsed = parsed.find(
    ({ record }) => record.sourceArtifactSha256 === primary.record.sourceArtifactSha256,
  )?.result;
  if (!primaryParsed?.ok) throw new SourceExtractionError();
  const auxiliaries = parsed.flatMap(({ record, result }) =>
    record.sourceRole !== 'primary_current' && result.ok ? [result.valor] : [],
  );
  const merged = mesclarFontes(primaryParsed.valor, auxiliaries);
  if (!merged.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'parsing',
        problemas: situarProblemas('parsing', merged.problemas),
      },
    };
  }
  const identified = identificar(merged.valor, merged.valor.sigla, {
    permitirBaixaConfianca: true,
  });
  if (!identified.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'identificacao',
        problemas: situarProblemas('identificacao', identified.problemas),
      },
    };
  }
  const valid = validarIdentifiedNormaAst(identified.valor);
  if (!valid.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'validacao',
        problemas: situarProblemas('validacao', valid.problemas),
      },
    };
  }
  const formatted = formatar(valid.valor);
  if (!formatted.ok) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'formatacao',
        problemas: situarProblemas('formatacao', formatted.problemas),
      },
    };
  }
  const canonicalProblems = validarMarkdownCanonico(formatted.valor, valid.valor);
  if (canonicalProblems.length > 0) {
    return {
      relatorio: {
        ok: false,
        etapaFinal: 'formatacao',
        problemas: situarProblemas('formatacao', canonicalProblems),
      },
    };
  }

  return {
    arvore: valid.valor,
    markdown: formatted.valor,
    relatorio: successfulReport(valid.valor, primary.content.split('\n').length),
  };
};

const childLabel = (node: Record<string, unknown>): string => {
  const number = typeof node['numero'] === 'string' ? node['numero'] : '';
  const stringField = (key: string): string => (typeof node[key] === 'string' ? node[key] : '');

  switch (node['tipo']) {
    case 'artigo':
      return `Art. ${number}`;
    case 'paragrafo':
      return number === 'unico' ? 'Parágrafo único' : `§ ${number}º`;
    case 'inciso':
      return number.toLocaleUpperCase('pt-BR');
    case 'alinea':
      return `${stringField('letra')})`;
    case 'item':
      return `${number}.`;
    case 'pena':
      return 'Pena';
    case 'anexo':
      return `Anexo ${number}`.trim();
    case 'tabela':
      return `Tabela ${number}`.trim();
    default:
      return `${stringField('tipo')}${number.length > 0 ? ` ${number}` : ''}`;
  }
};

const childText = (node: Record<string, unknown>): string => {
  if (node['tipo'] === 'artigo') return typeof node['caput'] === 'string' ? node['caput'] : '';
  if (node['tipo'] === 'tabela') return typeof node['caption'] === 'string' ? node['caption'] : '';
  if (typeof node['texto'] === 'string') return node['texto'];
  return typeof node['titulo'] === 'string' ? node['titulo'] : '';
};

const mapProblem = (problem: ProblemaDeEtapa): DiagnosticDto => ({
  diagnosticId: randomUUID(),
  severity: 'error',
  code: `${problem.etapa}_${problem.codigo}`.replace(/[^a-z0-9_]/gu, '_').slice(0, 80),
  message: problem.mensagem.slice(0, DESKTOP_IMPORT_LIMITS.maxDiagnosticMessageCharacters),
  blocksExport: true,
  previewNodeId: null,
  blockId: null,
  sourceRange: null,
});

export const createLocalProjectService = ({
  storageRoot,
  dialog,
  getMainWindow,
  sendProgress,
  now = () => new Date(),
  networkPorts,
}: LocalProjectServiceOptions): DesktopImportIpcCapabilities => {
  const sources = new Map<string, SourceRecord>();
  const projects = new Map<string, ProjectRecord>();
  const jobs = new Map<string, JobRecord>();
  const destinations = new Map<
    string,
    Readonly<{ projectId: string; path: string; projectionProfile: ContentProjectionProfile }>
  >();
  const batchDestinations = new Map<
    string,
    Readonly<{ projectIds: readonly string[]; rootPath: string }>
  >();
  const cursors = new Map<string, CursorRecord>();
  const referencePreviewCache = new Map<
    string,
    Omit<LegalReferencePreviewDto, 'referenceId' | 'external'>
  >();
  const editorialStore = createEditorialProjectStore(storageRoot);

  const persistArtifact = async (
    sourceId: string,
    bytes: Buffer,
    extension: '.html' | '.md',
    details: Omit<SourceArtifactRecord, 'snapshotPath' | 'sourceArtifactSha256'>,
  ): Promise<SourceArtifactRecord> => {
    const digest = sha256(bytes);
    const snapshotDirectory = join(storageRoot, 'sources', sourceId);
    const snapshotPath = join(
      snapshotDirectory,
      `${details.sourceArtifactId}-${digest}${extension}`,
    );
    await mkdir(snapshotDirectory, { recursive: true, mode: 0o700 });
    const snapshotFile = await open(snapshotPath, 'wx', 0o600);
    try {
      await snapshotFile.writeFile(bytes);
      await snapshotFile.sync();
    } finally {
      await snapshotFile.close();
    }
    return { ...details, sourceArtifactSha256: digest, snapshotPath };
  };

  const emit = (job: JobRecord, value: Omit<ProgressDto, 'jobId' | 'projectId' | 'sequence'>) => {
    job.sequence += 1;
    sendProgress({ ...value, jobId: job.jobId, projectId: job.projectId, sequence: job.sequence });
  };

  const projectOrThrow = (projectId: string): ProjectRecord => {
    const project = projects.get(projectId);
    if (project === undefined) throw new Error('Project is not authorized.');
    return project;
  };

  const makePage = (
    project: ProjectRecord,
    parentPreviewNodeId: string | null,
    cursor: string | null,
    limit: number,
  ): PreviewPageDto => {
    const ids =
      parentPreviewNodeId === null
        ? project.roots
        : (project.nodes.get(parentPreviewNodeId)?.children ?? []);
    const saved = cursor === null ? undefined : cursors.get(cursor);
    if (
      cursor !== null &&
      (saved?.projectId !== project.projectId ||
        saved.kind !== 'preview' ||
        saved.parentPreviewNodeId !== parentPreviewNodeId)
    ) {
      throw new Error('Cursor is not authorized.');
    }
    const offset = saved?.offset ?? 0;
    const items = ids
      .slice(offset, offset + limit)
      .map((id) => project.nodes.get(id)?.dto)
      .filter((item): item is PreviewNodeDto => item !== undefined);
    const nextOffset = offset + items.length;
    let nextCursor: string | null = null;
    if (nextOffset < ids.length) {
      nextCursor = randomUUID().replace(/-/gu, '');
      cursors.set(nextCursor, {
        projectId: project.projectId,
        kind: 'preview',
        parentPreviewNodeId,
        offset: nextOffset,
      });
    }
    return { items, nextCursor, totalItems: ids.length };
  };

  const editorialProjectOrThrow = (
    projectId: string,
  ): ProjectRecord & { ast: IdentifiedNormaAST; journal: EditorialJournal } => {
    const project = projectOrThrow(projectId);
    if (project.ast === undefined || project.journal === undefined) {
      throw new Error('Editorial project is not ready.');
    }
    return project as ProjectRecord & { ast: IdentifiedNormaAST; journal: EditorialJournal };
  };

  const rebuildProjection = (project: ProjectRecord, ast: IdentifiedNormaAST): void => {
    const canonical = formatar(ast, 'complete_with_history');
    if (
      !canonical.ok ||
      validarMarkdownCanonico(canonical.valor, ast, 'complete_with_history').length > 0
    ) {
      throw new Error('Editorial revision cannot be formatted canonically.');
    }
    const projection = projectContent(ast, project.projectionProfile);
    if (!projection.ok) {
      throw new Error('The selected content projection is not available.');
    }
    const projectedAst = projection.valor.ast;
    const referencesByBlockId = new Map<string, LegalReference[]>();
    for (const reference of project.referenceIndex?.references ?? []) {
      const references = referencesByBlockId.get(reference.sourceBlockId) ?? [];
      references.push(reference);
      referencesByBlockId.set(reference.sourceBlockId, references);
    }
    const nodes = new Map<string, PreviewRecord>();
    const roots: string[] = [];
    const build = (
      node: NormaChildNode<unknown, unknown>,
      parent: string | null,
      depth: number,
      order: number,
    ): string => {
      const previewNodeId = randomUUID();
      const children = node.children.map((child, index) =>
        build(child as NormaChildNode<unknown, unknown>, previewNodeId, depth + 1, index),
      );
      const record = node as unknown as Record<string, unknown>;
      const source = node.sourceRef;
      const plainText = childText(record).slice(0, DESKTOP_IMPORT_LIMITS.maxPlainTextCharacters);
      const blockId = typeof record['blockId'] === 'string' ? record['blockId'] : null;
      const sourceField = node.tipo === 'artigo' ? 'caput' : 'texto';
      const dto: PreviewNodeDto = {
        previewNodeId,
        parentPreviewNodeId: parent,
        nodeKind: node.tipo,
        depth,
        order,
        label: childLabel(record).slice(0, DESKTOP_IMPORT_LIMITS.maxLabelCharacters),
        plainText,
        blockId,
        deviceStatus:
          typeof record['deviceStatus'] === 'string'
            ? (record['deviceStatus'] as PreviewNodeDto['deviceStatus'])
            : null,
        hasChildren: children.length > 0,
        childCount: children.length,
        histories: Array.isArray(record['redacoesAnteriores'])
          ? (record['redacoesAnteriores'] as { texto: string; nota?: string }[])
              .slice(0, DESKTOP_IMPORT_LIMITS.maxHistoriesPerNode)
              .map((history) => ({ plainText: history.texto, note: history.nota ?? null }))
          : [],
        legalReferences: (blockId === null ? [] : (referencesByBlockId.get(blockId) ?? []))
          .filter(
            (reference) =>
              reference.sourceField === sourceField &&
              reference.span.end <= plainText.length &&
              plainText.slice(reference.span.start, reference.span.end) === reference.span.text,
          )
          .slice(0, DESKTOP_IMPORT_LIMITS.maxLegalReferencesPerNode)
          .map((reference) => ({
            referenceId: reference.referenceId,
            state: reference.state,
            severity: reference.severity,
            start: reference.span.start,
            end: reference.span.end,
            label: reference.span.text,
          })),
        sourceRange:
          source.rawStartLine === undefined || source.rawEndLine === undefined
            ? null
            : {
                sourceArtifactId: project.source.primary.sourceArtifactId,
                startLine: source.rawStartLine,
                endLine: source.rawEndLine,
              },
      };
      nodes.set(previewNodeId, { dto, children, domainNodeId: node.id });
      return previewNodeId;
    };
    roots.push(...projectedAst.children.map((node, index) => build(node, null, 0, index)));
    const document: PreviewDocumentDto = {
      projectId: project.projectId,
      projectionProfile: project.projectionProfile,
      source: project.source.summary,
      title: projectedAst.titulo.slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
      sigla: projectedAst.sigla,
      legalStatus: projectedAst.legalStatus,
      totalArticles: projectedAst.totalArtigos,
      totalPreviewNodes: nodes.size,
      metadata: [
        ['title', projectedAst.titulo],
        ['sigla', projectedAst.sigla],
        ['tipo', projectedAst.tipoNorma],
        ['numero', projectedAst.numero],
        ['ano', projectedAst.ano],
        ['ramo', projectedAst.ramo],
        ['fonte', projectedAst.fonte],
        ['data_publicacao', projectedAst.dataPublicacao],
        ['data_atualizacao_legal', projectedAst.dataAtualizacaoLegal],
        ['data_formatacao_vinculex', projectedAst.dataFormatacaoVinculex],
        ['total_artigos', projectedAst.totalArtigos],
        ['versao_vinculex', projectedAst.versaoVinculex],
        ['legal_status', projectedAst.legalStatus],
        ['tags', projectedAst.tags ?? []],
      ].map(([key, value]) => ({ key, value })) as PreviewDocumentDto['metadata'],
      callouts: [
        {
          calloutKind: 'info',
          title: 'Fonte oficial',
          plainText: `${String(project.source.artifacts.length)} snapshot(s) verificado(s): ${project.source.summary.displayName}.`,
        },
        {
          calloutKind: 'caution',
          title: 'Aviso de segurança jurídica',
          plainText: 'Confirme o conteúdo na fonte oficial antes de uso jurídico.',
        },
        ...(projectedAst.notasEditoriais ?? []).slice(0, 8).map((note) => ({
          calloutKind: 'note' as const,
          title: 'Nota editorial',
          plainText: note,
        })),
      ],
    };
    const firstRoot = roots[0] === undefined ? undefined : nodes.get(roots[0]);
    const diagnostics: DiagnosticDto[] = [
      ...(firstRoot === undefined
        ? []
        : [
            {
              diagnosticId: randomUUID(),
              severity: 'info' as const,
              code: 'preview_projection_ready',
              message: 'Snapshot verificado e projetado no preview sanitizado.',
              blocksExport: false,
              previewNodeId: firstRoot.dto.previewNodeId,
              blockId: firstRoot.dto.blockId,
              sourceRange: firstRoot.dto.sourceRange,
            },
          ]),
      ...[...nodes.values()]
        .filter(({ dto }) => dto.deviceStatus === 'revoked' || dto.deviceStatus === 'vetoed')
        .slice(0, 500)
        .map(({ dto }) => ({
          diagnosticId: randomUUID(),
          severity: 'info' as const,
          code: `device_${dto.deviceStatus ?? 'unknown'}`,
          message: `${dto.label}: estado jurídico ${dto.deviceStatus === 'revoked' ? 'revogado' : 'vetado'}.`,
          blocksExport: false,
          previewNodeId: dto.previewNodeId,
          blockId: dto.blockId,
          sourceRange: dto.sourceRange,
        })),
      ...[...nodes.values()].flatMap(({ dto }) =>
        dto.legalReferences
          .filter(
            (reference) => reference.state === 'unresolved' || reference.state === 'ambiguous',
          )
          .slice(0, 100)
          .map((reference) => ({
            diagnosticId: randomUUID(),
            severity: reference.severity,
            code:
              reference.state === 'ambiguous'
                ? 'legal_reference_ambiguous'
                : 'legal_reference_unresolved',
            message:
              reference.state === 'ambiguous'
                ? `A referência “${reference.label}” possui mais de um destino possível.`
                : `A referência “${reference.label}” ainda não possui destino importado.`,
            blocksExport: false,
            previewNodeId: dto.previewNodeId,
            blockId: dto.blockId,
            sourceRange: dto.sourceRange,
          })),
      ),
    ];
    project.markdown = canonical.valor;
    project.nodes.clear();
    for (const [previewNodeId, record] of nodes) project.nodes.set(previewNodeId, record);
    project.roots.splice(0, project.roots.length, ...roots);
    project.document = document;
    project.diagnostics = diagnostics;
    for (const [cursor, record] of cursors) {
      if (record.projectId === project.projectId) cursors.delete(cursor);
    }
  };

  const previewRecordForDomainNode = (
    project: ProjectRecord,
    nodeId: string,
  ): PreviewRecord | undefined =>
    [...project.nodes.values()].find((record) => record.domainNodeId === nodeId);

  const refreshLegalReferences = (changedProjectId: string): void => {
    const readyProjects = [...projects.values()].filter(
      (project): project is ProjectRecord & { ast: IdentifiedNormaAST } =>
        project.ast !== undefined,
    );
    const latestProjectByIdentity = new Map<string, (typeof readyProjects)[number]>();
    for (const project of readyProjects) {
      latestProjectByIdentity.set(
        legalNormIdentityKey({
          tipoNorma: project.ast.tipoNorma,
          numero: project.ast.numero,
          ano: project.ast.ano,
        }),
        project,
      );
    }
    const catalogResult = createLegalNormCatalog(
      [...latestProjectByIdentity.values()].map(({ ast }) => ({
        ast,
        aliases: conventionalLegalAliases(ast),
      })),
      { sha256 },
    );
    if (!catalogResult.ok) throw new Error('The local legal norm catalog is invalid.');

    const changedProject = readyProjects.find(({ projectId }) => projectId === changedProjectId);
    if (changedProject === undefined) throw new Error('Changed legal project is unavailable.');
    const changedIdentityKey = legalNormIdentityKey({
      tipoNorma: changedProject.ast.tipoNorma,
      numero: changedProject.ast.numero,
      ano: changedProject.ast.ano,
    });
    const changedAliases = new Set(
      catalogResult.valor.entries
        .find(({ canonicalKey }) => canonicalKey === changedIdentityKey)
        ?.aliases.map(({ normalized }) => normalized) ?? [],
    );

    const changedProjects: (ProjectRecord & { ast: IdentifiedNormaAST })[] = [];
    for (const project of readyProjects) {
      const mustResolve =
        project.projectId === changedProjectId ||
        project.referenceIndex === undefined ||
        project.referenceIndex.references.some((reference) =>
          reference.state === 'resolved'
            ? legalNormIdentityKey(reference.target.law) === changedIdentityKey
            : reference.locator.scope === 'external_law' &&
              changedAliases.has(normalizeLegalNormAlias(reference.locator.lawMention)),
        );
      if (!mustResolve) continue;
      const revisionHash = calculateRevisionHash(project.ast, sha256);
      if (project.detectedReferenceIndex?.revisionHash !== revisionHash) {
        const detected = detectLegalReferences(project.ast, { sha256 });
        if (!detected.ok) throw new Error('Legal references could not be detected.');
        project.detectedReferenceIndex = detected.valor;
      }
      const resolved = resolveLegalReferences(
        {
          sourceAst: project.ast,
          index: project.detectedReferenceIndex,
          catalog: catalogResult.valor,
        },
        { sha256 },
      );
      if (!resolved.ok) throw new Error('Legal references could not be resolved.');
      const nextDigest = sha256(JSON.stringify(resolved.valor.references));
      if (project.referenceIndexDigest !== nextDigest) changedProjects.push(project);
      project.referenceIndex = resolved.valor;
      project.referenceIndexDigest = nextDigest;
    }

    if (changedProjects.length > 0) referencePreviewCache.clear();
    for (const project of changedProjects) rebuildProjection(project, project.ast);
  };

  const resolvedReferenceOrThrow = (
    projectId: string,
    referenceId: string,
  ): Readonly<{
    sourceProject: ProjectRecord & { ast: IdentifiedNormaAST };
    reference: Extract<LegalReference, { state: 'resolved' }>;
    targetProject: ProjectRecord & { ast: IdentifiedNormaAST };
    targetRecord: PreviewRecord;
    external: boolean;
  }> => {
    const sourceProject = projectOrThrow(projectId);
    if (sourceProject.ast === undefined || sourceProject.referenceIndex === undefined) {
      throw new Error('Legal reference index is not ready.');
    }
    const reference = sourceProject.referenceIndex.references.find(
      (candidate) => candidate.referenceId === referenceId,
    );
    if (reference?.state !== 'resolved') throw new Error('Legal reference is not resolved.');
    const targetIdentityKey = legalNormIdentityKey(reference.target.law);
    const targetProject = [...projects.values()].find(
      (candidate): candidate is ProjectRecord & { ast: IdentifiedNormaAST } =>
        candidate.ast !== undefined &&
        legalNormIdentityKey({
          tipoNorma: candidate.ast.tipoNorma,
          numero: candidate.ast.numero,
          ano: candidate.ast.ano,
        }) === targetIdentityKey &&
        calculateRevisionHash(candidate.ast, sha256) === reference.target.revisionHash,
    );
    if (targetProject === undefined) throw new Error('Legal reference target is unavailable.');
    const targetRecord = [...targetProject.nodes.values()].find(
      ({ dto }) => dto.blockId === reference.target.blockId,
    );
    if (targetRecord === undefined) {
      throw new Error('Legal reference target is not available in the selected projection.');
    }
    const sourceIdentityKey = legalNormIdentityKey({
      tipoNorma: sourceProject.ast.tipoNorma,
      numero: sourceProject.ast.numero,
      ano: sourceProject.ast.ano,
    });
    return {
      sourceProject: sourceProject as ProjectRecord & { ast: IdentifiedNormaAST },
      reference,
      targetProject,
      targetRecord,
      external: sourceIdentityKey !== targetIdentityKey,
    };
  };

  const legalPathFor = (project: ProjectRecord, record: PreviewRecord): string => {
    const labels: string[] = [];
    let current: PreviewRecord | undefined = record;
    while (current !== undefined && labels.length <= DESKTOP_IMPORT_LIMITS.maxTreeDepth) {
      labels.unshift(current.dto.label);
      current =
        current.dto.parentPreviewNodeId === null
          ? undefined
          : project.nodes.get(current.dto.parentPreviewNodeId);
    }
    return labels.join(' › ').slice(0, DESKTOP_IMPORT_LIMITS.maxLabelCharacters);
  };

  const legalReferencePreview = (
    projectId: string,
    referenceId: string,
  ): LegalReferencePreviewDto => {
    const resolved = resolvedReferenceOrThrow(projectId, referenceId);
    const cacheKey = `${resolved.reference.target.revisionHash}:${resolved.reference.target.blockId}`;
    let cached = referencePreviewCache.get(cacheKey);
    if (cached === undefined) {
      const document = resolved.targetProject.document;
      if (document === undefined) throw new Error('Legal reference target preview is not ready.');
      cached = {
        targetTitle: document.title,
        targetSigla: document.sigla,
        targetLegalPath: legalPathFor(resolved.targetProject, resolved.targetRecord),
        targetDeviceStatus: resolved.targetRecord.dto.deviceStatus,
        targetPlainText: resolved.targetRecord.dto.plainText,
      };
      referencePreviewCache.set(cacheKey, cached);
    }
    return { referenceId, ...cached, external: resolved.external };
  };

  const legalReferenceNavigation = (
    projectId: string,
    referenceId: string,
  ): LegalReferenceNavigationDto => {
    const resolved = resolvedReferenceOrThrow(projectId, referenceId);
    return {
      targetProjectId: resolved.targetProject.projectId,
      targetPreviewNodeId: resolved.targetRecord.dto.previewNodeId,
      external: resolved.external,
    };
  };

  const runValidation = (
    project: ProjectRecord & { ast: IdentifiedNormaAST; journal: EditorialJournal },
    mode: 'incremental' | 'full',
    changedNodeIds: readonly string[] = [],
  ): EditorialValidationReport => {
    const revisionHash = calculateRevisionHash(project.ast, sha256);
    const report = runEditorialValidation(project.ast, {
      mode,
      journalSequence: project.journal.entries.length,
      validatedAt: now().toISOString(),
      sha256,
      changedNodeIds,
      ...(project.markdown === undefined ? {} : { renderedMarkdown: project.markdown }),
      confirmedWarningFingerprints: collectConfirmedWarningFingerprints(
        project.journal,
        revisionHash,
      ),
    });
    project.validation = report;
    return report;
  };

  const editorialState = (
    project: ProjectRecord & { ast: IdentifiedNormaAST; journal: EditorialJournal },
  ): EditorialStateDto => {
    const revisionHash = calculateRevisionHash(project.ast, sha256);
    const sequence = project.journal.entries.length;
    const approvalCurrent =
      project.approval?.revisionHash === revisionHash &&
      project.approval.journalSequence === sequence;
    const diagnostics: EditorialDiagnosticDto[] = (project.validation?.diagnostics ?? []).map(
      (diagnostic) => {
        let diagnosticId = project.editorialDiagnosticIds.get(diagnostic.fingerprint);
        if (diagnosticId === undefined) {
          diagnosticId = randomUUID();
          project.editorialDiagnosticIds.set(diagnostic.fingerprint, diagnosticId);
        }
        const preview =
          diagnostic.location.nodeId === null
            ? undefined
            : previewRecordForDomainNode(project, diagnostic.location.nodeId);
        return {
          diagnosticId,
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
          blocksApproval: diagnostic.blocksApproval,
          blocksExport: diagnostic.blocksExport,
          requiresConfirmation: diagnostic.severity === 'warning',
          confirmed: diagnostic.confirmed,
          previewNodeId: preview?.dto.previewNodeId ?? null,
          blockId: diagnostic.location.blockId,
          sourceRange: preview?.dto.sourceRange ?? null,
        };
      },
    );
    const domainNodes = new Map<string, Record<string, unknown>>();
    percorrer(
      project.ast,
      ({ no }) => {
        if (typeof no['id'] === 'string') domainNodes.set(no['id'], no);
      },
      () => undefined,
    );
    const reviewTargets: EditorialReviewTargetDto[] = [...project.nodes.values()].flatMap(
      (preview) => {
        const node = domainNodes.get(preview.domainNodeId);
        if (node === undefined) return [];
        const evidence = node['parseEvidence'];
        if (typeof evidence !== 'object' || evidence === null) return [];
        const record = evidence as Record<string, unknown>;
        if (record['requiresHumanReview'] !== true) return [];
        return [
          {
            previewNodeId: preview.dto.previewNodeId,
            nodeKind: preview.dto.nodeKind,
            label: preview.dto.label,
            plainText: childText(node).slice(0, DESKTOP_EDITORIAL_LIMITS.maxTextCharacters),
            deviceStatus: preview.dto.deviceStatus,
            confidence:
              record['confidence'] === 'low' || record['confidence'] === 'medium'
                ? record['confidence']
                : 'high',
            confidenceReasons: Array.isArray(record['reasons'])
              ? record['reasons'].filter((reason): reason is string => typeof reason === 'string')
              : [],
            requiresHumanReview: true,
            sourceRange: preview.dto.sourceRange,
          },
        ];
      },
    );
    const validationFresh =
      project.validation?.revisionHash === revisionHash &&
      project.validation.journalSequence === sequence;
    const validationCanApprove = validationFresh && project.validation?.canApprove === true;
    return {
      projectId: project.projectId,
      revisionHash,
      journalSequence: sequence,
      saveState: 'saved',
      validatedAt: project.validation?.validatedAt ?? null,
      validationMode: project.validation?.mode ?? 'not_run',
      validationIsComplete: validationFresh && project.validation?.isComplete === true,
      blockingCount: project.validation?.blockingCount ?? 0,
      warningCount: project.validation?.warningCount ?? 0,
      unconfirmedWarningCount: project.validation?.unconfirmedWarningCount ?? 0,
      reviewApprovalStatus: approvalCurrent
        ? 'approved'
        : project.approvalWasInvalidated
          ? 'invalidated'
          : 'not_approved',
      canApprove: validationCanApprove && !approvalCurrent,
      canExport: validationCanApprove && approvalCurrent,
      diagnostics,
      reviewTargets,
    };
  };

  const operationFieldFor = (
    nodeKind: PreviewNodeDto['nodeKind'],
  ): 'titulo' | 'caput' | 'texto' | 'caption' => {
    if (nodeKind === 'artigo') return 'caput';
    if (nodeKind === 'tabela') return 'caption';
    if (
      ['ato_transitorio', 'livro', 'titulo', 'capitulo', 'secao', 'subsecao', 'anexo'].includes(
        nodeKind,
      )
    ) {
      return 'titulo';
    }
    return 'texto';
  };

  const projectCanExport = (project: ProjectRecord | undefined): boolean =>
    project?.ast !== undefined &&
    project.journal !== undefined &&
    project.validation?.isComplete === true &&
    project.validation.canApprove &&
    project.validation.revisionHash === calculateRevisionHash(project.ast, sha256) &&
    project.validation.journalSequence === project.journal.entries.length &&
    project.approval?.revisionHash === project.validation.revisionHash &&
    project.approval.journalSequence === project.journal.entries.length;

  const applyAndPersist = async (
    project: ProjectRecord & { ast: IdentifiedNormaAST; journal: EditorialJournal },
    command: EditorialCommand,
    changedNodeIds: readonly string[],
  ): Promise<EditorialStateDto> => {
    const applied = applyEditorialCommand(project.ast, command, sha256);
    if (!applied.ok) throw new Error(`Editorial command rejected: ${applied.error.code}`);
    const formatted = formatar(applied.ast);
    if (!formatted.ok || validarMarkdownCanonico(formatted.valor, applied.ast).length > 0) {
      throw new Error('Editorial command produced noncanonical output.');
    }
    const journal = appendEditorialJournalEntry(
      project.journal,
      command,
      applied.revisionHash,
      sha256,
    );
    await editorialStore.saveJournal(journal);
    if (project.approval !== undefined) project.approvalWasInvalidated = true;
    delete project.approval;
    project.ast = applied.ast;
    delete project.detectedReferenceIndex;
    delete project.referenceIndex;
    delete project.referenceIndexDigest;
    project.journal = journal;
    refreshLegalReferences(project.projectId);
    runValidation(project, 'incremental', changedNodeIds);
    return editorialState(project);
  };

  const run = async (job: JobRecord): Promise<void> => {
    const project = projectOrThrow(job.projectId);
    const failIfCancelled = (): void => {
      if (job.cancelled) throw new DOMException('Cancelled', 'AbortError');
    };
    try {
      emit(job, {
        jobStatus: 'running',
        phase: 'snapshot',
        completedUnits: 1,
        totalUnits: 6,
        message: 'Snapshot local preservado',
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      failIfCancelled();
      const loadedBytes = await Promise.all(
        project.source.artifacts.map(async (artifact) => {
          const bytes = await readFile(artifact.snapshotPath);
          if (sha256(bytes) !== artifact.sourceArtifactSha256)
            throw new Error('Snapshot integrity check failed.');
          return { record: artifact, bytes, original: decodeText(bytes) };
        }),
      );
      const primaryBytes = loadedBytes.find(
        ({ record }) => record.sourceArtifactId === project.source.primary.sourceArtifactId,
      );
      if (primaryBytes === undefined) throw new Error('Primary snapshot is unavailable.');
      const original = primaryBytes.original;
      const date = now().toISOString().slice(0, 10);
      emit(job, {
        jobStatus: 'running',
        phase: 'extraction',
        completedUnits: 2,
        totalUnits: 6,
        message: 'Conteúdo da fonte extraído',
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      failIfCancelled();
      let result: ResultadoDoPipeline;
      if (project.source.summary.mediaType === 'text/html') {
        const loaded = await Promise.all(
          loadedBytes.map(async ({ record, original: artifactOriginal }) => ({
            record,
            original: artifactOriginal,
            content: await extractLegalContent(artifactOriginal, record),
          })),
        );
        result = processHtmlSourceSet(loaded, project.source.summary.displayName, date);
      } else {
        const content = normalizeCanonicalMarkdown(original);
        const metadata = metadataFor(
          original,
          project.source.summary.displayName,
          project.source.summary.mediaType,
          date,
        );
        result = processar({
          conteudo: content,
          referenciaBase: {
            sourceType: 'markdown',
            sourceRole: 'primary_current',
            sourceVariant: 'other',
            sourceArtifactSha256: project.source.summary.sourceArtifactSha256,
            fragmentSha256: project.source.summary.sourceArtifactSha256,
          },
          hashDaLinha: sha256,
          metadados: metadata,
          permitirBaixaConfianca: true,
        });
      }
      emit(job, {
        jobStatus: 'running',
        phase: 'parsing',
        completedUnits: 3,
        totalUnits: 6,
        message: 'Estrutura jurídica analisada',
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      failIfCancelled();
      if (!result.relatorio.ok || result.arvore === undefined || result.markdown === undefined) {
        project.diagnostics = result.relatorio.problemas.map(mapProblem);
        emit(job, {
          jobStatus: 'failed',
          phase: 'parsing',
          completedUnits: 3,
          totalUnits: 6,
          message: 'O pipeline encontrou problemas bloqueantes',
        });
        return;
      }
      emit(job, {
        jobStatus: 'running',
        phase: 'identification',
        completedUnits: 4,
        totalUnits: 6,
        message: 'Block IDs identificados',
      });
      const revisionHash = calculateRevisionHash(result.arvore, sha256);
      const journal: EditorialJournal = {
        schemaVersion: 1,
        journalId: randomUUID(),
        projectId: project.projectId,
        createdAt: now().toISOString(),
        base: { revisionHash, ast: result.arvore },
        entries: [],
      };
      await editorialStore.saveJournal(journal);
      project.ast = result.arvore;
      delete project.detectedReferenceIndex;
      delete project.referenceIndex;
      delete project.referenceIndexDigest;
      project.journal = journal;
      refreshLegalReferences(project.projectId);
      runValidation(
        project as ProjectRecord & { ast: IdentifiedNormaAST; journal: EditorialJournal },
        'full',
      );
      emit(job, {
        jobStatus: 'running',
        phase: 'preview_projection',
        completedUnits: 5,
        totalUnits: 6,
        message: 'Preview sanitizado projetado',
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      failIfCancelled();
      emit(job, {
        jobStatus: 'completed',
        phase: 'formatting',
        completedUnits: 6,
        totalUnits: 6,
        message: 'Documento pronto para revisão e exportação',
      });
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === 'AbortError';
      const unrecognized = error instanceof SourceExtractionError;
      emit(job, {
        jobStatus: cancelled ? 'cancelled' : 'failed',
        phase: 'extraction',
        completedUnits: 0,
        totalUnits: 6,
        message: cancelled
          ? 'Processamento cancelado'
          : unrecognized
            ? 'A fonte não contém uma norma jurídica reconhecível'
            : 'Não foi possível processar a fonte',
      });
    }
  };

  return {
    selectLocal: {
      authorize: () => getMainWindow() !== null,
      handle: async () => {
        const window = getMainWindow();
        if (window === null) throw new Error('Main window is unavailable.');
        const selected = await dialog.showOpenDialog(window, {
          title: 'Selecionar fonte legislativa',
          properties: ['openFile'],
          filters: [{ name: 'HTML ou Markdown', extensions: ['html', 'md'] }],
        });
        const selectedPath = selected.filePaths[0];
        if (selected.canceled || selectedPath === undefined) return null;
        const selectedInfo = await lstat(selectedPath);
        if (selectedInfo.isSymbolicLink()) throw new Error('Symbolic links are not accepted.');
        const resolved = await realpath(selectedPath);
        const extension = extname(resolved).toLocaleLowerCase('en-US');
        const sourceFile = await open(resolved, fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW);
        let bytes: Buffer;
        try {
          const info = await sourceFile.stat();
          if (
            !info.isFile() ||
            info.size > MAX_SOURCE_BYTES ||
            !['.html', '.md'].includes(extension)
          ) {
            throw new Error('Unsupported local source.');
          }
          bytes = await sourceFile.readFile();
        } finally {
          await sourceFile.close();
        }
        const sourceId = randomUUID();
        const mediaType = extension === '.html' ? 'text/html' : 'text/markdown';
        const artifact = await persistArtifact(sourceId, bytes, extension as '.html' | '.md', {
          sourceArtifactId: sourceId,
          finalUrl: `https://local.lex-editor.invalid/snapshot/${encodeURIComponent(basename(resolved))}`,
          sourceRole: 'primary_current',
          sourceVariant:
            mediaType === 'text/html' && /compilad[oa]/iu.test(decodeText(bytes))
              ? 'compiled'
              : 'other',
        });
        const summary: SourceSummaryDto = {
          sourceId,
          sourceKind: extension === '.html' ? 'local_html' : 'local_markdown',
          displayName: basename(resolved).slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
          mediaType,
          byteLength: bytes.byteLength,
          sourceArtifactSha256: artifact.sourceArtifactSha256,
        };
        sources.set(sourceId, { summary, primary: artifact, artifacts: [artifact] });
        return summary;
      },
    },
    importFromUrl: {
      authorize: () => getMainWindow() !== null,
      handle: async ({ url }) => {
        const fetched =
          networkPorts === undefined
            ? await fetchPlanaltoSourceSet(url)
            : await fetchPlanaltoSourceSet(url, networkPorts);
        const sourceId = randomUUID();
        const primaryFetched = fetched.find(({ sourceRole }) => sourceRole === 'primary_current');
        if (primaryFetched === undefined) throw new PlanaltoNetworkError('NETWORK_FAILED');
        const artifacts = await Promise.all(
          fetched.map((item) =>
            persistArtifact(sourceId, item.bytes, '.html', {
              sourceArtifactId: item.sourceRole === 'primary_current' ? sourceId : randomUUID(),
              finalUrl: item.finalUrl,
              sourceRole: item.sourceRole,
              sourceVariant: item.sourceVariant,
            }),
          ),
        );
        const primary = artifacts.find(({ sourceRole }) => sourceRole === 'primary_current');
        if (primary === undefined) throw new PlanaltoNetworkError('NETWORK_FAILED');
        const pathName = basename(new URL(primary.finalUrl).pathname) || 'planalto.html';
        const summary: SourceSummaryDto = {
          sourceId,
          sourceKind: 'planalto_url',
          displayName: pathName.slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
          mediaType: 'text/html',
          byteLength: primaryFetched.bytes.byteLength,
          sourceArtifactSha256: primary.sourceArtifactSha256,
        };
        sources.set(sourceId, { summary, primary, artifacts });
        return summary;
      },
    },
    startProcessing: {
      authorize: ({ sourceId }) => sources.has(sourceId),
      handle: ({ sourceId }) => {
        const source = sources.get(sourceId);
        if (source === undefined) throw new Error('Source is not authorized.');
        const job: JobRecord = {
          jobId: randomUUID(),
          projectId: randomUUID(),
          cancelled: false,
          sequence: 0,
        };
        jobs.set(job.jobId, job);
        projects.set(job.projectId, {
          projectId: job.projectId,
          source,
          projectionProfile: 'complete_with_history',
          nodes: new Map(),
          roots: [],
          diagnostics: [],
          approvalWasInvalidated: false,
          editorialDiagnosticIds: new Map(),
        });
        setImmediate(() => void run(job));
        return { jobId: job.jobId, projectId: job.projectId };
      },
    },
    cancelJob: {
      authorize: ({ jobId }) => jobs.has(jobId),
      handle: ({ jobId }) => {
        const job = jobs.get(jobId);
        if (job === undefined) throw new Error('Job is not authorized.');
        job.cancelled = true;
        return { jobId, cancelled: true };
      },
    },
    getPreviewDocument: {
      authorize: ({ projectId }) => projects.has(projectId),
      handle: ({ projectId }) => {
        const document = projectOrThrow(projectId).document;
        if (document === undefined) throw new Error('Preview is not ready.');
        return document;
      },
    },
    getPreviewPage: {
      authorize: ({ projectId, parentPreviewNodeId }) => {
        const project = projects.get(projectId);
        return (
          project !== undefined &&
          (parentPreviewNodeId === null || project.nodes.has(parentPreviewNodeId))
        );
      },
      handle: ({ projectId, parentPreviewNodeId, cursor, limit }) =>
        makePage(projectOrThrow(projectId), parentPreviewNodeId, cursor, limit),
    },
    revealPreviewNode: {
      authorize: ({ projectId, previewNodeId }) =>
        projects.get(projectId)?.nodes.has(previewNodeId) === true,
      handle: ({ projectId, previewNodeId }): PreviewNodePathDto => {
        const project = projectOrThrow(projectId);
        const items: PreviewNodeDto[] = [];
        let current: string | null = previewNodeId;
        while (current !== null) {
          const item: PreviewNodeDto | undefined = project.nodes.get(current)?.dto;
          if (item === undefined) throw new Error('Preview node is not authorized.');
          items.unshift(item);
          current = item.parentPreviewNodeId;
        }
        return { items };
      },
    },
    setPreviewProjectionProfile: {
      authorize: ({ projectId }) => {
        const project = projects.get(projectId);
        return project?.ast !== undefined && project.document !== undefined;
      },
      handle: async ({ projectId, projectionProfile }): Promise<ProjectionPreferenceDto> => {
        const project = editorialProjectOrThrow(projectId);
        const preflight = projectContent(project.ast, projectionProfile);
        if (!preflight.ok) {
          throw new Error('The selected content projection is not available.');
        }
        const previousProfile = project.projectionProfile;
        await editorialStore.saveProjectionPreference(projectId, projectionProfile);
        if (previousProfile !== projectionProfile) {
          project.projectionProfile = projectionProfile;
          try {
            rebuildProjection(project, project.ast);
          } catch (error) {
            project.projectionProfile = previousProfile;
            rebuildProjection(project, project.ast);
            await editorialStore.saveProjectionPreference(projectId, previousProfile);
            throw error;
          }
        }
        return { projectId, projectionProfile };
      },
    },
    getLegalReference: {
      authorize: ({ projectId }) => projects.has(projectId),
      handle: ({ projectId, referenceId }) => legalReferencePreview(projectId, referenceId),
    },
    navigateLegalReference: {
      authorize: ({ projectId }) => projects.has(projectId),
      handle: ({ projectId, referenceId }) => legalReferenceNavigation(projectId, referenceId),
    },
    getDiagnosticPage: {
      authorize: ({ projectId }) => projects.has(projectId),
      handle: ({ projectId, cursor, limit }): DiagnosticPageDto => {
        const project = projectOrThrow(projectId);
        const saved = cursor === null ? undefined : cursors.get(cursor);
        if (cursor !== null && (saved?.projectId !== projectId || saved.kind !== 'diagnostics'))
          throw new Error('Cursor is not authorized.');
        const offset = saved?.offset ?? 0;
        const items = project.diagnostics.slice(offset, offset + limit);
        const nextOffset = offset + items.length;
        let nextCursor: string | null = null;
        if (nextOffset < project.diagnostics.length) {
          nextCursor = randomUUID().replace(/-/gu, '');
          cursors.set(nextCursor, {
            projectId,
            kind: 'diagnostics',
            parentPreviewNodeId: null,
            offset: nextOffset,
          });
        }
        return { items, nextCursor, totalItems: project.diagnostics.length };
      },
    },
    getEditorialState: {
      authorize: ({ projectId }) => {
        const project = projects.get(projectId);
        return project?.ast !== undefined && project.journal !== undefined;
      },
      handle: ({ projectId }) => editorialState(editorialProjectOrThrow(projectId)),
    },
    correctEditorialText: {
      authorize: ({ projectId, previewNodeId }) =>
        projects.get(projectId)?.nodes.has(previewNodeId) === true,
      handle: async ({ projectId, previewNodeId, value, reason }) => {
        const project = editorialProjectOrThrow(projectId);
        const preview = project.nodes.get(previewNodeId);
        if (preview === undefined) throw new Error('Preview node is not authorized.');
        const command: EditorialCommand = {
          schemaVersion: 1,
          commandId: randomUUID(),
          localActorId: 'editor-local',
          occurredAt: now().toISOString(),
          expectedRevisionHash: calculateRevisionHash(project.ast, sha256),
          operation: {
            kind: 'replace_node_text',
            targetNodeId: preview.domainNodeId,
            field: operationFieldFor(preview.dto.nodeKind),
            value,
            reason,
          },
        };
        return applyAndPersist(project, command, [preview.domainNodeId]);
      },
    },
    confirmEditorialInterpretation: {
      authorize: ({ projectId, previewNodeId }) =>
        projects.get(projectId)?.nodes.has(previewNodeId) === true,
      handle: async ({ projectId, previewNodeId, reason }) => {
        const project = editorialProjectOrThrow(projectId);
        const preview = project.nodes.get(previewNodeId);
        if (preview === undefined) throw new Error('Preview node is not authorized.');
        const command: EditorialCommand = {
          schemaVersion: 1,
          commandId: randomUUID(),
          localActorId: 'editor-local',
          occurredAt: now().toISOString(),
          expectedRevisionHash: calculateRevisionHash(project.ast, sha256),
          operation: {
            kind: 'confirm_parse_interpretation',
            targetNodeId: preview.domainNodeId,
            reason,
          },
        };
        return applyAndPersist(project, command, [preview.domainNodeId]);
      },
    },
    confirmEditorialWarning: {
      authorize: ({ projectId, diagnosticId }) => {
        const project = projects.get(projectId);
        return [...(project?.editorialDiagnosticIds.values() ?? [])].includes(diagnosticId);
      },
      handle: async ({ projectId, diagnosticId, note }) => {
        const project = editorialProjectOrThrow(projectId);
        const fingerprint = [...project.editorialDiagnosticIds.entries()].find(
          ([, id]) => id === diagnosticId,
        )?.[0];
        const diagnostic = project.validation?.diagnostics.find(
          (item) => item.fingerprint === fingerprint,
        );
        if (
          fingerprint === undefined ||
          diagnostic?.severity !== 'warning' ||
          diagnostic.confirmed
        ) {
          throw new Error('Warning is not confirmable.');
        }
        const command: EditorialCommand = {
          schemaVersion: 1,
          commandId: randomUUID(),
          localActorId: 'editor-local',
          occurredAt: now().toISOString(),
          expectedRevisionHash: calculateRevisionHash(project.ast, sha256),
          operation: {
            kind: 'confirm_warning',
            warningCode: diagnostic.code,
            warningFingerprint: diagnostic.fingerprint,
            ...(note === undefined ? {} : { note }),
          },
        };
        await applyAndPersist(
          project,
          command,
          diagnostic.location.nodeId === null ? [] : [diagnostic.location.nodeId],
        );
        runValidation(project, 'full');
        return editorialState(project);
      },
    },
    validateEditorial: {
      authorize: ({ projectId }) => {
        const project = projects.get(projectId);
        return project?.ast !== undefined && project.journal !== undefined;
      },
      handle: ({ projectId }) => {
        const project = editorialProjectOrThrow(projectId);
        runValidation(project, 'full');
        return editorialState(project);
      },
    },
    approveEditorial: {
      authorize: ({ projectId }) => {
        const project = projects.get(projectId);
        return project?.ast !== undefined && project.journal !== undefined
          ? editorialState(
              project as ProjectRecord & {
                ast: IdentifiedNormaAST;
                journal: EditorialJournal;
              },
            ).canApprove
          : false;
      },
      handle: ({ projectId }) => {
        const project = editorialProjectOrThrow(projectId);
        if (project.validation === undefined) throw new Error('Full validation is required.');
        const approved = approveEditorialRevision(
          project.validation,
          randomUUID(),
          'editor-local',
          now().toISOString(),
        );
        if (!approved.ok) throw new Error(`Editorial approval rejected: ${approved.error.code}`);
        project.approval = approved.approval;
        project.approvalWasInvalidated = false;
        return editorialState(project);
      },
    },
    chooseExportDestination: {
      authorize: ({ projectId }) => {
        return projectCanExport(projects.get(projectId));
      },
      handle: async ({ projectId, projectionProfile }) => {
        const window = getMainWindow();
        const project = projectOrThrow(projectId);
        if (window === null || project.document === undefined || project.ast === undefined)
          throw new Error('Project is not ready.');
        const formatted = formatar(project.ast, projectionProfile);
        if (
          !formatted.ok ||
          validarMarkdownCanonico(formatted.valor, project.ast, projectionProfile).length > 0
        ) {
          throw new Error('The selected content projection cannot be exported.');
        }
        const selected = await dialog.showSaveDialog(window, {
          title: 'Exportar Markdown projetado',
          defaultPath: `${project.document.sigla}-${projectionProfile === 'current_only' ? 'vigente' : 'completa'}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (selected.canceled || selected.filePath === undefined) return null;
        const destinationId = randomUUID();
        const path = selected.filePath.toLocaleLowerCase('en-US').endsWith('.md')
          ? selected.filePath
          : `${selected.filePath}.md`;
        destinations.set(destinationId, { projectId, path, projectionProfile });
        return {
          destinationId,
          displayName: basename(path).slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
        };
      },
    },
    writeExport: {
      authorize: ({ projectId, destinationId }) =>
        destinations.get(destinationId)?.projectId === projectId &&
        projectCanExport(projects.get(projectId)),
      handle: async ({ projectId, destinationId }): Promise<ExportResultDto> => {
        const project = projectOrThrow(projectId);
        const destination = destinations.get(destinationId);
        if (destination === undefined || project.ast === undefined)
          throw new Error('Destination is not authorized.');
        const formatted = formatar(project.ast, destination.projectionProfile);
        if (
          !formatted.ok ||
          validarMarkdownCanonico(formatted.valor, project.ast, destination.projectionProfile)
            .length > 0
        ) {
          throw new Error('The selected content projection cannot be exported.');
        }
        const bytes = Buffer.from(formatted.valor, 'utf8');
        const tempPath = join(
          dirname(destination.path),
          `.${basename(destination.path)}.${randomUUID()}.tmp`,
        );
        let file: Awaited<ReturnType<typeof open>> | undefined;
        try {
          file = await open(tempPath, 'wx', 0o600);
          await file.writeFile(bytes);
          await file.sync();
          await file.close();
          file = undefined;
          await rename(tempPath, destination.path);
        } catch (error) {
          await file?.close().catch(() => undefined);
          await unlink(tempPath).catch(() => undefined);
          throw error;
        }
        destinations.delete(destinationId);
        return {
          projectId,
          destinationId,
          projectionProfile: destination.projectionProfile,
          fileName: basename(destination.path),
          byteLength: bytes.byteLength,
          markdownSha256: sha256(bytes),
        };
      },
    },
    chooseBatchExportDestination: {
      authorize: ({ projectIds }) => projectIds.every((projectId) => projects.has(projectId)),
      handle: async ({ projectIds }) => {
        const window = getMainWindow();
        if (window === null) throw new Error('Main window is not available.');
        const selected = await dialog.showOpenDialog(window, {
          title: 'Escolher pasta para exportação em lote',
          properties: ['openDirectory'],
        });
        const selectedPath = selected.filePaths[0];
        if (selected.canceled || selectedPath === undefined) return null;
        const info = await lstat(selectedPath);
        if (info.isSymbolicLink() || !info.isDirectory()) {
          throw new Error('Batch destination must be a real directory.');
        }
        const rootPath = await realpath(selectedPath);
        const destinationId = randomUUID();
        batchDestinations.set(destinationId, { projectIds: [...projectIds], rootPath });
        return {
          destinationId,
          displayName: basename(rootPath).slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
        };
      },
    },
    writeBatchExport: {
      authorize: ({ destinationId }) => batchDestinations.has(destinationId),
      handle: async ({ destinationId }): Promise<BatchExportResultDto> => {
        const destination = batchDestinations.get(destinationId);
        if (destination === undefined) throw new Error('Batch destination is not authorized.');
        batchDestinations.delete(destinationId);

        const rootInfo = await lstat(destination.rootPath);
        if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
          throw new Error('Batch destination changed after authorization.');
        }
        const rootReal = await realpath(destination.rootPath);
        if (rootReal !== destination.rootPath) {
          throw new Error('Batch destination changed after authorization.');
        }
        const lawsRoot = join(rootReal, 'leis');
        try {
          await mkdir(lawsRoot, { mode: 0o700 });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'EEXIST') throw error;
          const lawsInfo = await lstat(lawsRoot);
          if (lawsInfo.isSymbolicLink() || !lawsInfo.isDirectory()) {
            throw new Error('The laws export root is not a real directory.', { cause: error });
          }
          if ((await realpath(lawsRoot)) !== lawsRoot) {
            throw new Error('The laws export root escapes the selected directory.', {
              cause: error,
            });
          }
        }

        const identities = destination.projectIds.map((projectId) => {
          const project = projects.get(projectId);
          const fallback = `projeto-${projectId.slice(0, 8)}`;
          return {
            projectId,
            project,
            title: project?.document?.title ?? 'Projeto sem preview',
            sigla: slugifyExportName(project?.document?.sigla ?? '', fallback),
            directoryName: slugifyExportName(project?.document?.title ?? '', fallback),
          };
        });
        const targetCounts = new Map<string, number>();
        for (const identity of identities) {
          targetCounts.set(
            identity.directoryName,
            (targetCounts.get(identity.directoryName) ?? 0) + 1,
          );
        }

        const fail = (
          identity: (typeof identities)[number],
          errorCode: BatchExportFailureCode,
        ): BatchExportItemResultDto => ({
          projectId: identity.projectId,
          title: identity.title.slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
          sigla: identity.sigla,
          batchExportStatus: 'failed',
          errorCode,
        });

        const results = await Promise.all(
          identities.map(async (identity): Promise<BatchExportItemResultDto> => {
            const project = identity.project;
            if (
              project?.ast === undefined ||
              project.markdown === undefined ||
              project.document === undefined
            ) {
              return fail(identity, 'NOT_READY');
            }
            if (!projectCanExport(project)) return fail(identity, 'NOT_APPROVED');
            if ((targetCounts.get(identity.directoryName) ?? 0) > 1) {
              return fail(identity, 'DUPLICATE_TARGET');
            }

            const targetDirectory = join(lawsRoot, identity.directoryName);
            try {
              await lstat(targetDirectory);
              return fail(identity, 'TARGET_CONFLICT');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                return fail(identity, 'FILESYSTEM_FAILED');
              }
            }

            const stageDirectory = join(lawsRoot, `.${identity.directoryName}.${randomUUID()}.tmp`);
            try {
              await mkdir(stageDirectory, { mode: 0o700 });
              const markdownBytes = Buffer.from(project.markdown, 'utf8');
              const updateMarkdown = generateUpdateMarkdown([
                {
                  publicationDate: now().toISOString().slice(0, 10),
                  version: project.ast.versaoVinculex,
                  publicationNumber: 1,
                  kind: 'initial',
                  sourceSummary: safeSourceSummary(
                    `Importação de ${project.source.summary.displayName} conferida em fonte oficial.`,
                  ),
                  changes: deriveStructuredChanges(null, project.ast),
                },
              ]);
              const updateBytes = Buffer.from(updateMarkdown, 'utf8');
              const markdownFileName = `${identity.sigla}.md`;
              const files = [
                { path: join(stageDirectory, markdownFileName), bytes: markdownBytes },
                { path: join(stageDirectory, 'UPDATE.md'), bytes: updateBytes },
              ];
              await Promise.all(
                files.map(async ({ path, bytes }) => {
                  const file = await open(path, 'wx', 0o600);
                  try {
                    await file.writeFile(bytes);
                    await file.sync();
                  } finally {
                    await file.close();
                  }
                }),
              );
              await rename(stageDirectory, targetDirectory);
              return {
                projectId: identity.projectId,
                title: identity.title.slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
                sigla: identity.sigla,
                batchExportStatus: 'succeeded',
                directoryName: identity.directoryName,
                markdownFileName,
                updateFileName: 'UPDATE.md',
                markdownSha256: sha256(markdownBytes),
                updateSha256: sha256(updateBytes),
              };
            } catch {
              await rm(stageDirectory, { recursive: true, force: true }).catch(() => undefined);
              return fail(identity, 'FILESYSTEM_FAILED');
            }
          }),
        );
        const succeeded = results.filter(
          (result) => result.batchExportStatus === 'succeeded',
        ).length;
        return {
          destinationId,
          total: results.length,
          succeeded,
          failed: results.length - succeeded,
          results,
        };
      },
    },
  };
};
