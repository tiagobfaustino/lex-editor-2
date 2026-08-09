// Confere, campo a campo, as interfaces do DATA_MODEL contra a implementação.
// Usa o compilador do TypeScript nos dois lados: ele resolve `extends`,
// intersecção e genéricos, o que nenhum regex resolve com confiança.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

const dm = readFileSync('docs/architecture/DATA_MODEL.md', 'utf8');
const secao = dm.slice(dm.indexOf('## NormaAST'), dm.indexOf('## Metadados de frontmatter'));
const blocos = [...secao.matchAll(/```typescript\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');

const dir = mkdtempSync(join(tmpdir(), 'audit-'));
const arqDm = join(dir, 'datamodel.ts');
writeFileSync(arqDm, blocos);

// Instancia os genéricos da impl na fase `identified`, a mais rica.
const arqImpl = join(dir, 'impl.ts');
writeFileSync(
  arqImpl,
  `
import type * as N from '${process.cwd()}/packages/legal-domain/src/ast/nodes.ts';
type B = N.SlotComBlockId; type D = N.SlotBlockIdOpcional;
export type LeiNode = N.LeiNode<'identified', B, D>;
export type AtoTransitorioNode = N.AtoTransitorioNode<B, D>;
export type LivroNode = N.LivroNode<B, D>;
export type TituloNode = N.TituloNode<B, D>;
export type CapituloNode = N.CapituloNode<B, D>;
export type SecaoNode = N.SecaoNode<B, D>;
export type SubsecaoNode = N.SubsecaoNode<B, D>;
export type ArtigoNode = N.ArtigoNode<B>;
export type ParagrafoNode = N.ParagrafoNode<B>;
export type IncisoNode = N.IncisoNode<B>;
export type AlineaNode = N.AlineaNode<B>;
export type ItemNode = N.ItemNode<B>;
export type PenaNode = N.PenaNode<B>;
export type AnexoNode = N.AnexoNode<B>;
export type TabelaNode = N.TabelaNode<B>;
export type SourceReference = N.SourceReference;
export type ParseEvidence = N.ParseEvidence;
export type ReferenciaRedacao = N.ReferenciaRedacao;
export type BlockIdDepreciado = N.BlockIdDepreciado;
export type NormaNodeBase = N.NormaNodeBase;
export type DispositivoNodeBase = N.DispositivoNodeBase<B>;
export type DivisaoNodeBase = N.DivisaoNodeBase<D>;
`,
);

const prog = ts.createProgram([arqDm, arqImpl], {
  strict: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
});
const checker = prog.getTypeChecker();

const propsDe = (arquivo, nome) => {
  const sf = prog.getSourceFile(arquivo);
  let achado;
  ts.forEachChild(sf, (n) => {
    if ((ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) && n.name.text === nome) {
      achado = n;
    }
  });
  if (!achado) return undefined;
  const tipo = checker.getTypeAtLocation(achado.name);
  return new Set(checker.getPropertiesOfType(tipo).map((s) => s.name));
};

const sfDm = prog.getSourceFile(arqDm);
const nomesDm = [];
ts.forEachChild(sfDm, (n) => {
  if (ts.isInterfaceDeclaration(n)) nomesDm.push(n.name.text);
});

let divergencias = 0;
console.log(`${'Interface'.padEnd(22)} ${'faltando na impl'.padEnd(34)} extra na impl`);
console.log('-'.repeat(90));
for (const nome of nomesDm.sort()) {
  const esperado = propsDe(arqDm, nome);
  const obtido = propsDe(arqImpl, nome);
  if (!obtido) {
    console.log(`${nome.padEnd(22)} TIPO AUSENTE NA IMPLEMENTAÇÃO`);
    divergencias++;
    continue;
  }
  const faltam = [...esperado].filter((p) => !obtido.has(p));
  const extras = [...obtido].filter((p) => !esperado.has(p));
  if (faltam.length || extras.length) {
    divergencias++;
    console.log(
      `${nome.padEnd(22)} ${(faltam.join(', ') || '—').padEnd(34)} ${extras.join(', ') || '—'}`,
    );
  }
}
console.log('-'.repeat(90));
console.log(`interfaces conferidas: ${nomesDm.length} | divergências: ${divergencias}`);
