import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  calculatePublicationManifestDigest,
  createPublicationIdentifiers,
  deriveNextPublicationNumber,
  deriveNextPublicationVersion,
  MAX_PUBLICATION_NUMBER,
  parseCanonicalPublicationManifest,
  parsePublicationManifest,
  publicationManifestRelativePath,
  serializePublicationManifest,
  validatePublicationSequence,
} from '../../src/main/publication/manifest.js';

const PUBLICATION_ID = '11111111-1111-4111-8111-111111111111';
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222';
const LAW_ID = '33333333-3333-4333-8333-333333333333';
const EDITOR_ID = '44444444-4444-4444-8444-444444444444';
const PUBLISHED_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const RESTORED_VERSION_ID = '66666666-6666-4666-8666-666666666666';

const initialManifest = () => ({
  schemaVersion: 1 as const,
  publicationId: PUBLICATION_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  law: { lawId: LAW_ID, directoryName: 'lei-de-introducao' },
  target: {
    version: '1.0.0',
    publicationNumber: 1,
    kind: 'initial' as const,
    impact: 'normative_projection' as const,
    restoredVersionId: null,
  },
  expectedBase: { gitCommitSha: 'f'.repeat(40), publishedVersionId: null },
  artifacts: {
    markdownSha256: 'a'.repeat(64),
    updateMarkdownSha256: 'b'.repeat(64),
    identifiedAstSha256: 'c'.repeat(64),
  },
  sourceSnapshots: [
    {
      sourceType: 'planalto_html' as const,
      sourceRole: 'primary_current' as const,
      sourceVariant: 'compiled' as const,
      sourceUrl: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
      finalUrl: 'https://www.planalto.gov.br/ccivil_03/decreto-lei/del4657.htm',
      sourceArtifactSha256: 'd'.repeat(64),
      capturedAt: '2026-08-10T14:00:00.000Z',
    },
  ],
  approvedBy: { userId: EDITOR_ID, role: 'editor_juridico' as const },
  changelog: {
    publicationDate: '2026-08-10',
    version: '1.0.0',
    publicationNumber: 1,
    kind: 'initial' as const,
    sourceSummary: 'Importação conferida em fonte oficial.',
    changes: {
      included: [{ blockId: 'ldem-art-1', description: 'Art. 1 incluído.' }],
      amended: [],
      revoked: [],
      renumbered: [],
    },
  },
  preparedAt: '2026-08-10T15:00:00.000Z',
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('publication manifest', () => {
  it('serializes one immutable canonical representation and derives its digest', () => {
    const manifest = initialManifest();
    const canonical = serializePublicationManifest(manifest);
    const parsed = parseCanonicalPublicationManifest(Buffer.from(canonical, 'utf8'));

    expect(canonical).toBe(JSON.stringify(JSON.parse(canonical)));
    expect(canonical.endsWith('\n')).toBe(false);
    expect(Object.keys(JSON.parse(canonical) as object)).toEqual([
      'approvedBy',
      'artifacts',
      'changelog',
      'expectedBase',
      'idempotencyKey',
      'law',
      'preparedAt',
      'publicationId',
      'schemaVersion',
      'sourceSnapshots',
      'target',
    ]);
    expect(parsed).toEqual(manifest);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.artifacts)).toBe(true);
    expect(calculatePublicationManifestDigest(manifest)).toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
  });

  it('rejects equivalent noncanonical JSON and changes the digest after tampering', () => {
    const manifest = initialManifest();
    const pretty = `${JSON.stringify(manifest, null, 2)}\n`;
    expect(() => parseCanonicalPublicationManifest(pretty)).toThrow(/not canonical/u);

    const tampered = clone(manifest);
    tampered.artifacts.markdownSha256 = 'e'.repeat(64);
    expect(calculatePublicationManifestDigest(tampered)).not.toBe(
      calculatePublicationManifestDigest(manifest),
    );
  });

  it('rejects unknown fields, malformed hashes and an ambiguous source set', () => {
    expect(() =>
      parsePublicationManifest({ ...initialManifest(), secret: 'must-not-pass' }),
    ).toThrow();

    const badHash = clone(initialManifest());
    badHash.artifacts.identifiedAstSha256 = 'ABC';
    expect(() => parsePublicationManifest(badHash)).toThrow();

    const duplicatePrimary = clone(initialManifest());
    const primary = duplicatePrimary.sourceSnapshots[0];
    if (primary === undefined) throw new Error('Primary source fixture is missing.');
    duplicatePrimary.sourceSnapshots.push({
      ...primary,
      sourceArtifactSha256: 'e'.repeat(64),
    });
    expect(() => parsePublicationManifest(duplicatePrimary)).toThrow(/exactly one/u);
  });

  it('enforces initial, subsequent and rollback invariants', () => {
    const invalidInitial = clone(initialManifest());
    invalidInitial.target.version = '1.1.0';
    invalidInitial.target.publicationNumber = 2;
    expect(() => parsePublicationManifest(invalidInitial)).toThrow();

    const update = {
      ...clone(initialManifest()),
      target: {
        version: '1.1.0',
        publicationNumber: 2,
        kind: 'legislative_update',
        impact: 'normative_projection',
        restoredVersionId: null,
      },
      expectedBase: {
        gitCommitSha: 'f'.repeat(40),
        publishedVersionId: PUBLISHED_VERSION_ID,
      },
      changelog: {
        ...clone(initialManifest()).changelog,
        version: '1.1.0',
        publicationNumber: 2,
        kind: 'legislative_update',
      },
    };
    expect(parsePublicationManifest(update).target.kind).toBe('legislative_update');

    expect(() =>
      parsePublicationManifest({
        ...update,
        expectedBase: { ...update.expectedBase, publishedVersionId: null },
      }),
    ).toThrow(/published-version base/u);

    const rollback = {
      ...clone(initialManifest()),
      target: {
        version: '1.1.0',
        publicationNumber: 2,
        kind: 'rollback',
        impact: 'normative_projection',
        restoredVersionId: RESTORED_VERSION_ID,
      },
      expectedBase: {
        gitCommitSha: 'f'.repeat(40),
        publishedVersionId: PUBLISHED_VERSION_ID,
      },
      changelog: {
        ...clone(initialManifest()).changelog,
        version: '1.1.0',
        publicationNumber: 2,
        kind: 'rollback',
        restoredVersion: '1.0.0',
        rollbackJustification: 'Restauração necessária após validação jurídica.',
      },
    };
    expect(parsePublicationManifest(rollback).target.restoredVersionId).toBe(RESTORED_VERSION_ID);

    expect(() =>
      parsePublicationManifest({
        ...rollback,
        target: { ...rollback.target, restoredVersionId: null },
      }),
    ).toThrow(/restored version/u);
  });

  it('derives and validates the normative SemVer and publication-number sequence', () => {
    expect(deriveNextPublicationVersion(null, 'editorial_metadata')).toBe('1.0.0');
    expect(deriveNextPublicationVersion('1.2.3', 'representation_contract')).toBe('2.0.0');
    expect(deriveNextPublicationVersion('1.2.3', 'normative_projection')).toBe('1.3.0');
    expect(deriveNextPublicationVersion('1.2.3', 'editorial_metadata')).toBe('1.2.4');
    expect(deriveNextPublicationVersion('9007199254740993.0.0', 'representation_contract')).toBe(
      '9007199254740994.0.0',
    );
    expect(deriveNextPublicationNumber(null)).toBe(1);
    expect(deriveNextPublicationNumber(41)).toBe(42);
    expect(() => deriveNextPublicationNumber(MAX_PUBLICATION_NUMBER)).toThrow(/six-digit/u);

    expect(
      validatePublicationSequence({
        previousVersion: '1.2.3',
        previousPublicationNumber: 41,
        targetVersion: '1.3.0',
        targetPublicationNumber: 42,
        impact: 'normative_projection',
      }),
    ).toMatchObject({ targetVersion: '1.3.0', targetPublicationNumber: 42 });
    expect(() =>
      validatePublicationSequence({
        previousVersion: '1.2.3',
        previousPublicationNumber: 41,
        targetVersion: '1.2.4',
        targetPublicationNumber: 43,
        impact: 'normative_projection',
      }),
    ).toThrow();
  });

  it('generates distinct stable identifiers and the append-only manifest path', () => {
    const generated = [PUBLICATION_ID, IDEMPOTENCY_KEY];
    const identifiers = createPublicationIdentifiers(() => generated.shift() ?? 'missing');

    expect(identifiers).toEqual({
      publicationId: PUBLICATION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(Object.isFrozen(identifiers)).toBe(true);
    expect(publicationManifestRelativePath('lei-de-introducao', 42, '1.3.0')).toBe(
      'leis/lei-de-introducao/.vinculex/releases/000042-1.3.0.json',
    );
    expect(() => publicationManifestRelativePath('../escape', 42, '1.3.0')).toThrow();
  });
});
