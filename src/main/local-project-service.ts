import { createHash, randomUUID } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises';

import {
  analisar,
  contarBlockIds,
  extrairLinhas,
  formatar,
  identificar,
  juntarContinuacoes,
  mesclarFontes,
  percorrer,
  processar,
  reconhecer,
  situarProblemas,
  validarIdentifiedNormaAst,
  validarMarkdownCanonico,
  type IdentifiedNormaAST,
  type MetadadosDaNorma,
  type NormaChildNode,
  type ProblemaDeEtapa,
  type ResultadoDoPipeline,
  type SourceRole,
  type SourceVariant,
} from '@lex-editor/legal-domain';
import type { BrowserWindow, OpenDialogOptions, SaveDialogOptions } from 'electron';

import {
  DESKTOP_IMPORT_LIMITS,
  type DiagnosticDto,
  type DiagnosticPageDto,
  type ExportResultDto,
  type PreviewDocumentDto,
  type PreviewNodeDto,
  type PreviewNodePathDto,
  type PreviewPageDto,
  type ProgressDto,
  type SourceSummaryDto,
} from '../shared/ipc/import.js';
import type { DesktopImportIpcCapabilities } from './ipc/register.js';
import { defuddleSnapshot, SourceExtractionError } from './import/defuddle.js';
import {
  fetchPlanaltoSourceSet,
  PlanaltoNetworkError,
  type PlanaltoNetworkPorts,
} from './import/planalto-source.js';

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
}>;

interface ProjectRecord {
  readonly projectId: string;
  readonly source: SourceRecord;
  markdown?: string;
  document?: PreviewDocumentDto;
  readonly nodes: Map<string, PreviewRecord>;
  readonly roots: string[];
  diagnostics: DiagnosticDto[];
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

    const withoutList = trimmed.replace(/^-\s+/u, '');
    result.push(withoutList.replace(/\s+\^[a-z0-9-]+$/u, ''));
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
  const identified = identificar(merged.valor, merged.valor.sigla);
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
  const destinations = new Map<string, Readonly<{ projectId: string; path: string }>>();
  const cursors = new Map<string, CursorRecord>();

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
      project.markdown = result.markdown;
      const nodeByDomainId = new Map<string, string>();
      const build = (
        node: NormaChildNode<unknown, unknown>,
        parent: string | null,
        depth: number,
        order: number,
      ): string => {
        const previewNodeId = randomUUID();
        nodeByDomainId.set(node.id, previewNodeId);
        const children = node.children.map((child, index) =>
          build(child as NormaChildNode<unknown, unknown>, previewNodeId, depth + 1, index),
        );
        const record = node as unknown as Record<string, unknown>;
        const source = node.sourceRef;
        const dto: PreviewNodeDto = {
          previewNodeId,
          parentPreviewNodeId: parent,
          nodeKind: node.tipo,
          depth,
          order,
          label: childLabel(record).slice(0, DESKTOP_IMPORT_LIMITS.maxLabelCharacters),
          plainText: childText(record).slice(0, DESKTOP_IMPORT_LIMITS.maxPlainTextCharacters),
          blockId: typeof record['blockId'] === 'string' ? record['blockId'] : null,
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
          sourceRange:
            source.rawStartLine === undefined || source.rawEndLine === undefined
              ? null
              : {
                  sourceArtifactId: project.source.primary.sourceArtifactId,
                  startLine: source.rawStartLine,
                  endLine: source.rawEndLine,
                },
        };
        project.nodes.set(previewNodeId, { dto, children });
        return previewNodeId;
      };
      project.roots.push(
        ...result.arvore.children.map((node, index) => build(node, null, 0, index)),
      );
      const root = result.arvore;
      project.document = {
        projectId: project.projectId,
        source: project.source.summary,
        title: root.titulo.slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
        sigla: root.sigla,
        legalStatus: root.legalStatus,
        totalArticles: root.totalArtigos,
        totalPreviewNodes: project.nodes.size,
        metadata: [
          ['title', root.titulo],
          ['sigla', root.sigla],
          ['tipo', root.tipoNorma],
          ['numero', root.numero],
          ['ano', root.ano],
          ['ramo', root.ramo],
          ['fonte', root.fonte],
          ['data_publicacao', root.dataPublicacao],
          ['data_atualizacao_legal', root.dataAtualizacaoLegal],
          ['data_formatacao_vinculex', root.dataFormatacaoVinculex],
          ['total_artigos', root.totalArtigos],
          ['versao_vinculex', root.versaoVinculex],
          ['legal_status', root.legalStatus],
          ['tags', root.tags ?? []],
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
          ...(root.notasEditoriais ?? []).slice(0, 8).map((note) => ({
            calloutKind: 'note' as const,
            title: 'Nota editorial',
            plainText: note,
          })),
        ],
      };
      const firstRoot =
        project.roots[0] === undefined ? undefined : project.nodes.get(project.roots[0]);
      const projectionDiagnostic: DiagnosticDto[] =
        firstRoot === undefined
          ? []
          : [
              {
                diagnosticId: randomUUID(),
                severity: 'info',
                code: 'preview_projection_ready',
                message: 'Snapshot verificado e projetado no preview sanitizado.',
                blocksExport: false,
                previewNodeId: firstRoot.dto.previewNodeId,
                blockId: firstRoot.dto.blockId,
                sourceRange: firstRoot.dto.sourceRange,
              },
            ];
      project.diagnostics = [
        ...projectionDiagnostic,
        ...[...project.nodes.values()]
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
      ];
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
          nodes: new Map(),
          roots: [],
          diagnostics: [],
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
    chooseExportDestination: {
      authorize: ({ projectId }) => projects.get(projectId)?.markdown !== undefined,
      handle: async ({ projectId }) => {
        const window = getMainWindow();
        const project = projectOrThrow(projectId);
        if (window === null || project.document === undefined)
          throw new Error('Project is not ready.');
        const selected = await dialog.showSaveDialog(window, {
          title: 'Exportar Markdown canônico',
          defaultPath: `${project.document.sigla}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (selected.canceled || selected.filePath === undefined) return null;
        const destinationId = randomUUID();
        const path = selected.filePath.toLocaleLowerCase('en-US').endsWith('.md')
          ? selected.filePath
          : `${selected.filePath}.md`;
        destinations.set(destinationId, { projectId, path });
        return {
          destinationId,
          displayName: basename(path).slice(0, DESKTOP_IMPORT_LIMITS.maxDisplayNameCharacters),
        };
      },
    },
    writeExport: {
      authorize: ({ projectId, destinationId }) =>
        destinations.get(destinationId)?.projectId === projectId &&
        projects.get(projectId)?.markdown !== undefined,
      handle: async ({ projectId, destinationId }): Promise<ExportResultDto> => {
        const project = projectOrThrow(projectId);
        const destination = destinations.get(destinationId);
        if (destination === undefined || project.markdown === undefined)
          throw new Error('Destination is not authorized.');
        const bytes = Buffer.from(project.markdown, 'utf8');
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
          fileName: basename(destination.path),
          byteLength: bytes.byteLength,
          markdownSha256: sha256(bytes),
        };
      },
    },
  };
};
