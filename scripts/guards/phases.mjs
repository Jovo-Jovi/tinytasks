#!/usr/bin/env node
// phases guard: every ledger row in docs/PHASES.md must be well formed.
// | Tnn | title | status | attempt | risk | gate |
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const p = join(root, 'docs', 'PHASES.md');
if (!existsSync(p)) { console.log('docs/PHASES.md is missing.'); process.exit(1); }

const text = readFileSync(p, 'utf8');
const problems = [];
const rows = [];
for (const line of text.split('\n')) {
  if (!/^\|\s*T\d+\s*\|/.test(line)) continue;
  rows.push(line);
  const cells = line.split('|').map((c) => c.trim());
  const id = cells[1];
  const status = cells[3];
  const attempt = Number(cells[4]);
  const risk = Number(cells[5]);
  const gate = cells[6];
  if (!/^T\d{2,}$/.test(id || '')) problems.push(`bad id "${id}" in row: ${line}`);
  if (!['not-done', 'not done', 'in-progress', 'in progress', 'done', 'halted'].includes((status || '').toLowerCase())) {
    problems.push(`bad status "${status}" for ${id}`);
  }
  if (!Number.isInteger(attempt) || attempt < 0) problems.push(`bad attempt "${cells[4]}" for ${id}`);
  if (![1, 2, 3].includes(risk)) problems.push(`risk must be 1, 2, or 3 for ${id}`);
  if (!gate || /\s/.test(gate)) problems.push(`bad gate "${gate}" for ${id}`);
}
if (!rows.length) problems.push('no ledger rows found; PHASES.md needs at least T01.');
const first = rows[0].split('|').map((c) => c.trim())[1];
const firstStatus = rows[0].split('|').map((c) => c.trim())[3].toLowerCase();
if (first === 'T01' && firstStatus === 'done' && !/T02/.test(text)) {
  problems.push('T01 is done but no next task exists; the reviewer must write the next fence.');
}

if (problems.length) { console.log(problems.map((x) => `- ${x}`).join('\n')); process.exit(1); }
