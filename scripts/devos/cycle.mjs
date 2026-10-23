#!/usr/bin/env node
// devos-cycle v2 (marker: devos:cycle-v2). One run is one attempt of one task,
// and the attempt is FIVE VISIBLE STEPS — the run page shows exactly where the
// attempt is, the PR carries every detail as comments, and the log never goes
// quiet for long (the builder and the reviewer emit a heartbeat every minute):
//   start    resolve the task + attempt + branch; preflight credentials and CLIs
//   build    the builder works the fence; commit + push; open or reuse the pull
//            request; post the builder outcome as a PR comment
//   checks   typecheck / lint / test / build + the guards; the devos/checks
//            commit status; a PR comment naming what is red (the reviewer sees
//            the same output)
//   review   the reviewer reads the fence + the evidence and writes the review
//   verdict  parse the verdict; the devos/verdict status + a PR comment; then
//            act: merge + dispatch the next task | human gate | dispatch the
//            next attempt | halt with an issue
// The workflow calls these phases as separate steps (that is the whole point:
// "Run node scripts/devos/cycle.mjs" told the developer nothing). With no
// argument the same phases run in sequence in this process — local runs and
// old callers keep working.
// Reads the reviewer and the builder from devos/project.json and the fence.
// Never starts the configuration model. A wait (missing secret) and a park
// (usage limit) exit 1 — never a green run that did nothing, so the engine's
// loop-until-green cannot mistake a wait for a finished job.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProjectJson, assertNotConfigurationModel, runModelStepLive, looksLikeUsageLimit, findMissingSecret,
  nextTask, parseFence, parseVerdict, updatePhaseRow, gh, git, writeState, missingCliSecret, cliAvailable,
} from './common.mjs';

const projectDir = process.cwd();
const log = (line) => console.log(`[cycle] ${line}`);
const notice = (msg) => console.log(`::notice title=Dev OS::${msg}`);
const warning = (msg) => console.log(`::warning title=Dev OS::${msg}`);
const fail = (msg) => console.log(`::error title=Dev OS::${msg}`);

const readText = (p, fallback = '') => {
  try { return readFileSync(p, 'utf8'); } catch { return fallback; }
};

function fillPrompt(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

// ---- the attempt state: one JSON file carries the attempt across the steps --
// Lives in devos/state (gitignored by the phases below, never part of the
// product), so every workflow step picks up exactly where the last one ended.
const attemptPath = () => join(projectDir, 'devos', 'state', 'attempt.json');

function readAttempt() {
  try { return JSON.parse(readFileSync(attemptPath(), 'utf8')); } catch { return null; }
}

function saveAttempt(st) {
  mkdirSync(join(projectDir, 'devos', 'state'), { recursive: true });
  writeFileSync(attemptPath(), JSON.stringify(st, null, 2));
  return st;
}

// The runner state folder must never reach the repository (it holds attempt
// bookkeeping and prompts, not product code). Idempotent, checked every phase.
function ensureStateIgnored() {
  const p = join(projectDir, '.gitignore');
  const text = readText(p);
  if (/^devos\/state\/?$/m.test(text)) return;
  writeFileSync(p, `${text.trimEnd()}\n\n# devos runner state (attempt bookkeeping — never part of the product)\ndevos/state/\n`);
}

// The run page's Summary tab — the human-readable receipt of the attempt.
function stepSummary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) return;
  try { appendFileSync(f, `${md}\n`); } catch { /* a summary must never break a phase */ }
}

function githubOutput(key, value) {
  const f = process.env.GITHUB_OUTPUT;
  if (!f) return;
  try { appendFileSync(f, `${key}=${value}\n`); } catch { /* outputs are best-effort */ }
}

// ---- GitHub surfaces: labels, statuses, PR comments -------------------------
function ensureLabels(repo) {
  for (const spec of ['devos:0e8a16', 'risk-1:c5def5', 'risk-2:fbca04', 'risk-3:d93f0b',
    'devos:human-gate:E8A15A', 'devos:halted:E8745A', 'devos:auto-merged:0e8a16', 'devos:setup-wait:fbca04']) {
    const i = spec.lastIndexOf(':');
    gh(['label', 'create', spec.slice(0, i), '--repo', repo, '--color', spec.slice(i + 1), '--force'], { allowFail: true });
  }
}

