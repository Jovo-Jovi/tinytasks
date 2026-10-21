#!/usr/bin/env node
// devos-cycle: one run is one attempt of one task on branch task/Tnn.
// Reads the reviewer and the builder from devos/project.json and the task fence.
// Never starts the configuration model. On PASS: merge, or label devos:human-gate and wait.
// On FAIL: the reviewer rewrites the fence, up to maxAttempts, then halt.
// On usage limit: move once to the next GitHub-capable builder in the pool, then park and resume.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProjectJson, assertNotConfigurationModel, runModelStep, looksLikeUsageLimit, findMissingSecret,
  nextTask, parseFence, parseVerdict, updatePhaseRow, gh, git, writeState,
} from './common.mjs';

const projectDir = process.cwd();
const log = (line) => console.log(`[cycle] ${line}`);

const readText = (p, fallback = '') => {
  try { return readFileSync(p, 'utf8'); } catch { return fallback; }
};

function fillPrompt(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function runCheck(cmd) {
  const r = spawnSync(cmd, { shell: true, cwd: projectDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, output: `${String(r.stdout || '').slice(-2500)}${String(r.stderr || '').slice(-2500)}`.trim() };
}

function runChecks(cfg) {
  const checks = cfg.requiredChecks || {};
  const results = [];
  for (const name of ['typecheck', 'lint', 'test', 'build']) {
    const cmd = checks[name];
    if (!cmd) continue;
    log(`check ${name}: ${cmd}`);
    const r = runCheck(cmd);
    results.push({ name, cmd, code: r.code, output: r.output });
    if (r.code !== 0) break; // fail fast; the reviewer sees why
  }
  return results;
}

function runGuards() {
  const r = spawnSync('node', ['scripts/guards/run-all.mjs'], { cwd: projectDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, output: `${String(r.stdout || '')}${String(r.stderr || '')}`.trim() };
}

function setupIssueFor(repo, missing) {
  const title = 'Dev OS: setup needed';
  const body = `The cycle needs the secret \`${missing}\`.\nType it on your computer:\n\n\`\`\`\ngh secret set ${missing} --repo ${repo}\n\`\`\`\nThen re-run the devos-cycle workflow. Never paste a secret value into an issue, a comment, or the model prompt.`;
  const existing = gh(['issue', 'list', '--repo', repo, '--state', 'open', '--json', 'title,number', '-q', '.[] | select(.title == "Dev OS: setup needed") | .number'], { allowFail: true });
  if (existing.code === 0 && existing.out.trim()) {
    gh(['issue', 'comment', existing.out.trim().split('\n')[0], '--repo', repo, '--body', body], { allowFail: true });
  } else {
    gh(['issue', 'create', '--repo', repo, '--title', title, '--body', body, '--label', 'devos:setup'], { allowFail: true });
  }
}

function dispatchNext(cfg, repo) {
  gh(['workflow', 'run', 'devos-cycle.yml', '--repo', repo, '--ref', cfg.base || 'main']);
}

function main() {
  const cfg = readProjectJson(projectDir);
  const repo = process.env.GITHUB_REPOSITORY || cfg.repo;

  const task = nextTask(projectDir);
  if (!task) { log('No task pending in docs/PHASES.md. Nothing to do.'); return; }
  const taskId = task.id;
  log(`task ${taskId}: ${task.title}`);

  const fence = parseFence(projectDir, taskId);
  const attempt = Math.max(Number(task.attempt) || 0, fence.attempt || 0) + 1;
  log(`attempt ${attempt} of ${cfg.maxAttempts}`);

  // Choose roles: the fence header wins when present; the config carries the pool and policy.
  let reviewer = fence.reviewer || cfg.reviewer;
  let builder = fence.builder || cfg.builder;
  if (cfg.pickPolicy === 'default-only') builder = cfg.builder;
  // An id outside the pool falls back to the default builder, and the run log says why.
  const pool = cfg.builderPool && cfg.builderPool.length ? cfg.builderPool : [cfg.builder];
  const inPool = pool.some((b) => b.cli === builder.cli && b.model === builder.model);
  if (!inPool) {
    log(`builder ${builder.cli} ${builder.model} is outside the pool; falling back to the default builder ${cfg.builder.cli} ${cfg.builder.model}.`);
    builder = cfg.builder;
  }

  // The cycle never runs the configuration model, for any role.
  assertNotConfigurationModel(cfg, 'reviewer', reviewer.cli, reviewer.model);
  assertNotConfigurationModel(cfg, 'builder', builder.cli, builder.model);

  // Fresh attempt branch from the base branch.
  const branch = `task/${taskId}`;
  git(['checkout', cfg.base || 'main']);
  git(['branch', '-D', branch], { allowFail: true });
  git(['checkout', '-b', branch]);

  const promptsDir = join(projectDir, 'devos', 'prompts');
  const builderPrompt = fillPrompt(readText(join(promptsDir, 'builder.md')), {
    TASK_ID: taskId, ATTEMPT: attempt, FENCE: fence.text, BRANCH: branch, MAX_ATTEMPTS: cfg.maxAttempts,
  });

  let builderRun = runModelStep({ projectDir, cli: builder.cli, model: builder.model, role: 'builder', prompt: builderPrompt, log });
  if (builderRun.code !== 0 && looksLikeUsageLimit(builderRun.combined, cfg.usageLimitPattern)) {
    // A usage limit is a wait, not a failed task. Move once to the next GitHub-capable builder in the pool.
    const next = pool.find((b) => !(b.cli === builder.cli && b.model === builder.model)
      && !(b.cli === (cfg.configurationModel || {}).cli && b.model === (cfg.configurationModel || {}).model));
    if (next) {
      log(`usage limit on ${builder.cli} ${builder.model}; moving once to ${next.cli} ${next.model}, then park and resume if needed.`);
      builder = next;
      builderRun = runModelStep({ projectDir, cli: builder.cli, model: builder.model, role: 'builder', prompt: builderPrompt, log });
    }
    if (builderRun.code !== 0 && looksLikeUsageLimit(builderRun.combined, cfg.usageLimitPattern)) {
      writeState('park.json', { task: taskId, attempt, builder, reason: 'usage limit', at: new Date().toISOString() }, projectDir);
      log('Parked on usage limit. devos-resume will dispatch this attempt again.');
      return;
    }
  }

  const missingSecret = findMissingSecret(builderRun.combined)
    || findMissingSecret(readText(join(projectDir, 'docs', 'reports', `${taskId}-a${attempt}.md`)));
  if (missingSecret) {
    log(`missing secret: ${missingSecret}. Opening the setup issue and waiting.`);
    setupIssueFor(repo, missingSecret);
    git(['add', '-A'], { allowFail: true });
    git(['commit', '-m', `devos: ${taskId} attempt ${attempt} waiting for secret`], { allowFail: true });
    return; // wait; a human types the secret, then resume dispatches again
  }

  if (builderRun.code !== 0) {
    log(`builder exited with code ${builderRun.code}`);
    console.log(builderRun.combined.slice(-1500));
    process.exitCode = 1;
    return;
  }

  const checks = runChecks(cfg);
  const guardRun = runGuards();
  const failed = checks.find((c) => c.code !== 0) || (guardRun.code !== 0 ? { name: 'guards', output: guardRun.output } : null);
  if (failed) log(`checks failed at ${failed.name}. The reviewer sees the output and writes the verdict.`);

  const reviewerPrompt = fillPrompt(readText(join(promptsDir, 'reviewer.md')), {
    TASK_ID: taskId, ATTEMPT: attempt, FENCE: fence.text,
    CHECKS: checks.map((c) => `${c.name} (${c.cmd}) -> exit ${c.code}${c.code !== 0 ? `\n${c.output}` : ''}`).join('\n\n') || 'all green',
    GUARDS: guardRun.output || 'all green',
    DIFF: git(['diff', '--stat', `${cfg.base || 'main'}...${branch}`], { allowFail: true }).out || '(no diff yet)',
  });
  const reviewerRun = runModelStep({ projectDir, cli: reviewer.cli, model: reviewer.model, role: 'reviewer', prompt: reviewerPrompt, log });
  if (reviewerRun.code !== 0 && looksLikeUsageLimit(reviewerRun.combined, cfg.usageLimitPattern)) {
    writeState('park.json', { task: taskId, attempt, reviewer, reason: 'usage limit', at: new Date().toISOString() }, projectDir);
    log('Parked: reviewer usage limit. devos-resume will dispatch again.');
    return;
  }

  const verdict = parseVerdict(projectDir, taskId, attempt);
  if (!verdict.ok) {
    // The runner does not invent the verdict; an unparseable review fails the attempt.
    log(verdict.reason);
    failAttempt(taskId, attempt, cfg, repo);
    return;
  }

  git(['add', '-A']);
  git(['commit', '-m', `devos: ${taskId} attempt ${attempt} (${verdict.verdict})`], { allowFail: true });

  if (verdict.verdict === 'PASS') {
    const gate = task.gate !== 'none' ? task.gate : (fence.gate !== 'none' ? fence.gate : null);
    const needsGate = task.risk >= 3 || ['migration', 'rules', 'method'].includes(gate || '');
    if (needsGate) {
      log(`PASS at a human gate (risk ${task.risk}${gate ? `, gate ${gate}` : ''}). Labeling devos:human-gate and waiting.`);
      git(['push', '-u', 'origin', branch], { allowFail: true });
      gh(['label', 'create', 'devos:human-gate', '--repo', repo, '--color', 'E8A15A', '--force'], { allowFail: true });
      const pr = gh(['pr', 'create', '--repo', repo, '--base', cfg.base || 'main', '--head', branch,
        '--title', `devos: ${taskId} ${task.title}`,
        '--body', `Attempt ${attempt} passed. Human gate: review and merge.\n\nMerge when devos/checks, devos/verdict, and devos/gate are green.`], { allowFail: true });
      if (pr.code === 0) {
        gh(['pr', 'edit', pr.out.trim(), '--repo', repo, '--add-label', 'devos:human-gate'], { allowFail: true });
      }
      updatePhaseRow(projectDir, taskId, { status: 'in-progress', attempt, gate: gate || 'human' });
      return; // devos-wait continues after the human merges
    }
    log('PASS with no human gate. Merging and dispatching the next cycle.');
    git(['checkout', cfg.base || 'main']);
    git(['merge', '--no-ff', branch, '-m', `devos: merge ${taskId} attempt ${attempt}`]);
    git(['push', 'origin', cfg.base || 'main'], { allowFail: true });
    git(['branch', '-D', branch], { allowFail: true });
    updatePhaseRow(projectDir, taskId, { status: 'done', attempt });
    // Dispatch the next workflow explicitly; never rely on GITHUB_TOKEN to chain runs.
    dispatchNext(cfg, repo);
    return;
  }

  failAttempt(taskId, attempt, cfg, repo);
}

function failAttempt(taskId, attempt, cfg, repo) {
  if (attempt >= (cfg.maxAttempts ?? 3)) {
    log(`FAIL after ${attempt} attempts. Halting task ${taskId}.`);
    updatePhaseRow(projectDir, taskId, { status: 'halted', attempt });
    gh(['label', 'create', 'devos:halted', '--repo', repo, '--color', 'E8745A', '--force'], { allowFail: true });
    gh(['issue', 'create', '--repo', repo, '--title', `devos: ${taskId} halted after ${attempt} attempts`,
      '--body', 'The reviewer rewrote the fence three times without a PASS. Read docs/reviews/ and decide.'], { allowFail: true });
    return;
  }
  log(`FAIL on attempt ${attempt}. The reviewer rewrote the fence; dispatching the next attempt.`);
  updatePhaseRow(projectDir, taskId, { status: 'in-progress', attempt });
  git(['add', '-A'], { allowFail: true });
  git(['commit', '-m', `devos: ${taskId} attempt ${attempt} failed; fence rewritten`], { allowFail: true });
  git(['push', '-u', 'origin', `task/${taskId}`], { allowFail: true });
  dispatchNext(cfg, repo);
}

main();
