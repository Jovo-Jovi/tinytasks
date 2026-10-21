#!/usr/bin/env node
// devos-doctor: scheduled health check of the automation itself. Runs the guards and
// verifies the ledger parses. On failure it opens or updates an issue.
import { spawnSync } from 'node:child_process';
import { readProjectJson, gh, parsePhases } from './common.mjs';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;

const problems = [];
const guard = spawnSync('node', ['scripts/guards/run-all.mjs'], { cwd: projectDir, encoding: 'utf8' });
if (guard.status !== 0) problems.push(`guards failed:\n${String(guard.stdout)}${String(guard.stderr)}`);
try {
  const rows = parsePhases(projectDir);
  if (!rows.length) problems.push('docs/PHASES.md has no ledger rows.');
  const halted = rows.filter((r) => r.status === 'halted');
  if (halted.length) problems.push(`halted tasks: ${halted.map((r) => r.id).join(', ')}`);
} catch (e) {
  problems.push(`ledger unreadable: ${e.message}`);
}

if (problems.length) {
  gh(['issue', 'create', '--repo', repo, '--title', 'Dev OS: doctor found problems',
    '--body', problems.join('\n\n')], { allowFail: true });
  console.log('[doctor] problems found; issue opened.');
  process.exitCode = 1;
} else {
  console.log('[doctor] all green.');
}
