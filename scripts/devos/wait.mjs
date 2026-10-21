#!/usr/bin/env node
// devos-wait: a gated task waits for the human to merge. When the gated pull request is
// merged, this script marks the ledger and dispatches devos-advance.
import { readProjectJson, updatePhaseRow, git, gh } from './common.mjs';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;
const taskId = process.argv[2];

if (!taskId) { console.log('[wait] no task given'); process.exit(0); }

// The gated PR is labeled devos:human-gate. A merge is the human's decision.
const prs = gh(['pr', 'list', '--repo', repo, '--state', 'merged', '--search', `devos:human-gate`, '--json', 'number,headRefName,title', '-q', `.[] | select(.headRefName == "task/${taskId}") | .number`], { allowFail: true });
if (prs.code === 0 && prs.out.trim()) {
  const branch = `task/${taskId}`;
  git(['branch', '-D', branch], { allowFail: true });
  gh(['workflow', 'run', 'devos-advance.yml', '--repo', repo, '--ref', cfg.base || 'main', '-f', `task=${taskId}`]);
  console.log(`[wait] ${taskId} was merged by a human; devos-advance dispatched.`);
} else {
  console.log(`[wait] ${taskId} is still waiting for your merge. The job: merge the pull request labeled devos:human-gate when devos/checks, devos/verdict, and devos/gate are green.`);
}
