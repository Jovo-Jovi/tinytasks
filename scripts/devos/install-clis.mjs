#!/usr/bin/env node
// Installs the agent CLIs this project's cycle runs: the reviewer and every
// builder in the pool. Called by .github/workflows/devos-cycle.yml before the
// cycle; also useful locally after a fresh clone. The recipes are the ones
// proven on real runners: the Cursor CLI comes from cursor.com/install (its
// binary lands in ~/.cursor/bin, which is NOT on PATH by default — on Actions
// this script appends it to GITHUB_PATH), the rest are npm globals.
// Custom tools (custom:<command>) are the developer's own responsibility and
// are skipped with a line that says so.
// `--print` shows the plan without installing anything (no network).
import { spawnSync } from 'node:child_process';
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { commandFor } from './common.mjs';

const printOnly = process.argv.includes('--print');

const INSTALL = {
  cursor: ['bash', ['-c', 'curl https://cursor.com/install -fsS | bash']],
  claude: ['npm', ['install', '-g', '@anthropic-ai/claude-code']],
  codex: ['npm', ['install', '-g', '@openai/codex']],
  gemini: ['npm', ['install', '-g', '@google/gemini-cli']],
};

function neededClis(cfg) {
  const ids = [];
  const push = (c) => { if (c && !ids.includes(c)) ids.push(c); };
  push(cfg.reviewer?.cli);
  if (cfg.lightReviewer && cfg.lightReviewer.same !== true) push(cfg.lightReviewer.cli);
  for (const b of cfg.builderPool || []) push(b.cli);
  push(cfg.builder?.cli);
  return ids;
}

const cfgPath = join(process.cwd(), 'devos', 'project.json');
if (!existsSync(cfgPath)) {
  console.error('install-clis: devos/project.json is missing — run this from the project root.');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

const plan = neededClis(cfg).map((id) => {
  const inst = INSTALL[id];
  return inst
    ? { id, cmd: inst[0], args: inst[1] }
    : { id, skip: true };
});

if (printOnly) {
  for (const p of plan) {
    console.log(p.skip
      ? `would skip ${p.id} (no known installer — add its install step to the workflow yourself)`
      : `would install ${p.id} (${p.cmd} ${p.args.join(' ')})`);
  }
  process.exit(0);
}

for (const p of plan) {
  if (p.skip) {
    console.log(`install-clis: skipping ${p.id} — no known installer; the cycle fails later with a clear message if it is needed`);
    continue;
  }
  console.log(`install-clis: installing ${p.id} (${p.cmd} ${p.args.join(' ')})…`);
  const r = spawnSync(p.cmd, p.args, { encoding: 'utf8', stdio: 'inherit' });
  if (r.status !== 0 || r.error) {
    console.error(`install-clis: the ${p.id} installer did not finish (exit ${r.status}${r.error ? `, ${r.error}` : ''}).`);
    console.error('install-clis: the cycle would fail on this CLI — fix the install step in .github/workflows/devos-cycle.yml.');
    process.exit(1);
  }
}

// The Cursor installer does not touch PATH by itself; on Actions, entries added
// to $GITHUB_PATH apply to every later step of the same job.
const pathFile = process.env.GITHUB_PATH;
if (pathFile && plan.some((p) => p.id === 'cursor')) {
  for (const dir of [join(homedir(), '.cursor', 'bin'), join(homedir(), '.local', 'bin')]) {
    try { appendFileSync(pathFile, `${dir}\n`); } catch { /* not on Actions; harmless */ }
  }
}

// Sanity: every CLI this script was asked for must answer --version now — the
// same check the cycle's pre-flight performs, so a silent PATH problem surfaces
// here with the installer's own output nearby, not three steps later.
for (const p of plan) {
  if (p.skip) continue;
  const cmd = commandFor(p.id);
  const v = spawnSync(cmd, ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  console.log(v.status === null || v.error
    ? `install-clis: WARNING — ${cmd} still does not start (the cycle will refuse to run)`
    : `install-clis: ${cmd} answers --version`);
}
