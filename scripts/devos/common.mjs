// Shared helpers for the DEV_OS runner inside a bootstrapped project.
// Runs on GitHub Actions and locally (tests use fake git/gh/model executables).
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function readProjectJson(projectDir = process.cwd()) {
  const p = join(projectDir, 'devos', 'project.json');
  if (!existsSync(p)) throw new Error('devos/project.json is missing. This project was not bootstrapped by DEV_OS.');
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveProjectJson(cfg, projectDir = process.cwd()) {
  writeFileSync(join(projectDir, 'devos', 'project.json'), JSON.stringify(cfg, null, 2));
}

// The cycle reads reviewer and builder from devos/project.json. It refuses to run the
// configuration model: the configuration model is stage "configuration-only" and is never
// called after init. Sharing an id with the reviewer is fine — the role is what matters.
export function assertNotConfigurationModel(cfg, role, cli, model) {
  const cm = cfg.configurationModel || {};
  if (cm.stage !== 'configuration-only') {
    throw new Error(`The cycle refuses to run while configurationModel.stage is "${cm.stage}". The configuration model finished at init and never runs again.`);
  }
  if (role === 'configuration') {
    throw new Error('The cycle never runs the configuration model.');
  }
  if (!cli || !model) {
    throw new Error(`The ${role} row is empty. The cycle cannot run while a required row is empty.`);
  }
}

export function stateDir(projectDir = process.cwd()) {
  return join(projectDir, 'devos', 'state');
}

export function writeState(name, data, projectDir = process.cwd()) {
  mkdirSync(stateDir(projectDir), { recursive: true });
  writeFileSync(join(stateDir(projectDir), name), JSON.stringify(data, null, 2));
}

export function readState(name, projectDir = process.cwd()) {
  const p = join(stateDir(projectDir), name);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function gh(args, opts = {}) {
  const r = spawnSync('gh', args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts.spawn });
  if (r.status !== 0 && !opts.allowFail) {
    const err = new Error(`gh ${args.join(' ')} failed (exit ${r.status}): ${(r.stderr || r.stdout || '').trim().slice(0, 300)}`);
    err.toolMessage = (r.stderr || r.stdout || '').trim();
    err.exitCode = r.status;
    throw err;
  }
  return { code: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

export function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts.spawn });
  if (r.status !== 0 && !opts.allowFail) {
    const err = new Error(`git ${args.join(' ')} failed (exit ${r.status}): ${(r.stderr || '').trim().slice(0, 300)}`);
    err.toolMessage = (r.stderr || '').trim();
    err.exitCode = r.status;
    throw err;
  }
  return { code: r.status, out: String(r.stdout || '') };
}

const USAGE_LIMIT_PATTERNS = [
  /usage limit/i, /rate limit/i, /quota/i, /too many requests/i, /\b429\b/,
  /credit balance/i, /out of (credits|tokens)/i,
];

export function looksLikeUsageLimit(text, extraPattern) {
  const pats = extraPattern ? [new RegExp(extraPattern, 'i'), ...USAGE_LIMIT_PATTERNS] : USAGE_LIMIT_PATTERNS;
  return pats.some((re) => re.test(String(text || '')));
}

const MISSING_SECRET_RE = /^DEVOS_MISSING_SECRET:\s*([A-Z][A-Z0-9_]*)\s*$/m;

export function findMissingSecret(text) {
  const m = String(text || '').match(MISSING_SECRET_RE);
  return m ? m[1] : null;
}

// Known tool id -> executable command. Custom ids (custom:<cmd>) run the command itself.
export const TOOL_COMMANDS = { claude: 'claude', cursor: 'agent', codex: 'codex', gemini: 'gemini', glm: 'z', muse: 'muse' };

export function commandFor(cli) {
  if (String(cli).startsWith('custom:')) return String(cli).replace(/^custom:/, '');
  return TOOL_COMMANDS[cli] || cli;
}

// Non-interactive launch for every known CLI. Always passes --model; never a default model.
export function buildModelArgs(cli, model, promptFile) {
  switch (cli) {
    case 'claude': return ['-p', '--model', model, '--permission-mode', 'acceptEdits', '--allowedTools', 'Read', 'Edit', 'Write', 'Glob', 'Grep'];
    // --trust answers Cursor's one-time directory-trust gate: a CI checkout (or a locally
    // bootstrapped folder) is untrusted to a fresh cursor CLI, which would otherwise refuse
    // to start. It marks the folder trusted; it does not auto-approve tool calls (--yolo does).
    // model 'auto' sends no --model flag: Cursor then uses its Auto selection, which is the
    // only model Free plans are allowed to run.
    case 'cursor': return model === 'auto' ? ['--trust', '-p'] : ['--trust', '-p', '--model', model];
    case 'gemini': return ['-p', '--model', model];
    case 'muse': return ['-p', '--model', model];
    case 'glm': return ['-p', '--model', model];
    case 'codex': return ['exec', '--model', model, promptFile];
    default:
      if (cli.startsWith('custom:')) return ['-p', '--model', model];
      throw new Error(`Unknown builder/reviewer CLI "${cli}". Register it with an adapter first.`);
  }
}

export function promptDelivery(cli) {
  return cli === 'codex' ? 'arg' : 'stdin';
}

