#!/usr/bin/env node
// boundary guard: visitor data stays inside the zones declared in docs/BOUNDARY_MODEL.md.
// Concretely: UI files never import the database or ORM, and never read secret env names.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const problems = [];

// zones: lines like "- zone: src/server  (what it holds)" in docs/BOUNDARY_MODEL.md
const boundaryPath = join(root, 'docs', 'BOUNDARY_MODEL.md');
if (!existsSync(boundaryPath)) { console.log('docs/BOUNDARY_MODEL.md is missing.'); process.exit(1); }
const boundary = readFileSync(boundaryPath, 'utf8');
const zones = [...boundary.matchAll(/^\s*[-*]\s*zone:\s*([\w/.-]+)/gm)].map((m) => m[1]);
if (!zones.length) problems.push('docs/BOUNDARY_MODEL.md declares no zones. Add lines like "- zone: src/server".');

const UI_DIRS = ['src/app', 'src/components', 'app', 'lib/screens', 'ui'];
const FORBIDDEN = [/from\s+['"].*(server\/database|database\.(ts|js)|drizzle|prisma|supabase-js|@supabase|mongoose)['"]/i,
  /process\.env\.[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|KEY)[A-Z0-9_]*/];

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

for (const ui of UI_DIRS) {
  for (const rel of walk(join(root, ui), root)) {
    const p = join(root, ui, rel);
    let text;
    try { text = readFileSync(p, 'utf8'); } catch { continue; }
    for (const re of FORBIDDEN) {
      if (re.test(text)) problems.push(`${ui}/${rel}: UI files must not touch the data layer or secrets. Keep data access in ${zones.join(', ') || 'src/server'}.`);
    }
  }
}

if (problems.length) { console.log([...new Set(problems)].map((x) => `- ${x}`).join('\n')); process.exit(1); }
