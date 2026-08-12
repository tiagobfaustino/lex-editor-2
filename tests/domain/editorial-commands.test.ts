import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  appendEditorialJournalEntry,
  applyEditorialCommand,
  calculateRevisionHash,
  canonicalizeRevision,
  createEditorialCheckpoint,
  editorialCommandSchema,
  editorialJournalSchema,
  identifiedCompleta,
  identifiedMinima,
  parseEditorialJournal,
  reconcileEditorialReprocessing,
  replayEditorialJournal,
  type EditorialCommand,
  type EditorialJournal,
} from '@lex-editor/legal-domain';

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const reverseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== 'object' || value === null) return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) {
    result[key] = reverseKeys((value as Record<string, unknown>)[key]);
  }
  return result;
};

const COMMAND_ID_1 = '11111111-1111-4111-8111-111111111111';
const COMMAND_ID_2 = '22222222-2222-4222-8222-222222222222';
const JOURNAL_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CHECKPOINT_ID = '55555555-5555-4555-8555-555555555555';
const NEXT_REVISION = 'b'.repeat(64);

const command = (
  expectedRevisionHash: string,
  operation: EditorialCommand['operation'] = {
    kind: 'replace_node_text',
    targetNodeId: 'no-art-1',
    field: 'caput',
    value: 'Art. 1º Texto corrigido.',
    reason: 'Corrigir a captura divergente do snapshot oficial.',
  },
): EditorialCommand => ({
  schemaVersion: 1,
  commandId: COMMAND_ID_1,
  localActorId: 'editor-local-01',
  occurredAt: '2026-08-10T12:00:00.000-03:00',
  expectedRevisionHash,
  operation,
});

const journal = (): EditorialJournal => {
  const ast = clone(identifiedMinima);
  const baseRevisionHash = calculateRevisionHash(ast, sha256);
  return {
    schemaVersion: 1,
    journalId: JOURNAL_ID,
    projectId: PROJECT_ID,
    createdAt: '2026-08-10T12:00:00.000-03:00',
    base: { revisionHash: baseRevisionHash, ast },
    entries: [
      {
        sequence: 1,
        command: command(baseRevisionHash),
        resultRevisionHash: NEXT_REVISION,
      },
      {
        sequence: 2,
        command: {
          ...command(NEXT_REVISION, {
            kind: 'confirm_warning',
            warningCode: 'division_article_range',
            warningFingerprint: 'c'.repeat(64),
            note: 'Intervalo histórico confirmado na fonte oficial.',
          }),
          commandId: COMMAND_ID_2,
        },
        resultRevisionHash: NEXT_REVISION,
      },
    ],
  };
};

const replayableHistory = () => {
  const baseAst = clone(identifiedMinima);
  const baseRevisionHash = calculateRevisionHash(baseAst, sha256);
  let currentJournal: EditorialJournal = {
    schemaVersion: 1,
    journalId: JOURNAL_ID,
    projectId: PROJECT_ID,
    createdAt: '2026-08-10T12:00:00.000-03:00',
    base: { revisionHash: baseRevisionHash, ast: baseAst },
    entries: [],
  };
  const firstCommand = command(baseRevisionHash);
  const first = applyEditorialCommand(baseAst, firstCommand, sha256);
  if (!first.ok) throw new Error('O primeiro comando da fixture foi rejeitado.');
  currentJournal = appendEditorialJournalEntry(
    currentJournal,
    firstCommand,
    first.revisionHash,
    sha256,
  );
  const checkpoint = createEditorialCheckpoint(
    currentJournal,
    first.ast,
    CHECKPOINT_ID,
    '2026-08-10T12:01:00.000-03:00',
    sha256,
  );
  const secondCommand: EditorialCommand = {
    ...command(first.revisionHash, {
      kind: 'set_law_metadata',
      changes: { titulo: 'Lei revisada editorialmente' },
      reason: 'Conferência do título na publicação oficial.',
    }),
    commandId: COMMAND_ID_2,
    occurredAt: '2026-08-10T12:02:00.000-03:00',
  };
  const second = applyEditorialCommand(first.ast, secondCommand, sha256);
  if (!second.ok) throw new Error('O segundo comando da fixture foi rejeitado.');
  currentJournal = appendEditorialJournalEntry(
    currentJournal,
    secondCommand,
    second.revisionHash,
    sha256,
  );
  return { journal: currentJournal, checkpoint, expected: second };
};

