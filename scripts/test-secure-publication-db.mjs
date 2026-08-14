import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const containerName = `lex-publisher-db-test-${process.pid}`;

const execute = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('close', (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      }),
    );
    if (options.input === undefined) child.stdin.end();
    else child.stdin.end(options.input);
  });

const requireSuccess = async (command, args, options) => {
  const result = await execute(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
};

const waitForOutput = (stream, expected) =>
  new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}.`)), 5000);
    stream.on('data', (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes(expected)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

const psqlArguments = (user = 'postgres') => [
  'exec',
  '-i',
  containerName,
  'psql',
  '--set',
  'ON_ERROR_STOP=1',
  '--username',
  user,
  '--dbname',
  'lex_test',
];

try {
  await requireSuccess('docker', [
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--env',
    'POSTGRES_PASSWORD=postgres',
    '--env',
    'POSTGRES_DB=lex_test',
    'postgres:16-alpine',
  ]);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const readiness = await execute('docker', [...psqlArguments(), '--command', 'select 1']);
    if (readiness.code === 0) break;
    if (attempt === 29) throw new Error('PostgreSQL did not become ready.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  for (const path of [
    'tests/database/fixtures/publication-base.sql',
    'supabase/migrations/20260810180000_secure_publication.sql',
    'tests/database/secure-publication.test.sql',
    'supabase/migrations/20260811160000_legislative_update_queue.sql',
    'tests/database/legislative-update-queue.test.sql',
    'supabase/migrations/20260812120000_legal_reference_edges.sql',
    'tests/database/legal-reference-edges.test.sql',
    'supabase/migrations/20260813120000_source_catalog.sql',
    'tests/database/source-catalog.test.sql',
  ]) {
    await requireSuccess('docker', psqlArguments(), { input: await readFile(path) });
  }

  const workerDirectWrite = await execute('docker', [
    ...psqlArguments('update_worker_test'),
    '--command',
    "update public.leis set titulo = 'forged by worker' where id = '33333333-3333-4333-8333-333333333333'",
  ]);
  if (workerDirectWrite.code === 0 || !/permission denied/u.test(workerDirectWrite.stderr)) {
    throw new Error('The update worker unexpectedly wrote directly to normative content.');
  }

  const workerForbiddenOperations = [
    {
      label: 'mutate a published version',
      command:
        "update public.versoes_lei set changelog = 'forged by worker' " +
        "where lei_id = '33333333-3333-4333-8333-333333333333'",
    },
    {
      label: 'mutate a legal device',
      command:
        "update public.dispositivos set texto = 'forged by worker' " +
        "where lei_id = '33333333-3333-4333-8333-333333333333'",
    },
    {
      label: 'delete a Block ID',
      command:
        'delete from public.block_ids ' + "where lei_id = '33333333-3333-4333-8333-333333333333'",
    },
    {
      label: 'prepare a publication attempt',
      command: "select private.prepare_publication_attempt('{}'::jsonb)",
    },
    {
      label: 'publish a release',
      command: "select private.publish_validated_release('{}'::jsonb)",
    },
    {
      label: 'record a publication approval',
      command: `select private.record_publication_approval(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '44444444-4444-4444-8444-444444444444', repeat('a', 64), now()
      )`,
    },
    {
      label: 'assume the editorial role',
      command: 'set role lex_update_editor',
    },
  ];
  for (const probe of workerForbiddenOperations) {
    const result = await execute('docker', [
      ...psqlArguments('update_worker_test'),
      '--command',
      probe.command,
    ]);
    if (
      result.code === 0 ||
      !/permission denied|must be able to set role|must be member/u.test(result.stderr)
    ) {
      throw new Error(`The update worker unexpectedly managed to ${probe.label}.`);
    }
  }

  const workerEditorialDecision = await execute('docker', [
    ...psqlArguments('update_worker_test'),
    '--command',
    `select private.decide_legislative_update(
      '88888888-8888-4888-8888-888888888883',
      '44444444-4444-4444-8444-444444444444', 'approved', null,
      '99999999-9999-4999-8999-999999999999'
    )`,
  ]);
  if (
    workerEditorialDecision.code === 0 ||
    !/permission denied/u.test(workerEditorialDecision.stderr)
  ) {
    throw new Error('The update worker unexpectedly reached the editorial decision function.');
  }

  const sourceWorkerDirectWrite = await execute('docker', [
    ...psqlArguments('source_catalog_worker_test'),
    '--command',
    `update private.source_binding_health
     set source_health_state = 'healthy'
     where binding_id = 'bbbbbbbb-2000-4000-8000-000000000001'`,
  ]);
  if (
    sourceWorkerDirectWrite.code === 0 ||
    !/permission denied/u.test(sourceWorkerDirectWrite.stderr)
  ) {
    throw new Error('The source worker unexpectedly wrote directly to catalog health.');
  }

  const sourceWorkerAdminMutation = await execute('docker', [
    ...psqlArguments('source_catalog_worker_test'),
    '--command',
    `select private.append_source_provider_revision(
      'aaaaaaaa-0000-4000-8000-000000000001', 3, '{}'::jsonb
    )`,
  ]);
  if (
    sourceWorkerAdminMutation.code === 0 ||
    !/permission denied/u.test(sourceWorkerAdminMutation.stderr)
  ) {
    throw new Error('The source worker unexpectedly reached an administrative function.');
  }

  const sourceCatalogUnauthorizedRead = await execute('docker', [
    ...psqlArguments('source_catalog_unauthorized_test'),
    '--command',
    'select private.claim_due_source_checks(now(), 100)',
  ]);
  if (
    sourceCatalogUnauthorizedRead.code === 0 ||
    !/permission denied/u.test(sourceCatalogUnauthorizedRead.stderr)
  ) {
    throw new Error('An unauthorised identity unexpectedly read the source catalog.');
  }

  const sourceImporterDirectRead = await execute('docker', [
    ...psqlArguments('source_catalog_importer_test'),
    '--command',
    'select * from private.law_source_binding_revisions',
  ]);
  if (
    sourceImporterDirectRead.code === 0 ||
    !/permission denied/u.test(sourceImporterDirectRead.stderr)
  ) {
    throw new Error('The source importer unexpectedly read catalog tables directly.');
  }

  const sourceImporterAdminMutation = await execute('docker', [
    ...psqlArguments('source_catalog_importer_test'),
    '--command',
    `select private.change_law_source_binding_activation(
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-2000-4000-8000-000000000001', 6, 'paused'
    )`,
  ]);
  if (
    sourceImporterAdminMutation.code === 0 ||
    !/permission denied/u.test(sourceImporterAdminMutation.stderr)
  ) {
    throw new Error('The source importer unexpectedly reached an administrative function.');
  }

  const sourceImporterWorkerRead = await execute('docker', [
    ...psqlArguments('source_catalog_importer_test'),
    '--command',
    'select private.claim_due_source_checks(now(), 100)',
  ]);
  if (
    sourceImporterWorkerRead.code === 0 ||
    !/permission denied/u.test(sourceImporterWorkerRead.stderr)
  ) {
    throw new Error('The source importer unexpectedly reached a worker function.');
  }

  const unauthorized = await execute('docker', [
    ...psqlArguments('unauthorized_test'),
    '--command',
    "select private.publish_validated_release('{}'::jsonb)",
  ]);
  if (unauthorized.code === 0 || !/permission denied/u.test(unauthorized.stderr)) {
    throw new Error('An unauthorised role unexpectedly reached the publication function.');
  }

  const directWrite = await execute('docker', [
    ...psqlArguments('publisher_test'),
    '--command',
    "update public.leis set titulo = 'forged' where id = '33333333-3333-4333-8333-333333333333'",
  ]);
  if (directWrite.code === 0 || !/permission denied/u.test(directWrite.stderr)) {
    throw new Error('The publisher identity unexpectedly wrote directly to a protected table.');
  }

  const downgrade = await execute('docker', [
    ...psqlArguments('publisher_test'),
    '--command',
    `select private.mark_publication_attempt(
      '11111111-1111-4111-8111-111111111111',
      repeat('a', 40), 'failed', 'syncing', 'late_failure'
    )`,
  ]);
  if (downgrade.code === 0 || !/invalid publication transition/u.test(downgrade.stderr)) {
    throw new Error('A published attempt was unexpectedly downgraded to failed.');
  }

  const locker = spawn('docker', psqlArguments(), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lockerClosed = new Promise((resolve) => locker.on('close', resolve));
  const locked = waitForOutput(locker.stdout, 'LOCK_ACQUIRED');
  locker.stdin.end(`