function setStatus(repo, sha, state, context, description) {
  if (!sha) return;
  gh(['api', `repos/${repo}/statuses/${sha}`, '-f', `state=${state}`, '-f', `context=${context}`, '-f', `description=${description}`], { allowFail: true });
}

function prComment(repo, pr, body) {
  if (!pr) return;
  gh(['pr', 'comment', String(pr), '--repo', repo, '--body', body], { allowFail: true });
}

function prAddLabel(repo, pr, label) {
  if (!pr) return;
  gh(['pr', 'edit', String(pr), '--repo', repo, '--add-label', label], { allowFail: true });
}

function currentHead() {
  return git(['rev-parse', 'HEAD'], { allowFail: true }).out.trim() || null;
}

// Open (or reuse) the attempt's pull request. The PR is opened right after the
// builder pushes — every later detail (checks, verdict) lands as comments on
// it, so the developer reads one page instead of staring at run logs.
function openOrReusePr(repo, st, cfg) {
  const task = st.taskId;
  const existing = gh(['pr', 'list', '--repo', repo, '--head', st.branch, '--state', 'open', '--json', 'number', '-q', '.[0].number'], { allowFail: true });
  if (existing && existing.code === 0 && existing.out.trim()) {
    st.pr = Number(existing.out.trim().split('\n')[0]) || existing.out.trim();
    return st.pr;
  }
  const created = gh(['pr', 'create', '--repo', repo, '--base', cfg.base || 'main', '--head', st.branch,
    '--title', `devos: ${task} — ${st.taskTitle || task}`,
    '--body', [
      `Dev OS task **${task}** (risk ${st.risk ?? 1}) · attempt ${st.attempt}.`,
      `Fence: \`devos/fences/${task}.md\` · branch: \`${st.branch}\` · builder: \`${st.builder.cli} ${st.builder.model}\`.`,
      '',
      'The details of every stage land here as comments (builder outcome, checks, verdict).',
      'Do not merge before the verdict: the `devos/verdict` status turns green on PASS, and a PASS at a human gate labels this PR `devos:human-gate` for you to merge.',
    ].join('\n')], { allowFail: true });
  if (created && created.code === 0 && created.out.trim()) {
    const m = /pull\/(\d+)/.exec(created.out.trim());
    st.pr = m ? Number(m[1]) : created.out.trim();
    prAddLabel(repo, st.pr, 'devos');
    prAddLabel(repo, st.pr, `risk-${st.risk ?? 1}`);
    return st.pr;
  }
  return null;
}

function dispatchNext(cfg, repo) {
  gh(['workflow', 'run', 'devos-cycle.yml', '--repo', repo, '--ref', cfg.base || 'main'], { allowFail: true });
}

function setupIssueFor(repo, missing) {
  const title = 'Dev OS: setup needed';
  const body = `The cycle needs the secret \`${missing}\`.\nType it on your computer:\n\n\`\`\`\ngh secret set ${missing} --repo ${repo}\n\`\`\`\nThen re-run the devos-cycle workflow (or run devos continue — the engine checks, uploads and dispatches itself). Never paste a secret value into an issue, a comment, or the model prompt.`;
  const existing = gh(['issue', 'list', '--repo', repo, '--state', 'open', '--json', 'title,number', '-q', '.[] | select(.title == "Dev OS: setup needed") | .number'], { allowFail: true });
  if (existing.code === 0 && existing.out.trim()) {
    gh(['issue', 'comment', existing.out.trim().split('\n')[0], '--repo', repo, '--body', body], { allowFail: true });
  } else {
    gh(['issue', 'create', '--repo', repo, '--title', title, '--body', body, '--label', 'devos:setup-wait'], { allowFail: true });
  }
}

function changedCount() {
  return git(['status', '--porcelain'], { allowFail: true }).out.split('\n').filter(Boolean).length;
}

