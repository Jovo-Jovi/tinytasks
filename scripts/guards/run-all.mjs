#!/usr/bin/env node
// Runs every local guard. Node only, no network. Guards are cheap structural checks
// that keep the automation honest between cycles.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectDir = process.cwd();

const guardFiles = readdirSync(here).filter((f) => f.endsWith('.mjs') && f !== 'run-all.mjs').sort();
const failures = [];

for (const f of guardFiles) {
  const r = spawnSync('node', [join(here, f)], { cwd: projectDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const ok = r.status === 0;
  console.log(`[guard] ${f.replace('.mjs', '')}: ${ok ? 'ok' : 'FAILED'}`);
  if (!ok) failures.push({ guard: f, out: `${String(r.stdout || '')}${String(r.stderr || '')}`.trim() });
}

if (failures.length) {
  console.log('');
  for (const f of failures) {
    console.log(`guard ${f.guard} says:`);
    console.log(f.out.slice(0, 4000));
    console.log('');
  }
  process.exit(1);
}
console.log('[guard] all guards green.');
