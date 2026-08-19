import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  analisar,
  applyEditorialCommand,
  calculateRevisionHash,
  decodificarHtmlPlanalto,
  extrairLinhas,
  formatar,
  identificar,
  juntarContinuacoes,
  mesclarFontes,
  percorrer,
  reconhecer,
  validarIdentifiedNormaAst,
  validarMarkdownCanonico,
  type EditorialCommand,
  type IdentifiedNormaAST,
  type MetadadosDaNorma,
  type ParsedNormaAST,
  type SourceReference,
  type SourceRole,
  type SourceType,
  type SourceVariant,
} from '@lex-editor/legal-domain';
import { describe, expect, it } from 'vitest';

const FIXTURES = join(process.cwd(), 'fixtures/legal');
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

type SourceManifest = Readonly<{
  path: string;
  entrada: string;
  url: string;
  sourceRole: SourceRole;
  sourceVariant: SourceVariant;
  snapshotSha256: string;
  entradaSha256: string;
}>;

type LawManifest = MetadadosDaNorma &
  Readonly<{
    sourceType: SourceType;
    sourceRole: SourceRole;
    sourceVariant: SourceVariant;
    snapshotSha256?: Readonly<Record<string, string>>;
    sources?: readonly SourceManifest[];
    mergeDecisions?: string;
  }>;

type MergeDecisions = Readonly<{
  primarySnapshotSha256: string;
  auxiliarySnapshotSha256: string;
  action: 'keep_primary_skip_auxiliary_node';
  reviewedConflicts: readonly string[];
}>;

type LawName = 'l9099' | 'l9605' | 'l10826';

const readManifest = (law: LawName): LawManifest =>
  JSON.parse(readFileSync(join(FIXTURES, law, 'manifesto.json'), 'utf8')) as LawManifest;

const projectSnapshot = (bytes: Buffer): string => {
  const grammar = (line: string) => reconhecer(line.replace(/^~~|~~$/gu, '').trim());
  const lines = juntarContinuacoes(
    extrairLinhas(decodificarHtmlPlanalto(bytes), {
      comecarEm: /^~?~?Art\.?\s*1[.º°o]/u,
      reconhecer: grammar,
    }),
    (line) => grammar(line) !== undefined,
  );
  return `${lines.join('\n')}\n`;
};

const reference = (
  manifest: LawManifest,
  artifactSha256: string,
  source?: SourceManifest,
): SourceReference => ({
  sourceType: manifest.sourceType,
  sourceRole: source?.sourceRole ?? manifest.sourceRole,
  sourceVariant: source?.sourceVariant ?? manifest.sourceVariant,
  sourceUrl: source?.url ?? manifest.fonte,
  sourceArtifactSha256: artifactSha256,
  fragmentSha256: artifactSha256,
});

const parse = (
  manifest: LawManifest,
  content: string,
  artifactSha256: string,
  source?: SourceManifest,
): ParsedNormaAST => {
  const result = analisar({
    conteudo: content,
    referenciaBase: reference(manifest, artifactSha256, source),
    hashDaLinha: sha256,
    metadados: { ...manifest, fonte: source?.url ?? manifest.fonte },
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problemas, null, 2));
  return result.valor;
};

const identifiedLaw = (law: LawName): IdentifiedNormaAST => {
  const manifest = readManifest(law);
  let parsed: ParsedNormaAST;

  if (manifest.sources === undefined) {
    const entry = readFileSync(join(FIXTURES, law, 'entrada.txt'), 'utf8');
    const artifactSha256 = manifest.snapshotSha256?.['snapshot.html'];
    if (artifactSha256 === undefined) throw new Error(`Manifesto sem snapshot de ${law}.`);
    parsed = parse(manifest, entry, artifactSha256);
  } else {
    const sources = manifest.sources.map((source) => ({
      source,
      ast: parse(
        manifest,
        readFileSync(join(FIXTURES, law, source.entrada), 'utf8'),
        source.snapshotSha256,
        source,
      ),
    }));
    const primary = sources.find(({ source }) => source.sourceRole === 'primary_current');
    if (primary === undefined) throw new Error(`Manifesto sem fonte primária de ${law}.`);
    const decisions =
      manifest.mergeDecisions === undefined
        ? undefined
        : (JSON.parse(
            readFileSync(join(FIXTURES, law, manifest.mergeDecisions), 'utf8'),
          ) as MergeDecisions);
    if (
      decisions !== undefined &&
      (decisions.primarySnapshotSha256 !== primary.source.snapshotSha256 ||
        !sources.some(({ source }) => source.snapshotSha256 === decisions.auxiliarySnapshotSha256))
    ) {
      throw new Error(`Decisões de mesclagem obsoletas para ${law}.`);
    }
    const merged = mesclarFontes(
      primary.ast,
      sources
        .filter(({ source }) => source.sourceRole === 'historical_auxiliary')
        .map(({ ast }) => ast),
      decisions === undefined ? {} : { conflitosRevisados: decisions.reviewedConflicts },
    );
    if (!merged.ok) throw new Error(JSON.stringify(merged.problemas, null, 2));
    parsed = merged.valor;
  }

  const result = identificar(parsed, manifest.sigla, { permitirBaixaConfianca: true });
  if (!result.ok) throw new Error(JSON.stringify(result.problemas, null, 2));
  return result.valor;
};

