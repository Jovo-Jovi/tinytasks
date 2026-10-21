#!/usr/bin/env node
// devos-advance: after a human merges a gated task, mark the ledger done and dispatch
// the next cycle. The human merges gates; this script only moves the ledger forward.
import { readProjectJson, nextTask, updatePhaseRow, git, gh } from './common.mjs';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;
const taskId = process.argv[2] || (nextTask(projectDir) || {}).id;

if (!taskId) { console.log('[advance] nothing to advance'); process.exit(0); }

updatePhaseRow(projectDir, taskId, { status: 'done', gate: 'merged' });
git(['add', 'docs/PHASES.md']);
git(['commit', '-m', `devos: ${taskId} merged by human gate`], { allowFail: true });
git(['push', 'origin', cfg.base || 'main'], { allowFail: true });
gh(['workflow', 'run', 'devos-cycle.yml', '--repo', repo, '--ref', cfg.base || 'main']);
console.log(`[advance] ${taskId} done; next cycle dispatched.`);
