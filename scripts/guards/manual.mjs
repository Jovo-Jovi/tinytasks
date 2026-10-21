#!/usr/bin/env node
// manual guard: docs/method/AUTOMATION.md must name every workflow, every runner script,
// every label, and every repository variable. The manual is the map of the machine.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const problems = [];
const manualPath = join(root, 'docs', 'method', 'AUTOMATION.md');
if (!existsSync(manualPath)) { console.log('docs/method/AUTOMATION.md is missing.'); process.exit(1); }
const manual = readFileSync(manualPath, 'utf8');

const mustMention = [];
const wfDir = join(root, '.github', 'workflows');
if (existsSync(wfDir)) {
  for (const f of readdirSync(wfDir)) if (f.endsWith('.yml')) mustMention.push(f);
}
const scriptDirs = [join(root, 'scripts', 'devos'), join(root, 'scripts', 'guards')];
for (const d of scriptDirs) {
  if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.mjs')) mustMention.push(f);
}
mustMention.push('devos:human-gate', 'devos:halted', 'devos:setup', 'DEVOS_ACTIVE_MODULES', 'DEVOS_TYPE', 'DEVOS_FRAMEWORK');

for (const name of mustMention) {
  if (!manual.includes(name)) problems.push(`the manual does not name ${name}.`);
}

if (problems.length) { console.log(problems.map((x) => `- ${x}`).join('\n')); process.exit(1); }
