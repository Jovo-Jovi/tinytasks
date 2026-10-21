#!/usr/bin/env node
// devos-supervisor: catches stuck automation. A park older than six hours, a task in
// progress with no recent cycle run, or a halted task all become a visible issue.
import { readProjectJson, readState, parsePhases, gh } from './common.mjs';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;

const problems = [];
const park = readState('park.json', projectDir);
if (park) {
  const ageH = (Date.now() - new Date(park.at).getTime()) / 3_600_000;
  if (ageH > 6) problems.push(`parked on ${park.reason} for ${ageH.toFixed(1)}h (task ${park.task}). Check the model account, then run devos-resume.`);
}
try {
  const rows = parsePhases(projectDir);
  const halted = rows.filter((r) => r.status === 'halted');
  if (halted.length) problems.push(`halted: ${halted.map((r) => r.id).join(', ')}. The ledger waits for your decision.`);
} catch { /* doctor reports ledger problems */ }

if (problems.length) {
  gh(['issue', 'create', '--repo', repo, '--title', 'Dev OS: supervisor notes', '--body', problems.join('\n\n')], { allowFail: true });
  console.log('[supervisor] notes filed.');
} else {
  console.log('[supervisor] nothing stuck.');
}