begin;
select id from public.leis
where id = '33333333-3333-4333-8333-333333333333'
for update;
\\echo LOCK_ACQUIRED
select pg_sleep(2);
commit;
`);
  await locked;

  const contended = await execute('docker', [
    'exec',
    '--env',
    'PGOPTIONS=-c lock_timeout=250ms',
    '-i',
    containerName,
    'psql',
    '--set',
    'ON_ERROR_STOP=1',
    '--username',
    'publisher_test',
    '--dbname',
    'lex_test',
    '--command',
    'select private.prepare_publication_attempt(value) from public.test_publication_payload',
  ]);
  if (contended.code === 0 || !/lock timeout/u.test(contended.stderr)) {
    throw new Error('A concurrent publication did not wait for the per-law row lock.');
  }
  const lockerExit = await lockerClosed;
  if (lockerExit !== 0) throw new Error('The lock-holder session failed.');

  await requireSuccess('docker', psqlArguments(), {
    input: `
create table public.test_replay_payload (value jsonb not null);
insert into public.test_replay_payload (value)
select jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(value, '{publication,id}', '"66666666-6666-4666-8666-666666666666"'),
      '{publication,version}', '"9.9.9"'
    ),
    '{publication,gitCommitSha}', to_jsonb(repeat('6', 40))
  ),
  '{publication,manifestDigest}', to_jsonb(repeat('6', 64))
)
from public.test_publication_payload;
grant select on public.test_replay_payload to publisher_test;

