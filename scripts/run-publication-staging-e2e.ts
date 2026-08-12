import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  deriveStructuredChanges,
  formatar,
  generateUpdateMarkdown,
  identifiedMinima,
} from '@lex-editor/legal-domain';

import { commitAndPushPublicationCandidate } from '../src/main/publication/candidate-git.js';
import { getProvenPublicationState } from '../src/main/publication/journal.js';
import {
  publicationIdentifiedAstRelativePath,
  publicationManifestRelativePath,
  publicationSourceSnapshotRelativePath,
  serializeCanonicalJson,
  serializePublicationManifest,
} from '../src/shared/publication/manifest.js';

const PROJECT_REF = 'avwrnoaahikucbnittzb';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/publisher`;
const GITHUB_REPOSITORY = 'tiagobfaustino/lex-editor-publication-staging';
const execFileAsync = promisify(execFile);

type ApiKey = Readonly<{ name: string; type: string; api_key: string }>;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const command = async (file: string, arguments_: readonly string[], cwd?: string) => {
  const result = await execFileAsync(file, [...arguments_], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
};

const requestJson = async <T>(
  url: string,
  options: RequestInit,
  expectedStatus: number | readonly number[],
): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
  const accepted = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  const rawBody = await response.text();
  if (!accepted.includes(response.status)) {
    let code = 'unexpected_response';
    try {
      const parsed = JSON.parse(rawBody) as { error?: string; code?: string };
      code = parsed.error ?? parsed.code ?? code;
    } catch {
      // Do not echo an untrusted remote response into CI output.
    }
    throw new Error(`Staging request failed (${String(response.status)}, ${code}).`);
  }
  if (rawBody.length === 0) return undefined as T;
  return JSON.parse(rawBody) as T;
};

const restHeaders = (apiKey: string, authorization = apiKey): Record<string, string> => ({
  apikey: apiKey,
  authorization: `Bearer ${authorization}`,
  'content-type': 'application/json',
});

const functionRequest = async <T>(accessToken: string, body: unknown): Promise<T> => {
  const response = await requestJson<{ result: T }>(
    FUNCTION_URL,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    200,
  );
  return response.result;
};

const updateSourceReferences = (node: Record<string, unknown>, artifactSha256: string): void => {
  const sourceRef = node['sourceRef'];
  if (typeof sourceRef !== 'object' || sourceRef === null || Array.isArray(sourceRef)) {
    throw new Error('Invalid staging AST source reference.');
  }
  node['sourceRef'] = { ...sourceRef, sourceArtifactSha256: artifactSha256 };
  const children = node['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      updateSourceReferences(child as Record<string, unknown>, artifactSha256);
    }
  }
};

const run = async (): Promise<void> => {
  const keysOutput = await command('supabase', [
    'projects',
    'api-keys',
    '--project-ref',
    PROJECT_REF,
    '--output',
    'json',
  ]);
  const keysJsonStart = /\[\s*\{/u.exec(keysOutput)?.index;
  const keysJsonEnd = keysOutput.lastIndexOf(']');
  if (keysJsonStart === undefined || keysJsonEnd < keysJsonStart) {
    throw new Error('Staging API key response was not valid JSON.');
  }
  const keys = JSON.parse(keysOutput.slice(keysJsonStart, keysJsonEnd + 1)) as ApiKey[];
  const anonKey = keys.find((key) => key.name === 'anon' && key.type === 'legacy')?.api_key;
  const serviceRoleKey = keys.find(
    (key) => key.name === 'service_role' && key.type === 'legacy',
  )?.api_key;
  if (anonKey === undefined || serviceRoleKey === undefined) {
    throw new Error('Required staging API keys are unavailable.');
  }

  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const publicationId = randomUUID();
  const idempotencyKey = randomUUID();
  const lawId = randomUUID();
  const password = `${randomUUID()}Aa1!`;
  const email = `lex-editor-staging+${suffix}@example.com`;
  const directoryName = `staging-${suffix}`;
  const sigla = `stg${suffix}`;
  const root = await mkdtemp(join(tmpdir(), 'lex-publication-staging-'));
  const repositoryRoot = join(root, 'repository');
  const journalRoot = join(root, 'journal');

  try {
    const createdUser = await requestJson<{ id: string }>(
      `${SUPABASE_URL}/auth/v1/admin/users`,
      {
        method: 'POST',
        headers: restHeaders(serviceRoleKey),
        body: JSON.stringify({ email, password, email_confirm: true }),
      },
      200,
    );
    const userId = createdUser.id;
    if (!/^[0-9a-f-]{36}$/u.test(userId)) throw new Error('Invalid staging user identity.');

    await requestJson<undefined>(
      `${SUPABASE_URL}/rest/v1/usuarios_perfil`,
      {
        method: 'POST',
        headers: { ...restHeaders(serviceRoleKey), Prefer: 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          nome_exibicao: 'Editor jurídico de staging',
          papel: 'curador',
          account_status: 'active',
        }),
      },
      201,
    );
    await requestJson<undefined>(
      `${SUPABASE_URL}/rest/v1/leis`,
      {
        method: 'POST',
        headers: { ...restHeaders(serviceRoleKey), Prefer: 'return=minimal' },
        body: JSON.stringify({
          id: lawId,
          sigla,
          titulo: `Lei sintética de staging ${suffix}`,
          tipo: 'lei ordinária',
          numero: suffix,
          ano: 2026,
          ramo: 'staging',
          fonte_url: 'https://www.planalto.gov.br/',
          data_publicacao: '2026-08-11',
          publication_status: 'draft',
        }),
      },
      201,
    );

    const session = await requestJson<{ access_token: string; user: { id: string } }>(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: restHeaders(anonKey),
        body: JSON.stringify({ email, password }),
      },
      200,
    );
    if (session.user.id !== userId || session.access_token.length < 20) {
      throw new Error('Staging authentication did not establish the expected identity.');
    }

    await command('gh', ['repo', 'clone', GITHUB_REPOSITORY, repositoryRoot]);
    await command('git', ['config', 'user.name', 'Lex Editor Staging'], repositoryRoot);
    await command('git', ['config', 'user.email', 'staging@example.invalid'], repositoryRoot);
    const baseSha = await command('git', ['rev-parse', 'HEAD'], repositoryRoot);

    const snapshot = `<html><body>Fonte sintética de staging ${suffix}</body></html>\n`;
    const snapshotSha = sha256(snapshot);
    const ast = structuredClone(identifiedMinima);
    ast.sigla = sigla;
    ast.titulo = `Lei sintética de staging ${suffix}`;
    ast.numero = suffix;
    ast.publicationStatus = 'approved';
    const firstChild = ast.children[0];
    if (firstChild === undefined) throw new Error('The staging AST has no legal device.');
    firstChild.blockId = `${sigla}-art-1`;
    updateSourceReferences(ast as unknown as Record<string, unknown>, snapshotSha);
    const astCanonical = serializeCanonicalJson(ast);
    const formatted = formatar(ast);
    if (!formatted.ok) throw new Error('The staging AST could not be formatted.');
    const changes = deriveStructuredChanges(null, ast);
    const today = new Date().toISOString().slice(0, 10);
    const changelog = {
      publicationDate: today,
      version: '1.0.0',
      publicationNumber: 1,
      kind: 'initial' as const,
      sourceSummary: 'Publicação sintética validada no ambiente exclusivo de staging.',
      changes,
    };
    const updateMarkdown = generateUpdateMarkdown([changelog]);
    const manifest = {
      schemaVersion: 1 as const,
      publicationId,
      idempotencyKey,
      law: { lawId, directoryName },
      target: {
        version: '1.0.0',
        publicationNumber: 1,
        kind: 'initial' as const,
        impact: 'normative_projection' as const,
        restoredVersionId: null,
      },
      expectedBase: { gitCommitSha: baseSha, publishedVersionId: null },
      artifacts: {
        markdownSha256: sha256(formatted.valor),
        updateMarkdownSha256: sha256(updateMarkdown),
        identifiedAstSha256: sha256(astCanonical),
      },
      sourceSnapshots: [
        {
          sourceType: 'planalto_html' as const,
          sourceRole: 'primary_current' as const,
          sourceVariant: 'compiled' as const,
          sourceArtifactSha256: snapshotSha,
          capturedAt: new Date().toISOString(),
        },
      ],
      approvedBy: { userId, role: 'editor_juridico' as const },
      changelog,
      preparedAt: new Date().toISOString(),
    };
    const manifestCanonical = serializePublicationManifest(manifest);
    const manifestDigest = sha256(manifestCanonical);

    const lawRoot = join(repositoryRoot, 'leis', directoryName);
    const markdownRelativePath = `leis/${directoryName}/${sigla}.md`;
    const manifestRelativePath = publicationManifestRelativePath(directoryName, 1, '1.0.0');
    const astRelativePath = publicationIdentifiedAstRelativePath(directoryName, 1, '1.0.0');
    const snapshotRelativePath = publicationSourceSnapshotRelativePath(directoryName, snapshotSha);
    await mkdir(join(lawRoot, '.vinculex', 'releases'), { recursive: true });
    await mkdir(join(lawRoot, '.vinculex', 'sources'), { recursive: true });
    await writeFile(join(repositoryRoot, markdownRelativePath), formatted.valor, 'utf8');
    await writeFile(join(lawRoot, 'UPDATE.md'), updateMarkdown, 'utf8');
    await writeFile(join(repositoryRoot, manifestRelativePath), manifestCanonical, 'utf8');
    await writeFile(join(repositoryRoot, astRelativePath), astCanonical, 'utf8');
    await writeFile(join(repositoryRoot, snapshotRelativePath), snapshot, 'utf8');

    const approval = await functionRequest<{
      approvalId: string;
      publicationId: string;
      manifestDigest: string;
      userId: string;
    }>(session.access_token, { action: 'approve', publicationId, manifestDigest });
    if (
      approval.publicationId !== publicationId ||
      approval.manifestDigest !== manifestDigest ||
      approval.userId !== userId
    ) {
      throw new Error('Server-side approval evidence does not match the candidate.');
    }

    const journal = await commitAndPushPublicationCandidate({
      repositoryRoot,
      storageRoot: journalRoot,
      manifestCanonical,
      approval,
      markdownRelativePath,
    });
    const proven = getProvenPublicationState(journal);
    if (proven.status !== 'pushed' || proven.gitCommitSha === null) {
      throw new Error('Candidate push was not proven by the local journal.');
    }
    const candidateSha = proven.gitCommitSha;

    const published = await functionRequest<{
      publicationId: string;
      candidateSha: string;
      publicationAttemptStatus: string;
      publishedVersionId: string | null;
    }>(session.access_token, { action: 'publish', publicationId, candidateSha });
    if (
      published.publicationAttemptStatus !== 'published' ||
      published.publishedVersionId === null ||
      published.candidateSha !== candidateSha
    ) {
      throw new Error('Hosted publisher did not confirm the exact candidate.');
    }

    const repeated = await functionRequest<typeof published>(session.access_token, {
      action: 'publish',
      publicationId,
      candidateSha,
    });
    const attempt = await functionRequest<typeof published>(session.access_token, {
      action: 'getAttempt',
      publicationId,
    });
    if (
      repeated.publishedVersionId !== published.publishedVersionId ||
      attempt.publishedVersionId !== published.publishedVersionId
    ) {
      throw new Error('Hosted retry was not idempotent.');
    }

    const publicLaw = await requestJson<
      readonly { id: string; publication_status: string; versao_publicada_id: string }[]
    >(
      `${SUPABASE_URL}/rest/v1/leis?select=id,publication_status,versao_publicada_id&id=eq.${lawId}`,
      { headers: restHeaders(anonKey) },
      200,
    );
    const publicVersions = await requestJson<readonly { id: string }[]>(
      `${SUPABASE_URL}/rest/v1/versoes_lei?select=id&lei_id=eq.${lawId}`,
      { headers: restHeaders(anonKey) },
      200,
    );
    const canonicalSha = (
      await command('git', ['ls-remote', 'origin', 'refs/heads/main'], repositoryRoot)
    ).split(/\s+/u)[0];
    if (
      publicLaw.length !== 1 ||
      !publicLaw.some(
        (law) =>
          law.publication_status === 'published' &&
          law.versao_publicada_id === published.publishedVersionId,
      ) ||
      publicVersions.length !== 1 ||
      !publicVersions.some((version) => version.id === published.publishedVersionId) ||
      canonicalSha !== candidateSha
    ) {
      throw new Error('Public database state and canonical Git state are not atomic/equivalent.');
    }

    console.log(
      JSON.stringify({
        result: 'staging_publication_passed',
        projectRef: PROJECT_REF,
        repository: GITHUB_REPOSITORY,
        publicationId,
        lawId,
        candidateSha,
        publishedVersionId: published.publishedVersionId,
        idempotentRetry: true,
        anonymousReadVerified: true,
      }),
    );
  } finally {
    await rm(root, { recursive: true });
  }
};

await run();
