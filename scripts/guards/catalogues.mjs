#!/usr/bin/env node
// catalogues guard: with more than one language, every locale file carries the same keys.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function flatKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...flatKeys(v, key));
    else out.push(key);
  }
  return out.sort();
}

const localesDir = join(root, 'src', 'i18n', 'locales');
const altDir = join(root, 'locales');
const dir = existsSync(localesDir) ? localesDir : (existsSync(altDir) ? altDir : null);

// Count configured languages from devos/project.json when present.
let languages = ['en'];
try {
  const cfg = JSON.parse(readFileSync(join(root, 'devos', 'project.json'), 'utf8'));
  languages = cfg.languages || ['en'];
} catch { /* standalone run */ }

if (languages.length <= 1) { process.exit(0); } // parity guard only turns on with more than one language

if (!dir) {
  console.log('languages configured: ' + languages.join(', '));
  console.log('- no locales directory found (src/i18n/locales or locales).');
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const byLang = new Map();
for (const f of files) byLang.set(f.replace(/\.json$/, ''), flatKeys(JSON.parse(readFileSync(join(dir, f), 'utf8'))));

const problems = [];
for (const lang of languages) {
  if (!byLang.has(lang)) problems.push(`locale file for "${lang}" is missing in ${dir}.`);
}
const it = byLang.entries().next();
if (!it.done) {
  const base = it.value;
  for (const [lang, keys] of byLang) {
    const missing = base[1].filter((k) => !keys.includes(k));
    if (missing.length) problems.push(`${lang} is missing keys: ${missing.slice(0, 8).join(', ')}`);
  }
}

if (problems.length) { console.log(problems.map((x) => `- ${x}`).join('\n')); process.exit(1); }