describe('hash de revisão editorial', () => {
  it('deriva o mesmo hash da forma canônica independentemente da ordem das chaves', () => {
    const reordered = reverseKeys(clone(identifiedMinima));

    expect(canonicalizeRevision(reordered)).toBe(canonicalizeRevision(identifiedMinima));
    expect(calculateRevisionHash(reordered, sha256)).toBe(
      calculateRevisionHash(identifiedMinima, sha256),
    );
  });

  it('muda quando o conteúdo jurídico muda e recusa árvore ou digest inválido', () => {
    const changed = clone(identifiedMinima);
    const article = changed.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.caput = 'Art. 1º Conteúdo juridicamente diferente.';

    expect(calculateRevisionHash(changed, sha256)).not.toBe(
      calculateRevisionHash(identifiedMinima, sha256),
    );
    expect(() => calculateRevisionHash({ astPhase: 'identified' }, sha256)).toThrow();
    expect(() => calculateRevisionHash(identifiedMinima, () => 'digest-inválido')).toThrow();
  });
});

describe('comandos editoriais', () => {
  it('aceita operações tipadas com ator, instante, motivo e revisão esperada', () => {
    const parsed = editorialCommandSchema.parse(
      command(calculateRevisionHash(identifiedMinima, sha256)),
    );

    expect(parsed.operation.kind).toBe('replace_node_text');
    expect(parsed.localActorId).toBe('editor-local-01');
  });

  it('recusa motivo vazio, metadado sem alteração e tentativa de campo genérico', () => {
    const revisionHash = calculateRevisionHash(identifiedMinima, sha256);
    const withoutReason = command(revisionHash) as unknown as Record<string, unknown>;
    withoutReason['operation'] = {
      kind: 'move_node',
      targetNodeId: 'art-1',
      newParentNodeId: 'lei-1',
      newOrder: 0,
      reason: '   ',
    };
    const emptyMetadata = command(revisionHash) as unknown as Record<string, unknown>;
    emptyMetadata['operation'] = {
      kind: 'set_law_metadata',
      changes: {},
      reason: 'Revisão dos metadados.',
    };
    const genericStatus = command(revisionHash) as unknown as Record<string, unknown>;
    genericStatus['status'] = 'approved';

    expect(editorialCommandSchema.safeParse(withoutReason).success).toBe(false);
    expect(editorialCommandSchema.safeParse(emptyMetadata).success).toBe(false);
    expect(editorialCommandSchema.safeParse(genericStatus).success).toBe(false);
  });

  it('não oferece comando para editar Block ID publicado', () => {
    const attempted = {
      ...command(calculateRevisionHash(identifiedMinima, sha256)),
      operation: {
        kind: 'set_block_id',
        targetNodeId: 'art-1',
        blockId: 'novo-id-proibido',
        reason: 'Tentativa indevida.',
      },
    };

    expect(editorialCommandSchema.safeParse(attempted).success).toBe(false);
  });
});

