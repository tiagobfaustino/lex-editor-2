export type RemoteAuditTable =
  'publication' | 'legislative_update' | 'source_catalog' | 'source_check';

const TABLE_TAGS: Readonly<Record<RemoteAuditTable, string>> = Object.freeze({
  publication: '1',
  legislative_update: '2',
  source_catalog: '3',
  source_check: '4',
});
const TAG_TABLES: ReadonlyMap<string, RemoteAuditTable> = new Map(
  Object.entries(TABLE_TAGS).map(([table, tag]) => [tag, table as RemoteAuditTable]),
);

const MAX_SEQUENCE = 0xffffffffffffn;
const EVENT_ID_PATTERN = /^([0-9a-f])0000000-0000-4000-8000-([0-9a-f]{12})$/iu;

/**
 * Sequências bigint das projeções remotas não têm UUID próprio; codificamos
 * `(tabela, sequência)` em um UUID v4-shaped estável e reversível somente
 * pelo próprio provider, sem depender de estado ou round-trip adicional.
 */
export const encodeRemoteAuditEventId = (table: RemoteAuditTable, sequence: bigint): string => {
  if (sequence < 0n || sequence > MAX_SEQUENCE) {
    throw new RangeError('remote audit sequence out of encodable range');
  }
  const sequenceHex = sequence.toString(16).padStart(12, '0');
  return `${TABLE_TAGS[table]}0000000-0000-4000-8000-${sequenceHex}`;
};

export const decodeRemoteAuditEventId = (
  eventId: string,
): Readonly<{ table: RemoteAuditTable; sequence: bigint }> | null => {
  const match = EVENT_ID_PATTERN.exec(eventId);
  if (match === null) return null;
  const [, tag, sequenceHex] = match;
  if (tag === undefined || sequenceHex === undefined) return null;
  const table = TAG_TABLES.get(tag.toLowerCase());
  if (table === undefined) return null;
  return { table, sequence: BigInt(`0x${sequenceHex}`) };
};
