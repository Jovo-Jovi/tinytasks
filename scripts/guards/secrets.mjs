#!/usr/bin/env node
// secrets guard: no credential value may be committed. Scans tracked-looking files for
// private keys, live provider keys, and .env files (only .env.example with names is allowed).
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const problems = [];

const PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key block'],
  [/sk_live_[A-Za-z0-9]{10,}/, 'a live Stripe secret key'],
  [/AKIA[0-9A-Z]{16}/, 'an AWS access key id'],
  [/ghp_[A-Za-z0-9]{20,}/, 'a GitHub personal access token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'a GitHub fine-grained token'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'something shaped like a signed JWT'],
];

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules' || name === 'devos/state') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

const files = walk(root);
for (const rel of files) {
  if (rel.endsWith('.env') || rel === '.env.production' || rel === '.env.local') {
    problems.push(`${rel}: a real .env file must not be committed. Keep names in .env.example only.`);
    continue;
  }
  let text;
  try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
  for (const [re, what] of PATTERNS) {
    if (re.test(text)) problems.push(`${rel}: contains ${what}.`);
  }
}

if (problems.length) {
  console.log(problems.map((p) => `- ${p}`).join('\n'));
  process.exit(1);
}
