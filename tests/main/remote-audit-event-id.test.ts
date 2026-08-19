import { describe, expect, it } from 'vitest';

import {
  decodeRemoteAuditEventId,
  encodeRemoteAuditEventId,
} from '../../src/main/audit/remote-audit-event-id.js';

describe('remote audit event id encoding', () => {
  it('faz o round trip de tabela e sequência', () => {
    const encoded = encodeRemoteAuditEventId('publication', 42n);
    expect(decodeRemoteAuditEventId(encoded)).toStrictEqual({
      table: 'publication',
      sequence: 42n,
    });
  });

  it('produz um identificador com formato de UUID v4', () => {
    const encoded = encodeRemoteAuditEventId('source_check', 1n);
    expect(encoded).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it('distingue cada tabela remota com uma tag própria', () => {
    const tables = ['publication', 'legislative_update', 'source_catalog', 'source_check'] as const;
    const pairs = tables.map((table) => ({ table, id: encodeRemoteAuditEventId(table, 7n) }));
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(tables.length);
    for (const { table, id } of pairs) {
      expect(decodeRemoteAuditEventId(id)).toStrictEqual({ table, sequence: 7n });
    }
  });

  it('rejeita sequência negativa', () => {
    expect(() => encodeRemoteAuditEventId('publication', -1n)).toThrow(RangeError);
  });

  it('rejeita sequência acima da faixa codificável', () => {
    expect(() => encodeRemoteAuditEventId('publication', 0x1000000000000n)).toThrow(RangeError);
  });

  it('aceita a sequência máxima codificável', () => {
    const encoded = encodeRemoteAuditEventId('publication', 0xffffffffffffn);
    expect(decodeRemoteAuditEventId(encoded)).toStrictEqual({
      table: 'publication',
      sequence: 0xffffffffffffn,
    });
  });

  it('retorna null para identificadores que não seguem o formato remoto', () => {
    expect(decodeRemoteAuditEventId('not-a-uuid')).toBeNull();
    expect(decodeRemoteAuditEventId('11111111-1111-4111-8111-111111111111')).toBeNull();
  });

  it('retorna null para uma tag de tabela desconhecida', () => {
    expect(decodeRemoteAuditEventId('90000000-0000-4000-8000-000000000001')).toBeNull();
  });

  it('é insensível a maiúsculas/minúsculas na tag', () => {
    const encoded = encodeRemoteAuditEventId('publication', 5n).toUpperCase();
    expect(decodeRemoteAuditEventId(encoded)).toStrictEqual({ table: 'publication', sequence: 5n });
  });
});
