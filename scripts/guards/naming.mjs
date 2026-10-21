#!/usr/bin/env node
// naming guard: documents must use this project's own words. The glossary defines them;
// the brief and the scope must use at least one glossary term each.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const problems = [];

const glossaryPath = join(root, 'docs', 'GLOSSARY.md');
if (!existsSync(glossaryPath)) { console.log('docs/GLOSSARY.md is missing.'); process.exit(1); }
const glossary = readFileSync(glossaryPath, 'utf8');
const terms = [...glossary.matchAll(/^\s*[-*]\s*\*\*(.+?)\*\*/gm)].map((m) => m[1]).filter((t) => t.length > 2);
if (terms.length < 3) problems.push('the glossary needs at least three defined terms.');

const usesTerm = (file) => {
  const p = join(root, file);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, 'utf8').toLowerCase();
  return terms.some((t) => text.includes(t.toLowerCase()));
};

for (const f of ['docs/PRODUCT_BRIEF.md', 'docs/SCOPE.md']) {
  const uses = usesTerm(f);
  if (uses === null) problems.push(`${f} is missing.`);
  else if (!uses) problems.push(`${f} uses none of the glossary's own words.`);
}

if (problems.length) { console.log(problems.map((x) => `- ${x}`).join('\n')); process.exit(1); }