describe('aplicação de comandos editoriais', () => {
  it('corrige texto sobre cópia e produz uma revisão nova', () => {
    const original = clone(identifiedMinima);
    const revisionHash = calculateRevisionHash(original, sha256);
    const result = applyEditorialCommand(original, command(revisionHash), sha256);

    expect(result.ok).toBe(true);
    expect(original.children[0]?.tipo === 'artigo' ? original.children[0].caput : '').toBe(
      'Esta lei demonstra o contrato da NormaAST.',
    );
    expect(result.ok ? result.revisionHash : revisionHash).not.toBe(revisionHash);
    expect(
      result.ok && result.ast.children[0]?.tipo === 'artigo' ? result.ast.children[0].caput : '',
    ).toBe('Art. 1º Texto corrigido.');
  });

  it('recusa revisão obsoleta, campo incompatível e comando sem efeito', () => {
    const currentHash = calculateRevisionHash(identifiedMinima, sha256);
    const stale = applyEditorialCommand(identifiedMinima, command('d'.repeat(64)), sha256);
    const wrongField = applyEditorialCommand(
      identifiedMinima,
      command(currentHash, {
        kind: 'replace_node_text',
        targetNodeId: 'no-art-1',
        field: 'caption',
        value: 'Campo impossível em artigo.',
        reason: 'Teste de rejeição.',
      }),
      sha256,
    );
    const noChange = applyEditorialCommand(
      identifiedMinima,
      command(currentHash, {
        kind: 'set_law_metadata',
        changes: { titulo: identifiedMinima.titulo },
        reason: 'Teste de comando sem alteração.',
      }),
      sha256,
    );

    expect(stale).toMatchObject({ ok: false, error: { code: 'stale_revision' } });
    expect(wrongField).toMatchObject({ ok: false, error: { code: 'field_not_allowed' } });
    expect(noChange).toMatchObject({ ok: false, error: { code: 'no_change' } });
  });

  it('rejeita mudança de estado que violaria a decisão explícita de revogação', () => {
    const revisionHash = calculateRevisionHash(identifiedMinima, sha256);
    const result = applyEditorialCommand(
      identifiedMinima,
      command(revisionHash, {
        kind: 'set_device_status',
        targetNodeId: 'no-art-1',
        deviceStatus: 'revoked',
        reason: 'Revogação identificada na fonte.',
      }),
      sha256,
    );

    expect(result).toMatchObject({ ok: false, error: { code: 'invariant_violation' } });
  });

  it('resolve uma revisão de baixa confiança com motivo auditável', () => {
    const lowConfidence = clone(identifiedMinima);
    const article = lowConfidence.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.parseEvidence = {
      confidence: 'low',
      reasons: ['ambiguous_designator'],
      requiresHumanReview: true,
    };
    const result = applyEditorialCommand(
      lowConfidence,
      command(calculateRevisionHash(lowConfidence, sha256), {
        kind: 'confirm_parse_interpretation',
        targetNodeId: article.id,
        reason: 'A posição foi conferida no snapshot oficial.',
      }),
      sha256,
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.ast.children[0]?.parseEvidence : undefined).toMatchObject({
      confidence: 'medium',
      reasons: ['ambiguous_designator', 'editorial_override'],
      requiresHumanReview: false,
      editorialNote: 'A posição foi conferida no snapshot oficial.',
    });
  });

  it('reidentifica e reconcilia Block IDs depois de mudança estrutural', () => {
    const complete = clone(identifiedCompleta);
    const result = applyEditorialCommand(
      complete,
      command(calculateRevisionHash(complete, sha256), {
        kind: 'move_node',
        targetNodeId: 'no-tabela-1',
        newParentNodeId: 'no-raiz',
        newOrder: complete.children.length,
        reason: 'A tabela pertence à raiz segundo a fonte oficial.',
      }),
      sha256,
    );

    expect(result.ok).toBe(true);
    expect(result.ok ? result.structuralChange : false).toBe(true);
    expect(result.ok ? result.missingPublishedBlockIds : []).toContain('ldem-anx-i-tab-1');
    const moved = result.ok
      ? result.ast.children.find((node) => node.id === 'no-tabela-1')
      : undefined;
    expect(moved?.tipo === 'tabela' ? moved.blockId : undefined).toBe('ldem-tab-1');
  });

  it('recusa ciclo e hierarquia incompatível em movimento estrutural', () => {
    const complete = clone(identifiedCompleta);
    const revisionHash = calculateRevisionHash(complete, sha256);
    const cycle = applyEditorialCommand(
      complete,
      command(revisionHash, {
        kind: 'move_node',
        targetNodeId: 'no-anexo-1',
        newParentNodeId: 'no-tabela-1',
        newOrder: 0,
        reason: 'Tentativa de ciclo.',
      }),
      sha256,
    );
    const incompatible = applyEditorialCommand(
      complete,
      command(revisionHash, {
        kind: 'move_node',
        targetNodeId: 'no-adct',
        newParentNodeId: 'no-anexo-1',
        newOrder: 0,
        reason: 'Tentativa de hierarquia incompatível.',
      }),
      sha256,
    );

    expect(cycle).toMatchObject({ ok: false, error: { code: 'invalid_move' } });
    expect(incompatible).toMatchObject({
      ok: false,
      error: { code: 'invariant_violation' },
    });
  });
});

describe('diário editorial', () => {
  it('valida snapshot-base e encadeia comandos por sequência e hash', () => {
    const value = journal();
    const parsed = parseEditorialJournal(JSON.parse(JSON.stringify(value)), sha256);

    expect(parsed).toEqual(value);
    expect(parsed.entries.at(-1)?.resultRevisionHash).toBe(NEXT_REVISION);
  });

  it('recusa lacuna, comando duplicado e revisão-base obsoleta', () => {
    const gap = journal();
    const duplicate = journal();
    const stale = journal();
    const secondGapEntry = gap.entries[1];
    const secondDuplicateEntry = duplicate.entries[1];
    const secondStaleEntry = stale.entries[1];
    if (
      secondGapEntry === undefined ||
      secondDuplicateEntry === undefined ||
      secondStaleEntry === undefined
    ) {
      throw new Error('Fixture de diário incompleta.');
    }
    secondGapEntry.sequence = 3;
    secondDuplicateEntry.command.commandId = COMMAND_ID_1;
    secondStaleEntry.command.expectedRevisionHash = 'd'.repeat(64);

    expect(editorialJournalSchema.safeParse(gap).success).toBe(false);
    expect(editorialJournalSchema.safeParse(duplicate).success).toBe(false);
    expect(editorialJournalSchema.safeParse(stale).success).toBe(false);
  });

  it('detecta adulteração do snapshot mesmo quando o JSON do diário é válido', () => {
    const tampered = journal();
    tampered.base.ast.titulo = 'Título adulterado sem atualizar o hash';

    expect(editorialJournalSchema.safeParse(tampered).success).toBe(true);
    expect(() => parseEditorialJournal(tampered, sha256)).toThrow(
      'O hash da revisão-base não corresponde ao snapshot do diário.',
    );
  });
});