create table public.test_publication_race_payload (
  name text primary key,
  value jsonb not null
);
with baseline as (
  select payload.value,
    law.versao_publicada_id::text as published_version_id,
    version.git_commit_sha as published_git_sha
  from public.test_publication_payload as payload
  cross join public.leis as law
  join public.versoes_lei as version on version.id = law.versao_publicada_id
  where law.id = '33333333-3333-4333-8333-333333333333'
), variants(name, publication_id, idempotency_key, version, sha, digest, device_id) as (
  values
    ('left', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '1.1.0', repeat('e', 40), repeat('e', 64),
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'),
    ('right', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '2.0.0', repeat('f', 40), repeat('f', 64),
      'dddddddd-dddd-4ddd-8ddd-ddddddddddd2')
)
insert into public.test_publication_race_payload (name, value)
select variants.name,
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(baseline.value, '{publication,id}', to_jsonb(variants.publication_id)),
                  '{publication,idempotencyKey}', to_jsonb(variants.idempotency_key)
                ),
                '{publication,version}', to_jsonb(variants.version)
              ),
              '{publication,publicationNumber}', '2'
            ),
            '{publication,kind}', '"legislative_update"'
          ),
          '{publication,gitCommitSha}', to_jsonb(variants.sha)
        ),
        '{publication,manifestDigest}', to_jsonb(variants.digest)
      ),
      '{publication,expectedPublishedVersionId}', to_jsonb(baseline.published_version_id)
    ),
    '{publication,expectedGitBaseSha}', to_jsonb(baseline.published_git_sha)
  ) || jsonb_build_object(
    'devices', jsonb_build_array(
      jsonb_set(baseline.value -> 'devices' -> 0, '{id}', to_jsonb(variants.device_id))
    )
  )
from baseline cross join variants;
grant select on public.test_publication_race_payload to publisher_test;
`,
  });

  await requireSuccess('docker', psqlArguments('publisher_test'), {
    input: `
select private.record_publication_approval(
  '67676767-6767-4767-8767-676767676767',
  '66666666-6666-4666-8666-666666666666',
  '44444444-4444-4444-8444-444444444444', repeat('6', 64), now()
);
`,
  });
  const replay = await execute('docker', [
    ...psqlArguments('publisher_test'),
    '--command',
    'select private.prepare_publication_attempt(value) from public.test_replay_payload',
  ]);
  if (replay.code === 0 || !/idempotency_key|idempotency/u.test(replay.stderr)) {
    throw new Error('A replay with a reused idempotency key was not rejected.');
  }

  await requireSuccess('docker', psqlArguments('publisher_test'), {
    input: `
select private.record_publication_approval(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '44444444-4444-4444-8444-444444444444', repeat('e', 64), now()
);
select private.record_publication_approval(
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  '44444444-4444-4444-8444-444444444444', repeat('f', 64), now()
);
select private.prepare_publication_attempt(value)
from public.test_publication_race_payload order by name;
select private.mark_publication_attempt(
  (value -> 'publication' ->> 'id')::uuid,
  value -> 'publication' ->> 'gitCommitSha',
  'syncing'
)
from public.test_publication_race_payload order by name;
`,
  });

  const raceResults = await Promise.all(
    ['left', 'right'].map((name) =>
      execute('docker', [
        ...psqlArguments('publisher_test'),
        '--command',
        `select private.publish_validated_release(value)
         from public.test_publication_race_payload where name = '${name}'`,
      ]),
    ),
  );
  const winners = raceResults.filter((result) => result.code === 0);
  const losers = raceResults.filter((result) => result.code !== 0);
  if (
    winners.length !== 1 ||
    losers.length !== 1 ||
    !/published pointer changed/u.test(losers[0]?.stderr ?? '')
  ) {
    throw new Error(
      `The publication race did not produce exactly one winner:\n${raceResults
        .map((result) => result.stderr || result.stdout)
        .join('\n')}`,
    );
  }

  const raceState = await requireSuccess('docker', [
    ...psqlArguments(),
    '--tuples-only',
    '--no-align',
    '--command',
    `select
      (select count(*) from public.versoes_lei),
      (select count(*) from public.publicacoes
       where id in (
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
         'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
       ) and publication_attempt_status = 'published')`,
  ]);
  if (raceState.stdout.trim() !== '2|1') {
    throw new Error(`The race persisted an invalid final state: ${raceState.stdout.trim()}`);
  }

  console.log('secure publication database checks passed');
} finally {
  await execute('docker', ['stop', '--timeout', '1', containerName]);
}