// Runs one model step. The model never receives GITHUB_TOKEN: it does not run git or gh.
export function runModelStep({ projectDir, cli, model, role, prompt, log = () => {} }) {
  const promptFile = join(projectDir, 'devos', 'state', `${role}-prompt.md`);
  mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
  writeFileSync(promptFile, prompt);
  const args = buildModelArgs(cli, model, promptFile);
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  env.DEVOS_ROLE = role;
  env.DEVOS_CLI_ID = cli;
  env.DEVOS_MODEL = model;
  env.DEVOS_PROJECT_DIR = projectDir;
  log(`${role}: ${cli} ${model}`);
  const r = spawnSync(commandFor(cli), args, {
    cwd: projectDir, encoding: 'utf8', env,
    input: promptDelivery(cli) === 'stdin' ? prompt : undefined,
    shell: process.platform === 'win32',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = String(r.stdout || '');
  const err = String(r.stderr || '');
  return { code: r.status, out, err, combined: `${out}\n${err}`.trim() };
}

// docs/PHASES.md ledger: | id | title | status | attempt | risk | gate |
export function parsePhases(projectDir = process.cwd()) {
  const text = readFileSync(join(projectDir, 'docs', 'PHASES.md'), 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*(T\d+)\s*\|\s*(.+?)\s*\|\s*(not[\s-]?done|in[\s-]progress|done|halted)\s*\|\s*(\d+)\s*\|\s*(\d)\s*\|\s*(\S+)\s*\|$/i);
    if (m) rows.push({ id: m[1], title: m[2], status: m[3].toLowerCase().replace(/\s+/g, '-'), attempt: Number(m[4]), risk: Number(m[5]), gate: m[6] });
  }
  return rows;
}

export function updatePhaseRow(projectDir, id, patch) {
  const p = join(projectDir, 'docs', 'PHASES.md');
  const lines = readFileSync(p, 'utf8').split('\n');
  const out = lines.map((line) => {
    const m = line.match(/^\|\s*(T\d+)\s*\|/);
    if (!m || m[1] !== id) return line;
    const cells = line.split('|').map((c) => c.trim());
    // cells: ['', id, title, status, attempt, risk, gate, '']
    const row = {
      id: cells[1], title: cells[2],
      status: patch.status ?? cells[3],
      attempt: String(patch.attempt ?? cells[4]),
      risk: String(patch.risk ?? cells[5]),
      gate: patch.gate ?? cells[6],
    };
    return `| ${row.id} | ${row.title} | ${row.status} | ${row.attempt} | ${row.risk} | ${row.gate} |`;
  });
  writeFileSync(p, out.join('\n'));
}

export function nextTask(projectDir = process.cwd()) {
  const rows = parsePhases(projectDir);
  return rows.find((r) => r.status === 'not-done' || r.status === 'in-progress') || null;
}

// Fence: devos/fences/T01.md
//   Reviewer: <cli> <model>
//   Builder: <cli> <model>
export function parseFence(projectDir, taskId) {
  const p = join(projectDir, 'devos', 'fences', `${taskId}.md`);
  if (!existsSync(p)) throw new Error(`Fence devos/fences/${taskId}.md is missing.`);
  const text = readFileSync(p, 'utf8');
  const rev = text.match(/^Reviewer:\s*(\S+)\s+(\S+)\s*$/m);
  const bld = text.match(/^Builder:\s*(\S+)\s+(\S+)\s*$/m);
  const risk = Number((text.match(/^Risk:\s*(\d)\s*$/m) || [])[1] ?? 1);
  const attempt = Number((text.match(/^Attempt:\s*(\d+)\s*$/m) || [])[1] ?? 0);
  const gate = ((text.match(/^Gate:\s*(\S+)\s*$/m) || [])[1] ?? 'none').toLowerCase();
  const doneWhen = [...text.matchAll(/^-\s\[( |x)\]\s(.+)$/gm)].map((m) => m[2].trim());
  return { taskId, reviewer: rev ? { cli: rev[1], model: rev[2] } : null, builder: bld ? { cli: bld[1], model: bld[2] } : null, risk, attempt, gate, doneWhen, text, path: p };
}

export function writeFence(projectDir, fence) {
  writeFileSync(fence.path, fence.text);
}

// Review verdict: docs/reviews/T01-a1.md — the runner parses the file, never invents a verdict.
export function parseVerdict(projectDir, taskId, attempt) {
  const p = join(projectDir, 'docs', 'reviews', `${taskId}-a${attempt}.md`);
  if (!existsSync(p)) return { ok: false, reason: `Review file docs/reviews/${taskId}-a${attempt}.md is missing; the reviewer must write it.` };
  const text = readFileSync(p, 'utf8');
  const rows = [...text.matchAll(/^-\s\[(x| )\]\s(.*?)\s*[—-]\s*(PASS|FAIL)\s*$/gim)].map((m) => ({ checked: m[1] === 'x', text: m[2], verdict: m[3].toUpperCase() }));
  const final = [...text.matchAll(/^VERDICT:\s*(PASS|FAIL)\s*$/gim)].map((m) => m[1].toUpperCase());
  if (!rows.length || final.length !== 1) {
    return { ok: false, reason: 'The review file has no parseable per-row verdicts or no single final VERDICT line. The runner does not invent verdicts.' };
  }
  const allPass = rows.every((r) => r.verdict === 'PASS');
  const verdict = final[0];
  if ((verdict === 'PASS') !== allPass) {
    return { ok: false, reason: 'The final VERDICT line disagrees with the per-row verdicts. The reviewer must make them agree.' };
  }
  return { ok: true, verdict, rows };
}