const format = (
  ast: IdentifiedNormaAST,
  profile: 'complete_with_history' | 'current_only',
): string => {
  const result = formatar(ast, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.problemas, null, 2));
  return result.valor;
};

const blockIds = (ast: IdentifiedNormaAST): readonly string[] => {
  const ids: string[] = [];
  percorrer(
    ast,
    ({ no }) => {
      if (typeof no['blockId'] === 'string') ids.push(no['blockId']);
    },
    () => undefined,
  );
  return ids;
};

const writeOrReadGolden = (law: LawName, profile: string, markdown: string): string => {
  const path = join(FIXTURES, law, `${profile}.md`);
  if (process.env['UPDATE_GOLDENS'] === '1') writeFileSync(path, markdown, 'utf8');
  return readFileSync(path, 'utf8');
};

const markdownBody = (markdown: string): string => {
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('Markdown sem frontmatter canônico.');
  return markdown.slice(end + 5);
};

describe('snapshots oficiais offline da Feature 009', () => {
  it.each(['l9099', 'l9605'] as const)('%s preserva hashes e reproduz a entrada', (law) => {
    const manifest = readManifest(law);
    const snapshot = readFileSync(join(FIXTURES, law, 'snapshot.html'));
    const entry = readFileSync(join(FIXTURES, law, 'entrada.txt'), 'utf8');

    expect(sha256(snapshot)).toBe(manifest.snapshotSha256?.['snapshot.html']);
    expect(sha256(entry)).toBe(manifest.snapshotSha256?.['entrada.txt']);
    expect(projectSnapshot(snapshot)).toBe(entry);
  });

  it('l10826 preserva hashes e reproduz as entradas compilada e anotada', () => {
    const manifest = readManifest('l10826');
    expect(manifest.sources).toHaveLength(2);

    for (const source of manifest.sources ?? []) {
      const snapshot = readFileSync(join(FIXTURES, 'l10826', source.path));
      const entry = readFileSync(join(FIXTURES, 'l10826', source.entrada), 'utf8');
      expect(sha256(snapshot)).toBe(source.snapshotSha256);
      expect(sha256(entry)).toBe(source.entradaSha256);
      expect(projectSnapshot(snapshot)).toBe(entry);
    }
  });
});

