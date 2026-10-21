#!/usr/bin/env node
// devos-setup: checks that the secrets the project needs exist, and keeps the
// "Dev OS: setup needed" issue up to date. Names only; never a secret value.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectJson, gh } from './common.mjs';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;

// SETUP.md carries the canonical list of secret names, one per "- SECRET_NAME" bullet.
const setup = readFileSync(join(projectDir, 'SETUP.md'), 'utf8');
const names = [...setup.matchAll(/^-\s+([A-Z][A-Z0-9_]+)\s*$/gm)].map((m) => m[1]);

const have = gh(['secret', 'list', '--repo', repo, '--json', 'name', '-q', '.[].name'], { allowFail: true });
const haveSet = new Set(have.out.split('\n').map((s) => s.trim()).filter(Boolean));
const missing = names.filter((n) => !haveSet.has(n));

const body = missing.length
  ? ['These secret values are still missing. Type each one with gh on your computer:', '',
    ...missing.map((m) => `- \`${m}\``), '',
    'Never paste a secret value into an issue or a comment.'].join('\n')
  : 'All required secrets are set. You can close this issue.';

const existing = gh(['issue', 'list', '--repo', repo, '--state', 'open', '--json', 'title,number', '-q', '.[] | select(.title == "Dev OS: setup needed") | .number'], { allowFail: true });
if (existing.code === 0 && existing.out.trim()) {
  const n = existing.out.trim().split('\n')[0];
  if (missing.length) gh(['issue', 'comment', n, '--repo', repo, '--body', body], { allowFail: true });
  else gh(['issue', 'close', n, '--repo', repo, '--comment', body], { allowFail: true });
} else if (missing.length) {
  gh(['issue', 'create', '--repo', repo, '--title', 'Dev OS: setup needed', '--body', body, '--label', 'devos:setup'], { allowFail: true });
}
console.log(missing.length ? `[setup] missing: ${missing.join(', ')}` : '[setup] all secrets present.');
