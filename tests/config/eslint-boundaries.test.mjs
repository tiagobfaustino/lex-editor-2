import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();

const deniedCases = [
  {
    name: 'legal-domain -> Node',
    filePath: 'packages/legal-domain/src/boundary-check.js',
    code: "import fs from 'node:fs';\nvoid fs;\n",
  },
  {
    name: 'source-ingestion -> Node',
    filePath: 'packages/source-ingestion/src/boundary-check.js',
    code: "import fs from 'node:fs';\nvoid fs;\n",
  },
  {
    name: 'source-ingestion Node -> main',
    filePath: 'packages/source-ingestion/src/node/boundary-check.js',
    code: "import * as main from '../../../../src/main/index.js';\nvoid main;\n",
  },
  {
    name: 'shared/ipc -> legal-domain',
    filePath: 'src/shared/ipc/boundary-check.js',
    code: "import * as domain from '@lex-editor/legal-domain';\nvoid domain;\n",
  },
  {
    name: 'main -> renderer',
    filePath: 'src/main/boundary-check.js',
    code: "import * as renderer from '../renderer/index.js';\nvoid renderer;\n",
  },
  {
    name: 'shared/publication -> Node',
    filePath: 'src/shared/publication/boundary-check.js',
    code: "import fs from 'node:fs';\nvoid fs;\n",
  },
  {
    name: 'publisher -> main',
    filePath: 'services/publisher/src/boundary-check.js',
    code: "import * as main from '../../../src/main/index.js';\nvoid main;\n",
  },
  {
    name: 'source-catalog -> renderer',
    filePath: 'services/source-catalog/src/boundary-check.js',
    code: "import * as renderer from '../../../src/renderer/index.js';\nvoid renderer;\n",
  },
  {
    name: 'preload -> main',
    filePath: 'src/preload/boundary-check.js',
    code: "import * as main from '../main/index.js';\nvoid main;\n",
  },
  {
    name: 'renderer -> Electron',
    filePath: 'src/renderer/boundary-check.js',
    code: "import * as electron from 'electron';\nvoid electron;\n",
  },
];

const allowedCases = [
  {
    name: 'legal-domain -> módulo interno',
    filePath: 'packages/legal-domain/src/boundary-check.js',
    code: "import * as local from './local.js';\nvoid local;\n",
  },
  {
    name: 'source-ingestion -> legal-domain',
    filePath: 'packages/source-ingestion/src/boundary-check.js',
    code: "import * as domain from '@lex-editor/legal-domain';\nvoid domain;\n",
  },
  {
    name: 'source-ingestion Node -> Node',
    filePath: 'packages/source-ingestion/src/node/boundary-check.js',
    code: "import crypto from 'node:crypto';\nvoid crypto;\n",
  },
  {
    name: 'main -> legal-domain',
    filePath: 'src/main/boundary-check.js',
    code: "import * as domain from '@lex-editor/legal-domain';\nvoid domain;\n",
  },
  {
    name: 'renderer -> shared/ipc',
    filePath: 'src/renderer/boundary-check.js',
    code: "import * as ipc from '../shared/ipc/index.js';\nvoid ipc;\n",
  },
  {
    name: 'publisher -> shared publication protocol',
    filePath: 'services/publisher/src/boundary-check.js',
    code: "import * as protocol from '../../../src/shared/publication/approval.js';\nvoid protocol;\n",
  },
  {
    name: 'source-catalog -> source-ingestion',
    filePath: 'services/source-catalog/src/boundary-check.js',
    code: "import * as contracts from '@lex-editor/source-ingestion';\nvoid contracts;\n",
  },
];

for (const testCase of deniedCases) {
  const [result] = await eslint.lintText(testCase.code, {
    filePath: testCase.filePath,
  });

  assert.ok(result, `${testCase.name}: ESLint não retornou resultado`);
  assert.ok(
    result.messages.some(({ ruleId }) => ruleId === 'no-restricted-imports'),
    `${testCase.name}: import proibido não foi bloqueado`,
  );
}

for (const testCase of allowedCases) {
  const [result] = await eslint.lintText(testCase.code, {
    filePath: testCase.filePath,
  });

  assert.ok(result, `${testCase.name}: ESLint não retornou resultado`);
  assert.deepEqual(result.messages, [], `${testCase.name}: import permitido produziu erro de lint`);
}
