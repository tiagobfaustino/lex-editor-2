import { execFileSync, spawnSync } from 'node:child_process';

const isGitCheckout =
  spawnSync('git', ['rev-parse', '--git-dir'], {
    stdio: 'ignore',
  }).status === 0;

if (isGitCheckout) {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], {
    stdio: 'inherit',
  });
}
