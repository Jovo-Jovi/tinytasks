#!/usr/bin/env node
// devos-intake: turns a change-request or method-fix issue into a draft fence and a
// ledger row, then dispatches the cycle. Issue forms feed this script labels.
import { gh, git, readProjectJson } from './common.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;

const issueNumber = Number(process.env.DEVOS_ISSUE_NUMBER || (process.argv[2] || 0));
if (!issueNumber) { console.error('[intake] no issue number'); process.exit(1); }

const issue = gh(['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'title,body,labels', '-q', '{title: .title, body: .body, labels: [.labels[].name]}']);
const data = JSON.parse(issue.out);
const isMethod = (data.labels || []).includes('devos:method-fix');
const risk = isMethod ? 3 : 2;
const gate = isMethod ? 'method' : 'none';

// Next task id
const phases = readFileSync(join(projectDir, 'docs', 'PHASES.md'), 'utf8');
const ids = [...phases.matchAll(/^\|\s*T(\d+)\s*\|/gm)].map((m) => Number(m[1]));
const nextId = `T${String(Math.max(0, ...ids) + 1).padStart(2, '0')}`;

const fencePath = join(projectDir, 'devos', 'fences', `${nextId}.md`);
if (existsSync(fencePath)) { console.error(`[intake] ${nextId} fence already exists`); process.exit(1); }

const rev = cfg.reviewer; const bld = cfg.builder;
const fence = `# ${nextId} — ${data.title}
Reviewer: ${rev.cli} ${rev.model}
Builder: ${bld.cli} ${bld.model}
Risk: ${risk}
Attempt: 0
Gate: ${gate}
Source: issue #${issueNumber}

## Context
${(data.body || '').slice(0, 2000)}

## Done when
- [ ] The change works and the checks are green. — PLACEHOLDER: the intake step asks the reviewer to make rows concrete on the first pass.

## Notes
Created by devos-intake from issue #${issueNumber}.
`;
writeFileSync(fencePath, fence);
const line = `| ${nextId} | ${data.title.replace(/\|/g, '/')} | not-done | 0 | ${risk} | ${gate} |`;
const lines = phases.split('\n');
const lastRow = lines.map((l, i) => [/^\|\s*T\d+\s*\|/.test(l), i]).filter(([m]) => m).pop();
if (lastRow) lines.splice(lastRow[1] + 1, 0, line);
writeFileSync(join(projectDir, 'docs', 'PHASES.md'), lines.join('\n'));

gh(['issue', 'comment', String(issueNumber), '--repo', repo, '--body', `Intake created ${nextId} on branch main. The cycle will pick it up.`]);
git(['add', '-A']);
git(['commit', '-m', `devos: intake ${nextId} from issue #${issueNumber}`], { allowFail: true });
git(['push', 'origin', cfg.base || 'main'], { allowFail: true });
gh(['workflow', 'run', 'devos-cycle.yml', '--repo', repo, '--ref', cfg.base || 'main']);