describe('projeções reais completas e vigentes', () => {
  it.each(['l9099', 'l9605', 'l10826'] as const)(
    '%s gera goldens determinísticos sem alterar a revisão',
    (law) => {
      const ast = identifiedLaw(law);
      const before = structuredClone(ast);
      const complete = format(ast, 'complete_with_history');
      const current = format(ast, 'current_only');

      expect(complete).toBe(writeOrReadGolden(law, 'complete_with_history', complete));
      expect(current).toBe(writeOrReadGolden(law, 'current_only', current));
      expect(format(ast, 'complete_with_history')).toBe(complete);
      expect(format(ast, 'current_only')).toBe(current);
      expect(validarMarkdownCanonico(complete, ast, 'complete_with_history')).toEqual([]);
      expect(validarMarkdownCanonico(current, ast, 'current_only')).toEqual([]);
      expect(validarIdentifiedNormaAst(ast).ok).toBe(true);
      expect(ast).toEqual(before);
      expect(current).toContain('projection_profile: "current_only"');
      expect(current).not.toContain('~~');
      expect(blockIds(ast).every((id) => complete.includes(`^${id}`))).toBe(true);
    },
  );

  it.each(['l9099', 'l9605', 'l10826'] as const)(
    '%s preserva as duas projeções canônicas após edição de frontmatter',
    (law) => {
      const ast = identifiedLaw(law);
      const original = structuredClone(ast);
      const originalComplete = format(ast, 'complete_with_history');
      const originalCurrent = format(ast, 'current_only');
      const reviewedBranch = `${ast.ramo} revisado`;
      const command: EditorialCommand = {
        schemaVersion: 1,
        commandId: '11111111-1111-4111-8111-111111111111',
        localActorId: 'editor-local-real-laws',
        occurredAt: '2026-08-14T12:00:00.000-03:00',
        expectedRevisionHash: calculateRevisionHash(ast, sha256),
        operation: {
          kind: 'set_law_metadata',
          changes: { ramo: reviewedBranch },
          reason: 'Regressão editorial nas leis reais de referência.',
        },
      };

      const applied = applyEditorialCommand(ast, command, sha256);

      expect(applied.ok).toBe(true);
      expect(ast).toEqual(original);
      if (!applied.ok) throw new Error(`Edição de metadados rejeitada para ${law}.`);
      const complete = format(applied.ast, 'complete_with_history');
      const current = format(applied.ast, 'current_only');
      expect(complete).toContain(`ramo: ${JSON.stringify(reviewedBranch)}`);
      expect(current).toContain(`ramo: ${JSON.stringify(reviewedBranch)}`);
      expect(markdownBody(complete)).toBe(markdownBody(originalComplete));
      expect(markdownBody(current)).toBe(markdownBody(originalCurrent));
      expect(validarMarkdownCanonico(complete, applied.ast, 'complete_with_history')).toEqual([]);
      expect(validarMarkdownCanonico(current, applied.ast, 'current_only')).toEqual([]);
      expect(blockIds(applied.ast)).toEqual(blockIds(original));
    },
  );

  it('l9099 dá Block ID somente às redações atuais dos arts. 61 e 62', () => {
    const ast = identifiedLaw('l9099');
    const complete = format(ast, 'complete_with_history');
    const current = format(ast, 'current_only');

    expect(complete.match(/\^l9099-art-61\b/gu)).toHaveLength(1);
    expect(complete.match(/\^l9099-art-62\b/gu)).toHaveLength(1);
    expect(complete).toContain('~~Art. 61. Consideram-se infrações penais');
    expect(complete).toContain('~~Art. 62. O processo perante o Juizado Especial');
    expect(current).not.toContain('pena máxima não superior a um ano');
    expect(current).not.toContain('oralidade, informalidade, economia processual');
    expect(current).toContain('^l9099-art-61');
    expect(current).toContain('^l9099-art-62');
  });

  it('l9605 usa uma única fonte anotada e remove dispositivos sem eficácia', () => {
    const manifest = readManifest('l9605');
    const complete = format(identifiedLaw('l9605'), 'complete_with_history');
    const current = format(identifiedLaw('l9605'), 'current_only');

    expect(manifest.sources).toBeUndefined();
    expect(complete).toMatch(/\^l9605-art-\d+/u);
    expect(complete).toContain('~~');
    expect(current).not.toContain('(VETADO)');
  });

  it('l10826 mantém a compilada como primária e agrega histórico da anotada', () => {
    const ast = identifiedLaw('l10826');
    const complete = format(ast, 'complete_with_history');
    const current = format(ast, 'current_only');

    expect(ast.fonte).toContain('compilado.htm');
    expect(ast.fontesSecundarias).toContain(
      'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.826.htm',
    );
    expect(complete).toContain('~~Art. 5º O Certificado de Registro de Arma de Fogo');
    expect(complete).toContain('~~Tabela 1. Tabela oficial | SITUAÇÃO; R$');
    expect(complete).toContain('^l10826-anx-unico-tab-1');
    expect(current).not.toContain('~~');
    expect(current).not.toContain('Registro de arma de fogo; 300,00');
    expect(current).toContain('^l10826-art-5');
    expect(current).toContain('^l10826-anx-unico-tab-1');
  });
});