// ---- phase 1: start ----------------------------------------------------------
function phaseStart(cfg, repo) {
  const task = nextTask(projectDir);
  if (!task) {
    log('No task pending in docs/PHASES.md. Nothing to do.');
    notice('Every task in docs/PHASES.md is done. Nothing to run.');
    saveAttempt({ todo: false, stop: 'all-done' });
    githubOutput('todo', 'false');
    return;
  }
  const taskId = task.id;
  log(`task ${taskId}: ${task.title}`);

  const fence = parseFence(projectDir, taskId);
  const attempt = Math.max(Number(task.attempt) || 0, fence.attempt || 0) + 1;

  // Choose roles: the fence header wins when present; the config carries the pool and policy.
  let reviewer = fence.reviewer || cfg.reviewer;
  let builder = fence.builder || cfg.builder;
  if (cfg.pickPolicy === 'default-only') builder = cfg.builder;
  const pool = cfg.builderPool && cfg.builderPool.length ? cfg.builderPool : [cfg.builder];
  const inPool = pool.some((b) => b.cli === builder.cli && b.model === builder.model);
  if (!inPool) {
    log(`builder ${builder.cli} ${builder.model} is outside the pool; falling back to the default builder ${cfg.builder.cli} ${cfg.builder.model}.`);
    builder = cfg.builder;
  }

  // The cycle never runs the configuration model, for any role.
  assertNotConfigurationModel(cfg, 'reviewer', reviewer.cli, reviewer.model);
  assertNotConfigurationModel(cfg, 'builder', builder.cli, builder.model);

  // Pre-flight before any attempt is spent. A missing credential WAITS — the
  // run exits 1 (never a green run that did nothing) and the setup issue names
  // the one command; the engine's loop re-checks and re-dispatches on its own.
  const preflight = [[builder, 'builder'], [reviewer, 'reviewer']];
  for (const [who, roleName] of preflight) {
    const miss = missingCliSecret(who.cli);
    if (miss) {
      log(`the ${roleName} credential is not set: secret ${miss} has no value on GitHub. Opening the setup issue and waiting.`);
      setupIssueFor(repo, miss);
      saveAttempt({ todo: false, stop: 'wait-secret', missingSecret: miss });
      fail(`waiting for the ${roleName} credential: secret ${miss} is not on GitHub yet.`);
      process.exitCode = 1;
      githubOutput('todo', 'false');
      return;
    }
  }
  const notInstalled = preflight.map(([who]) => ({ who, av: cliAvailable(who.cli) })).filter((x) => !x.av.ok);
  if (notInstalled.length) {
    for (const { who, av } of notInstalled) {
      log(`the ${who.cli} CLI ("${av.command}") is not installed on this runner${av.detail ? ` (${av.detail})` : ''}.`);
    }
    log('Fix: .github/workflows/devos-cycle.yml must install the agent CLIs before the cycle — add a step that runs: node scripts/devos/install-clis.mjs');
    saveAttempt({ todo: false, stop: 'cli-missing' });
    fail('the agent CLIs are not installed on the runner; the workflow needs the install step.');
    process.exitCode = 1;
    githubOutput('todo', 'false');
    return;
  }

  // Fresh attempt branch from the base branch.
  const branch = `task/${taskId}`;
  git(['checkout', cfg.base || 'main']);
  git(['branch', '-D', branch], { allowFail: true });
  git(['checkout', '-b', branch]);

  ensureStateIgnored();
  ensureLabels(repo);

  saveAttempt({
    todo: true, taskId, taskTitle: task.title, risk: task.risk, attempt, branch,
    gate: task.gate, fenceGate: fence.gate,
    builder, reviewer, repo, pr: null, head: null, checks: null, guards: null,
  });
  log(`attempt ${attempt} of ${cfg.maxAttempts} · branch ${branch} · builder ${builder.cli} ${builder.model} · reviewer ${reviewer.cli} ${reviewer.model}`);
  notice(`task ${taskId} attempt ${attempt}: builder ${builder.cli} ${builder.model}, reviewer ${reviewer.cli} ${reviewer.model}.`);
  githubOutput('todo', 'true');
}

