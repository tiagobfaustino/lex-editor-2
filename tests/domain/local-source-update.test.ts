import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  identifiedMinima,
  identifiedCompleta,
  prepareLocalSourceUpdate,
  calculateRevisionHash,
  applyEditorialCommand,
  appendEditorialJournalEntry,
  replayEditorialJournal,
} from '@lex-editor/legal-domain';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const fixtures = () => {
  const base = structuredClone(identifiedMinima);
  const current = structuredClone(base);
  const incoming = structuredClone(base);
  const node = incoming.children[0];
  if (node?.tipo !== 'artigo') throw new Error('Fixture missing');
  node.caput = 'Nova redação oficial.';
  incoming.sourceRef.sourceArtifactSha256 = 'b'.repeat(64);
  return { base, current, incoming };
};
it('adota alteração com mesmo ID, histórico anterior e metadados editoriais', () => {
  const { base, current, incoming } = fixtures();
  current.titulo = 'Título revisado';
  current.ramo = 'penal';
  const result = prepareLocalSourceUpdate(current, base, incoming, '2026-10-08', hash);
  expect(result.ast.titulo).toBe('Título revisado');
  expect(result.ast.ramo).toBe('penal');
  expect(result.ast.children[0]?.blockId).toBe(base.children[0]?.blockId);
  expect(result.ast.children[0]).toMatchObject({
    caput: 'Nova redação oficial.',
    redacoesAnteriores: [{ texto: expect.any(String) as unknown }],
  });
  expect(result.diff.summary.amended).toBe(1);
});
it('ausência preserva artigo sem atribuir revogação', () => {
  const { base, current, incoming } = fixtures();
  incoming.children = [];
  incoming.totalArtigos = 0;
  const result = prepareLocalSourceUpdate(current, base, incoming, '2026-10-08', hash);
  expect(result.diff.summary.missingPublished).toBe(1);
  expect(result.ast.children[0]?.blockId).toBe(base.children[0]?.blockId);
  expect(result.ast.children[0]).toMatchObject({
    deviceStatus: 'active',
    parseEvidence: { requiresHumanReview: true },
  });
});
it('conflito local exige autorização explícita e preserva correção como histórico', () => {
  const { base, current, incoming } = fixtures();
  const node = current.children[0];
  if (node?.tipo !== 'artigo') throw new Error('Fixture missing');
  node.caput = 'Correção local.';
  const proposal = prepareLocalSourceUpdate(current, base, incoming, '2026-10-08', hash);
  expect(proposal.conflictingBlockIds).toEqual([node.blockId]);
  const command = {
    schemaVersion: 1,
    commandId: '11111111-1111-4111-8111-111111111111',
    localActorId: 'editor-local',
    occurredAt: '2026-10-08T12:00:00Z',
    expectedRevisionHash: calculateRevisionHash(current, hash),
    operation: {
      kind: 'apply_source_update',
      checkId: '22222222-2222-4222-8222-222222222222',
      sourceBase: base,
      incoming,
      checkedOn: '2026-10-08',
      overwriteConflicts: false,
      reason: 'Conferência oficial',
    },
  };
  expect(applyEditorialCommand(current, command, hash)).toMatchObject({ ok: false });
  command.operation.overwriteConflicts = true;
  const applied = applyEditorialCommand(current, command, hash);
  expect(applied.ok).toBe(true);
  if (!applied.ok) throw new Error('Not applied');
  const journal = appendEditorialJournalEntry(
    {
      schemaVersion: 1,
      journalId: command.commandId,
      projectId: command.operation.checkId,
      createdAt: command.occurredAt,
      base: { ast: current, revisionHash: command.expectedRevisionHash },
      entries: [],
    },
    command,
    applied.revisionHash,
    hash,
  );
  expect(replayEditorialJournal(journal, hash)).toMatchObject({ ok: true, ast: applied.ast });
});

it('mudanças cosméticas da fonte não apagam correção local nem geram atualização', () => {
  const base = structuredClone(identifiedMinima);
  const current = structuredClone(base);
  const incoming = structuredClone(base);
  const local = current.children[0];
  const source = incoming.children[0];
  if (local?.tipo !== 'artigo' || source?.tipo !== 'artigo') throw new Error('Missing fixture');
  local.caput = 'Texto corrigido pelo editor.';
  source.caput = `  ${source.caput}  `;
  incoming.sourceRef.sourceArtifactSha256 = 'c'.repeat(64);
  const result = prepareLocalSourceUpdate(current, base, incoming, '2026-10-08', hash);
  expect(result.hasChanges).toBe(false);
  expect(result.conflictingBlockIds).toEqual([]);
  expect(result.ast.children[0]).toMatchObject({ caput: local.caput });
});