describe('checkpoint e replay editorial', () => {
  it('retoma do checkpoint e reproduz somente os comandos posteriores', () => {
    const history = replayableHistory();
    const result = replayEditorialJournal(history.journal, sha256, history.checkpoint);

    expect(result).toMatchObject({
      ok: true,
      checkpointUsed: true,
      replayedEntries: 1,
      revisionHash: history.expected.revisionHash,
    });
    expect(result.ok ? result.ast.titulo : '').toBe('Lei revisada editorialmente');
    expect(
      result.ok && result.ast.children[0]?.tipo === 'artigo' ? result.ast.children[0].caput : '',
    ).toBe('Art. 1º Texto corrigido.');
  });

  it('reproduz o diário inteiro quando não há checkpoint', () => {
    const history = replayableHistory();
    const result = replayEditorialJournal(history.journal, sha256);

    expect(result).toMatchObject({
      ok: true,
      checkpointUsed: false,
      replayedEntries: 2,
      revisionHash: history.expected.revisionHash,
    });
  });

  it('detecta checkpoint adulterado e resultado de replay divergente', () => {
    const history = replayableHistory();
    const badCheckpoint = clone(history.checkpoint);
    badCheckpoint.ast.titulo = 'Snapshot adulterado';
    const divergentJournal = clone(history.journal);
    const first = divergentJournal.entries[0];
    const second = divergentJournal.entries[1];
    if (first === undefined || second === undefined) throw new Error('Fixture incompleta.');
    first.resultRevisionHash = 'e'.repeat(64);
    second.command.expectedRevisionHash = first.resultRevisionHash;

    expect(replayEditorialJournal(history.journal, sha256, badCheckpoint)).toMatchObject({
      ok: false,
      error: { code: 'invalid_checkpoint' },
    });
    expect(replayEditorialJournal(divergentJournal, sha256)).toMatchObject({
      ok: false,
      error: { code: 'result_hash_mismatch', sequence: 1 },
    });
  });

  it('recusa anexar comando baseado em revisão obsoleta', () => {
    const history = replayableHistory();
    expect(() =>
      appendEditorialJournalEntry(
        history.journal,
        { ...command(history.journal.base.revisionHash), commandId: CHECKPOINT_ID },
        'f'.repeat(64),
        sha256,
      ),
    ).toThrow('O comando não parte da revisão atual do diário.');
  });
});

describe('reprocessamento editorial', () => {
  it('preserva correções quando a base é idêntica', () => {
    const history = replayableHistory();
    const result = reconcileEditorialReprocessing(
      history.journal,
      history.journal.base.ast,
      sha256,
    );

    expect(result).toMatchObject({
      ok: true,
      reprocessingOutcome: 'unchanged_base',
      revisionHash: history.expected.revisionHash,
    });
    expect(result.ok ? result.ast.titulo : '').toBe('Lei revisada editorialmente');
  });

  it('expõe conflito e mantém todos os comandos quando a fonte muda', () => {
    const history = replayableHistory();
    const incoming = clone(history.journal.base.ast);
    const article = incoming.children[0];
    if (article?.tipo !== 'artigo') throw new Error('Fixture sem artigo.');
    article.caput = 'Texto novo recebido no reprocessamento da fonte.';

    const result = reconcileEditorialReprocessing(history.journal, incoming, sha256);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'editorial_reprocessing_conflict',
        currentRevisionHash: history.expected.revisionHash,
        preservedCommandIds: [COMMAND_ID_1, COMMAND_ID_2],
      },
    });
    expect(history.journal.entries).toHaveLength(2);
    expect(replayEditorialJournal(history.journal, sha256)).toMatchObject({
      ok: true,
      revisionHash: history.expected.revisionHash,
    });
  });

  it('substitui com segurança uma base que ainda não recebeu correções', () => {
    const history = replayableHistory();
    const uneditedJournal = { ...history.journal, entries: [] };
    const incoming = clone(history.journal.base.ast);
    incoming.titulo = 'Nova extração sem correções pendentes';

    const result = reconcileEditorialReprocessing(uneditedJournal, incoming, sha256);

    expect(result).toMatchObject({
      ok: true,
      reprocessingOutcome: 'replaced_unedited_base',
      ast: { titulo: 'Nova extração sem correções pendentes' },
      journal: { entries: [] },
    });
  });
});