// ---- phase 2: build -----------------------------------------------------------
async function phaseBuild(cfg, repo) {
  const st = readAttempt();
  if (!st || !st.todo) { notice('Nothing to build (the attempt did not start).'); return; }

  const fence = parseFence(projectDir, st.taskId);
  const promptsDir = join(projectDir, 'devos', 'prompts');
  const builderPrompt = fillPrompt(readText(join(promptsDir, 'builder.md')), {
    TASK_ID: st.taskId, ATTEMPT: st.attempt, FENCE: fence.text, BRANCH: st.branch, MAX_ATTEMPTS: cfg.maxAttempts,
  });

  // The heartbeat: the builder can think for many minutes with zero output —
  // a line every minute says it is alive and how much it has changed so far.
  let builderRun = await runModelStepLive({
    projectDir, cli: st.builder.cli, model: st.builder.model, role: 'builder', prompt: builderPrompt, log,
    heartbeat: (min) => log(`builder still working · ${min} min elapsed · ${changedCount()} file(s) changed so far`),
  });
  if (builderRun.code !== 0 && looksLikeUsageLimit(builderRun.combined, cfg.usageLimitPattern)) {
    // A usage limit is a wait, not a failed task. Move once to the next GitHub-capable builder in the pool.
    const pool = cfg.builderPool && cfg.builderPool.length ? cfg.builderPool : [cfg.builder];
    const next = pool.find((b) => !(b.cli === st.builder.cli && b.model === st.builder.model)
      && !(b.cli === (cfg.configurationModel || {}).cli && b.model === (cfg.configurationModel || {}).model));
    if (next) {
      log(`usage limit on ${st.builder.cli} ${st.builder.model}; moving once to ${next.cli} ${next.model}, then park and resume if needed.`);
      st.builder = next;
      saveAttempt(st);
      builderRun = await runModelStepLive({
        projectDir, cli: next.cli, model: next.model, role: 'builder', prompt: builderPrompt, log,
        heartbeat: (min) => log(`builder still working · ${min} min elapsed · ${changedCount()} file(s) changed so far`),
      });
    }
    if (builderRun.code !== 0 && looksLikeUsageLimit(builderRun.combined, cfg.usageLimitPattern)) {
      writeState('park.json', { task: st.taskId, attempt: st.attempt, builder: st.builder, reason: 'usage limit', at: new Date().toISOString() }, projectDir);
      log('Parked on usage limit. devos-resume will dispatch this attempt again.');
      warning(`${st.taskId} parked on a builder usage limit; devos-resume dispatches it again.`);
      st.stop = 'parked';
      saveAttempt(st);
      process.exitCode = 1;
      return;
    }
  }

  const missingSecret = findMissingSecret(builderRun.combined)
    || findMissingSecret(readText(join(projectDir, 'docs', 'reports', `${st.taskId}-a${st.attempt}.md`)));
  if (missingSecret) {
    log(`missing secret: ${missingSecret}. Opening the setup issue and waiting.`);
    setupIssueFor(repo, missingSecret);
    st.stop = 'wait-secret';
    saveAttempt(st);
    fail(`the builder asked for secret ${missingSecret}; type its value (never into the model) and the next run continues.`);
    process.exitCode = 1;
    return;
  }

  if (builderRun.code !== 0) {
    log(`builder exited with code ${builderRun.code}`);
    console.log(builderRun.combined.slice(-1500));
    st.stop = 'builder-failed';
    saveAttempt(st);
    fail(`the builder exited with code ${builderRun.code} — its own last lines are in the log above.`);
    process.exitCode = 1;
    return;
  }
  log(`builder finished clean: ${changedCount()} file(s) in the tree.`);

  // Commit, push, and open the PR — the PR is the details page of the attempt.
  git(['add', '-A']);
  git(['commit', '--allow-empty', '-m', `devos: ${st.taskId} attempt ${st.attempt}: builder (${st.builder.cli} ${st.builder.model})`], { allowFail: true });
  git(['push', '-u', 'origin', st.branch], { allowFail: true });
  st.head = currentHead();
  st.pr = openOrReusePr(repo, st, cfg);
  saveAttempt(st);

  const diffStat = git(['diff', '--stat', `${cfg.base || 'main'}...${st.branch}`], { allowFail: true }).out || '(no diff yet)';
  const doneWhen = fence.doneWhen.length ? `\n\n**Done-when items to prove**\n${fence.doneWhen.map((d) => `- ${d}`).join('\n')}` : '';
  prComment(repo, st.pr, [
    `### Builder outcome — attempt ${st.attempt}`,
    `- Builder: \`${st.builder.cli} ${st.builder.model}\`, exit 0.`,
    `- Branch: \`${st.branch}\` · HEAD: \`${st.head || 'unknown'}\`.`,
    `- Changed files vs \`${cfg.base || 'main'}\`:`,
    '',
    '```',
    diffStat.trim(),
    '```',
    `${doneWhen}`,
    '',
    'Next: the checks step runs (typecheck, lint, tests, build, guards), then the review lands here as the verdict comment.',
  ].join('\n'));
  stepSummary([
    `## devos ${st.taskId} attempt ${st.attempt}`,
    '',
    '| stage | result |',
    '|-------|--------|',
    `| builder | ${st.builder.cli} ${st.builder.model} · exit 0 |`,
    `| PR | ${st.pr ? `#${st.pr}` : 'not opened (nothing differs)'} |`,
  ].join('\n'));
  notice(`builder done · PR ${st.pr ? `#${st.pr}` : '(none)'} — checks and review follow in the next steps.`);
}

// ---- phase 3: checks ----------------------------------------------------------
function phaseChecks(cfg, repo) {
  const st = readAttempt();
  if (!st || !st.todo || st.stop) { return; }
  const checks = runChecksAll(cfg);
  const guardRun = runGuards();
  const failed = checks.find((c) => c.code !== 0) || (guardRun.code !== 0 ? { name: 'guards', output: guardRun.output } : null);

  // Evidence for the reviewer AND for the PR: what ran, what it printed.
  st.checksText = checks.map((c) => `${c.name} (${c.cmd}) -> exit ${c.code}${c.code !== 0 ? `\n${c.output}` : ''}`).join('\n\n') || 'all green';
  st.guardsText = guardRun.output || 'all green';
  st.checksFailed = failed ? failed.name : null;
  saveAttempt(st);

  setStatus(repo, currentHead(), failed ? 'failure' : 'success', 'devos/checks',
    failed ? `red: ${failed.name}` : 'typecheck, lint, tests, build, guards — green');

  const rows = checks.map((c) => `| ${c.name} | ${c.code === 0 ? 'green' : `red (exit ${c.code})`} |`).join('\n');
  stepSummary([`### Checks`, '', '| check | result |', '|-------|--------|', rows, `| guards | ${guardRun.code === 0 ? 'green' : 'red'} |`].join('\n'));

  if (failed) {
    log(`checks failed at ${failed.name}. The reviewer sees the output and writes the verdict.`);
    prComment(repo, st.pr, [
      `### devos/checks: red — ${failed.name}`,
      '',
      '```',
      String(failed.output || '').trim().slice(-1500),
      '```',
      'The reviewer receives this output and decides: the fence gets rewritten for the next attempt, or the verdict explains why this is a halt.',
    ].join('\n'));
  } else {
    log('checks: typecheck, lint, tests, build, guards — all green.');
  }
}

function runCheck(cmd) {
  const r = spawnSync(cmd, { shell: true, cwd: projectDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { code: r.status, output: `${String(r.stdout || '').slice(-2500)}${String(r.stderr || '').slice(-2500)}`.trim() };
}

function runChecksAll(cfg) {
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

// ---- phase 4: review ----------------------------------------------------------
async function phaseReview(cfg, repo) {
  const st = readAttempt();
  if (!st || !st.todo || st.stop) { return; }

  const fence = parseFence(projectDir, st.taskId);
  const promptsDir = join(projectDir, 'devos', 'prompts');
  const reviewerPrompt = fillPrompt(readText(join(promptsDir, 'reviewer.md')), {
    TASK_ID: st.taskId, ATTEMPT: st.attempt, FENCE: fence.text,
    CHECKS: st.checksText || 'all green',
    GUARDS: st.guardsText || 'all green',
    DIFF: git(['diff', '--stat', `${cfg.base || 'main'}...${st.branch}`], { allowFail: true }).out || '(no diff yet)',
  });

  let reviewerRun = await runModelStepLive({
    projectDir, cli: st.reviewer.cli, model: st.reviewer.model, role: 'reviewer', prompt: reviewerPrompt, log,
    heartbeat: (min) => log(`reviewer still working · ${min} min elapsed`),
  });
  if (reviewerRun.code !== 0 && looksLikeUsageLimit(reviewerRun.combined, cfg.usageLimitPattern)) {
    writeState('park.json', { task: st.taskId, attempt: st.attempt, reviewer: st.reviewer, reason: 'usage limit', at: new Date().toISOString() }, projectDir);
    log('Parked: reviewer usage limit. devos-resume will dispatch again.');
    warning(`${st.taskId} parked on a reviewer usage limit; devos-resume dispatches it again.`);
    st.stop = 'parked';
    saveAttempt(st);
    process.exitCode = 1;
    return;
  }
  if (reviewerRun.code !== 0) {
    log(`reviewer exited with code ${reviewerRun.code}`);
    console.log(reviewerRun.combined.slice(-1500));
    prComment(repo, st.pr, [
      `### Reviewer failed (exit ${reviewerRun.code})`,
      '',
      '```',
      reviewerRun.combined.slice(-1200),
      '```',
      'No verdict was written; the next dispatch re-runs the review.',
    ].join('\n'));
    st.stop = 'reviewer-failed';
    saveAttempt(st);
    fail(`the reviewer exited with code ${reviewerRun.code}.`);
    process.exitCode = 1;
    return;
  }
  log('reviewer finished; the verdict is parsed next.');
}

// ---- phase 5: verdict ----------------------------------------------------------
function phaseVerdict(cfg, repo) {
  const st = readAttempt();
  if (!st || !st.todo || st.stop) { return; }

  const verdict = parseVerdict(projectDir, st.taskId, st.attempt);

  // The review file (and any fence rewrite) is part of the record: commit and push it.
  git(['add', '-A']);
  git(['commit', '--allow-empty', '-m', `devos: ${st.taskId} attempt ${st.attempt} (${verdict.ok ? verdict.verdict : 'unparseable'})`], { allowFail: true });
  git(['push', '-u', 'origin', st.branch], { allowFail: true });
  const sha = currentHead();

  if (!verdict.ok) {
    // The runner does not invent the verdict; an unparseable review fails the attempt.
    log(verdict.reason);
    setStatus(repo, sha, 'failure', 'devos/verdict', 'the review file was not parseable');
    prComment(repo, st.pr, [
      `### Verdict: not parseable (attempt ${st.attempt})`,
      verdict.reason,
      'The next dispatch runs the review again; the review file must carry per-row verdicts and one final `VERDICT:` line.',
    ].join('\n'));
    failAttempt(st, cfg, repo, 'the review file was not parseable');
    return;
  }

  setStatus(repo, sha, verdict.verdict === 'PASS' ? 'success' : 'failure', 'devos/verdict', `${verdict.verdict}: ${st.taskId} attempt ${st.attempt}`);
  const rows = verdict.rows.map((r) => `- [${r.checked ? 'x' : ' '}] ${r.text} — ${r.verdict}`).join('\n');
  prComment(repo, st.pr, [
    `### Verdict: ${verdict.verdict} — attempt ${st.attempt}`,
    '',
    rows,
    '',
    `Review record: \`docs/reviews/${st.taskId}-a${st.attempt}.md\` (pushed to \`${st.branch}\`).`,
  ].join('\n'));
  stepSummary([`### Verdict`, '', `**${verdict.verdict}** — attempt ${st.attempt}`, '', rows].join('\n'));

  if (verdict.verdict === 'PASS') {
    const gate = (st.gate && st.gate !== 'none') ? st.gate : ((st.fenceGate && st.fenceGate !== 'none') ? st.fenceGate : null);
    const needsGate = (st.risk ?? 1) >= 3 || ['migration', 'rules', 'method'].includes(gate || '');
    if (needsGate) {
      log(`PASS at a human gate (risk ${st.risk}${gate ? `, gate ${gate}` : ''}). Labeled devos:human-gate — merge the PR when the statuses are green.`);
      prAddLabel(repo, st.pr, 'devos:human-gate');
      updatePhaseRow(projectDir, st.taskId, { status: 'in-progress', attempt: st.attempt, gate: gate || 'human' });
      notice(`${st.taskId} PASSED and waits at a human gate: review and merge PR ${st.pr ? `#${st.pr}` : ''} to continue.`);
      return;
    }
    log('PASS with no human gate. Merging and dispatching the next cycle.');
    git(['checkout', cfg.base || 'main']);
    git(['merge', '--no-ff', st.branch, '-m', `devos: merge ${st.taskId} attempt ${st.attempt}`]);
    git(['push', 'origin', cfg.base || 'main'], { allowFail: true });
    git(['branch', '-D', st.branch], { allowFail: true });
    updatePhaseRow(projectDir, st.taskId, { status: 'done', attempt: st.attempt });
    prAddLabel(repo, st.pr, 'devos:auto-merged');
    // Dispatch the next workflow explicitly; never rely on GITHUB_TOKEN to chain runs.
    dispatchNext(cfg, repo);
    notice(`${st.taskId} merged; the next task is dispatched.`);
    return;
  }

  failAttempt(st, cfg, repo, `the reviewer's verdict is FAIL on attempt ${st.attempt}`);
}

function failAttempt(st, cfg, repo, why) {
  if (st.attempt >= (cfg.maxAttempts ?? 3)) {
    log(`FAIL after ${st.attempt} attempts. Halting task ${st.taskId}.`);
    updatePhaseRow(projectDir, st.taskId, { status: 'halted', attempt: st.attempt });
    prAddLabel(repo, st.pr, 'devos:halted');
    gh(['issue', 'create', '--repo', repo, '--title', `devos: ${st.taskId} halted after ${st.attempt} attempts`,
      '--body', `${why}\n\nThe reviewer rewrote the fence ${st.attempt} times without a PASS. Read docs/reviews/ and the PR (${st.pr ? `#${st.pr}` : 'branch ' + st.branch}) and decide.`], { allowFail: true });
    fail(`${st.taskId} halted after ${st.attempt} attempts — the issue names where to decide.`);
    process.exitCode = 1;
    return;
  }
  log(`FAIL on attempt ${st.attempt}. The reviewer rewrote the fence; dispatching the next attempt.`);
  updatePhaseRow(projectDir, st.taskId, { status: 'in-progress', attempt: st.attempt });
  git(['add', '-A'], { allowFail: true });
  git(['commit', '--allow-empty', '-m', `devos: ${st.taskId} attempt ${st.attempt} failed; fence rewritten`], { allowFail: true });
  git(['push', '-u', 'origin', `task/${st.taskId}`], { allowFail: true });
  dispatchNext(cfg, repo);
  notice(`${st.taskId} attempt ${st.attempt} failed; attempt ${st.attempt + 1} is dispatched.`);
}

// ---- the driver ----------------------------------------------------------------
const PHASES = ['start', 'build', 'checks', 'review', 'verdict'];

async function runPhase(phase, cfg, repo) {
  switch (phase) {
    case 'start': return phaseStart(cfg, repo);
    case 'build': return phaseBuild(cfg, repo);
    case 'checks': return phaseChecks(cfg, repo);
    case 'review': return phaseReview(cfg, repo);
    case 'verdict': return phaseVerdict(cfg, repo);
    default: return null;
  }
}

async function main() {
  const cfg = readProjectJson(projectDir);
  const repo = process.env.GITHUB_REPOSITORY || cfg.repo;
  const phase = (process.argv[2] || '').toLowerCase();
  if (phase && PHASES.includes(phase)) {
    await runPhase(phase, cfg, repo);
    return;
  }
  if (phase) {
    console.error(`unknown phase "${phase}" — the phases are: ${PHASES.join(', ')}`);
    process.exitCode = 2;
    return;
  }
  // No argument: every phase in sequence in this process (local runs and old callers).
  for (const p of PHASES) {
    await runPhase(p, cfg, repo);
    const st = readAttempt();
    if (!st || !st.todo || st.stop) break;
  }
}

main().catch((e) => {
  fail(String((e && e.message) || e));
  process.exitCode = 1;
});
