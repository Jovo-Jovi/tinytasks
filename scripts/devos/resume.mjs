#!/usr/bin/env node
// devos-resume: a parked run (usage limit) waits here. When the park file exists this
// workflow clears it and dispatches the cycle again. A usage limit is a wait, not a failure.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { readProjectJson, readState, gh } from './common.mjs';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;

const park = readState('park.json', projectDir);
if (!park) { console.log('[resume] nothing parked.'); process.exit(0); }
rmSync(join(projectDir, 'devos', 'state', 'park.json'), { force: true });
console.log(`[resume] unparked task ${park.task} attempt ${park.attempt}; dispatching the cycle.`);
gh(['workflow', 'run', 'devos-cycle.yml', '--repo', repo, '--ref', cfg.base || 'main']);
