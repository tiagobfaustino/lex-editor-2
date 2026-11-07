import {
  formatar,
  prepareLocalSourceUpdate,
  replayEditorialJournal,
  type EditorialJournal,
  type IdentifiedNormaAST,
  type IdentifiedChildNode,
  type RevisionHashFunction,
} from '@lex-editor/legal-domain';

const literal = (value: string): string =>
  value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/[\\`*_[\]#]/gu, '\\$&');
const block = (text: string): string => {
  const fence = '`'.repeat(
    Math.max(3, ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length + 1)),
  );
  return `${fence}text\n${text}\n${fence}`;
};
const articleIndex = (ast: IdentifiedNormaAST): Map<string, IdentifiedChildNode> => {
  const found = new Map<string, IdentifiedChildNode>();
  const visit = (node: IdentifiedChildNode, article: IdentifiedChildNode | null): void => {
    const owner = node.tipo === 'artigo' ? node : article;
    if (node.blockId !== undefined) found.set(node.blockId, owner ?? node);
    for (const child of node.children) visit(child, owner);
  };
  ast.children.forEach((node) => {
    visit(node, null);
  });
  return found;
};
const legalText = (ast: IdentifiedNormaAST, selected: IdentifiedChildNode): string => {
  const prune = (node: IdentifiedChildNode): IdentifiedChildNode | null => {
    if (node === selected) return node;
    const children = node.children.map(prune).filter((child) => child !== null);
    return children.length === 0 ? null : ({ ...node, children } as IdentifiedChildNode);
  };
  const children = ast.children.map(prune).filter((child) => child !== null);
  let totalArtigos = 0;
  const count = (node: IdentifiedChildNode): void => {
    if (node.tipo === 'artigo') totalArtigos++;
    node.children.forEach(count);
  };
  children.forEach(count);
  const result = formatar({ ...ast, children, totalArtigos }, 'complete_with_history');
  if (!result.ok) throw new Error('CHANGE_REPORT_FORMAT_FAILED');
  const end = result.valor.indexOf('\n---\n', 4);
  if (end < 0) throw new Error('CHANGE_REPORT_FORMAT_FAILED');
  return result.valor.slice(end + 5).trim();
};

/** Local source adoptions are evidence, not a claim of remote publication. */
export const generateLocalChangeReport = (
  journal: EditorialJournal,
  current: IdentifiedNormaAST,
  revisionHash: string,
  sha256: RevisionHashFunction,
): string | null => {
  const updates = journal.entries.filter(
    (entry) => entry.command.operation.kind === 'apply_source_update',
  );
  if (updates.length === 0) return null;
  const sections = [
    '# Relatório de alterações locais',
    '',
    `Lei: ${literal(current.titulo)}`,
    `Revisão exportada: ${revisionHash}`,
    '',
    'Conferências adotadas localmente. Este relatório não representa uma publicação no Vinculex.',
  ];
  const allAffected = new Set<string>();
  for (const entry of updates) {
    const operation = entry.command.operation;
    if (operation.kind !== 'apply_source_update') continue;
    const position = journal.entries.indexOf(entry);
    const before = replayEditorialJournal(
      { ...journal, entries: journal.entries.slice(0, position) },
      sha256,
    );
    const after = replayEditorialJournal(
      { ...journal, entries: journal.entries.slice(0, position + 1) },
      sha256,
    );
    if (!before.ok || !after.ok) throw new Error('CHANGE_REPORT_REPLAY_FAILED');
    const prepared = prepareLocalSourceUpdate(
      before.ast,
      operation.sourceBase,
      operation.incoming,
      operation.checkedOn,
      sha256,
    );
    sections.push(
      '',
      `## Conferência ${literal(operation.checkedOn)}`,
      `Identificador: ${operation.checkId}`,
      `Fonte: ${literal(operation.incoming.fonte)}`,
      `Snapshot anterior: ${operation.sourceBase.sourceRef.sourceArtifactSha256}`,
      `Snapshot consultado: ${operation.incoming.sourceRef.sourceArtifactSha256}`,
      `Revisão anterior: ${before.revisionHash}`,
      `Revisão adotada: ${after.revisionHash}`,
      `Motivo: ${literal(operation.reason)}`,
    );
    const ids = new Set<string>();
    for (const change of prepared.diff.entries) {
      if (change.category === 'unchanged' || change.affectedBlockId === null) continue;
      ids.add(change.affectedBlockId);
      sections.push(
        '',
        `### ${literal(change.affectedBlockId)} — ${change.category}`,
        'Antes:',
        block(change.before?.text ?? 'Dispositivo inexistente.'),
        'Depois:',
        block(change.after?.text ?? 'Dispositivo inexistente.'),
      );
    }
    for (const missing of prepared.diff.missingPublished) {
      ids.add(missing.blockId);
      sections.push(
        '',
        `### ${literal(missing.blockId)} — ausente na fonte`,
        'Preservado sem presumir revogação.',
        block(missing.text),
      );
    }
    const beforeArticles = articleIndex(before.ast);
    const afterArticles = articleIndex(after.ast);
    const rendered = new Set<string>();
    for (const id of ids) {
      allAffected.add(id);
      const old = beforeArticles.get(id);
      const next = afterArticles.get(id);
      const key = next?.blockId ?? old?.blockId ?? id;
      if (rendered.has(key)) continue;
      rendered.add(key);
      sections.push(
        '',
        `### Artigo ou unidade afetada integral — ${literal(key)}`,
        'Antes da adoção:',
        block(old === undefined ? 'Dispositivo inexistente.' : legalText(before.ast, old)),
        'Depois da adoção:',
        block(next === undefined ? 'Dispositivo inexistente.' : legalText(after.ast, next)),
      );
    }
  }
  sections.push('', '## Artigos afetados na revisão exportada');
  const latest = articleIndex(current);
  const rendered = new Set<string>();
  for (const id of allAffected) {
    const node = latest.get(id);
    if (node === undefined || rendered.has(node.blockId ?? id)) continue;
    rendered.add(node.blockId ?? id);
    sections.push('', block(legalText(current, node)));
  }
  return `${sections.join('\n')}\n`;
};