it('revogação expressa conserva texto e identidade anteriores', () => {
  const { base, current, incoming } = fixtures();
  const source = incoming.children[0];
  if (source?.tipo !== 'artigo') throw new Error('Missing fixture');
  source.caput = '(Revogado)';
  source.deviceStatus = 'revoked';
  source.preservarTextoRevogado = false;
  const result = prepareLocalSourceUpdate(current, base, incoming, '2026-10-08', hash);
  expect(result.ast.children[0]).toMatchObject({
    blockId: 'ldem-art-1',
    deviceStatus: 'revoked',
    preservarTextoRevogado: true,
    caput: 'Esta lei demonstra o contrato da NormaAST.',
  });
  expect(result.diff.summary.revoked).toBe(1);
});

it('ausência conserva a posição de artigos e correções não conflitantes em atualização parcial', () => {
  const base = structuredClone(identifiedMinima);
  const first = base.children[0];
  if (first?.tipo !== 'artigo') throw new Error('Missing fixture');
  base.children.push({
    ...structuredClone(first),
    id: 'no-art-2',
    ordem: 1,
    numero: '2',
    blockId: 'ldem-art-2',
    caput: 'Artigo segundo.',
  });
  base.totalArtigos = 2;
  const current = structuredClone(base);
  const local = current.children[0];
  if (local?.tipo !== 'artigo') throw new Error('Missing fixture');
  local.caput = 'Correção local preservada.';
  const incoming = structuredClone(base);
  incoming.children.shift();
  incoming.totalArtigos = 1;
  incoming.redacoesDadasPor = [];
  const second = incoming.children[0];
  if (second?.tipo !== 'artigo') throw new Error('Missing fixture');
  second.ordem = 0;
  second.caput = 'Artigo segundo alterado.';
  const result = prepareLocalSourceUpdate(current, base, incoming, '2026-10-08', hash);
  expect(result.ast.children.map((node) => node.blockId)).toEqual(['ldem-art-1', 'ldem-art-2']);
  expect(result.ast.children[0]).toMatchObject({
    caput: 'Correção local preservada.',
    parseEvidence: { requiresHumanReview: true },
  });
  expect(result.ast.children[1]).toMatchObject({ caput: 'Artigo segundo alterado.' });
});

it('restaura hierarquia ausente com descendentes e aliases sem duplicar identidades', () => {
  const base = structuredClone(identifiedCompleta);
  const incoming = structuredClone(base);
  incoming.children.shift();
  incoming.totalArtigos = 1;
  incoming.redacoesDadasPor = [];
  incoming.children.forEach((node, i) => {
    node.ordem = i;
  });
  const result = prepareLocalSourceUpdate(base, base, incoming, '2026-10-08', hash);
  expect(result.ast.totalArtigos).toBe(base.totalArtigos);
  expect(result.ast.children[0]?.tipo).toBe('livro');
  expect(result.ast.idsDepreciados).toEqual(base.idsDepreciados);
  expect(result.diff.missingPublished.length).toBeGreaterThan(1);
});

it('mantém células da redação anterior quando uma tabela muda', () => {
  const base = structuredClone(identifiedCompleta);
  const incoming = structuredClone(base);
  const annex = incoming.children[1];
  if (annex?.tipo !== 'anexo') throw new Error('Missing fixture');
  const table = annex.children[1];
  if (table?.tipo !== 'tabela') throw new Error('Missing fixture');
  table.rows[0] = ['Nova célula', 'Novo valor'];
  const result = prepareLocalSourceUpdate(base, base, incoming, '2026-10-08', hash);
  const updatedAnnex = result.ast.children[1];
  if (updatedAnnex?.tipo !== 'anexo') throw new Error('Missing fixture');
  const updatedTable = updatedAnnex.children[1];
  if (updatedTable?.tipo !== 'tabela') throw new Error('Missing fixture');
  expect(updatedTable.rows[0]).toEqual(['Nova célula', 'Novo valor']);
  expect(updatedTable.redacoesAnteriores?.[0]?.texto).toContain('a1; b1');
});
