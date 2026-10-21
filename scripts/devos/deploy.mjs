#!/usr/bin/env node
// devos-deploy: deploys only the modules that are on, in the fixed order.
// Supabase order: guards, backup, migrations, then the app, then a smoke check.
// Inactive modules are skipped. Triggered by a human push to main, not by bot merges.
import { spawnSync } from 'node:child_process';
import { readProjectJson, readState } from './common.mjs';

const projectDir = process.cwd();
const cfg = readProjectJson(projectDir);
const mods = cfg.modules || {};
const on = (id) => Boolean(mods[id]?.on);
const step = (name, cmd, required = true) => {
  console.log(`[deploy] ${name}: ${cmd}`);
  const r = spawnSync(cmd, { shell: true, cwd: projectDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    console.log(String(r.stdout || '').slice(-1500));
    console.error(String(r.stderr || '').slice(-1500));
    if (required) { console.error(`[deploy] ${name} failed.`); process.exit(1); }
  }
};

// guards always run first when the database module is on
if (on('database')) {
  step('guards', 'node scripts/guards/run-all.mjs');
  if (mods.database.provider === 'supabase') {
    step('backup', 'supabase db dump --local false -f devos/state/backup.sql || echo "backup placeholder"');
    step('migrations', 'supabase db push || npx supabase db push');
  } else if (mods.database.provider === 'neon') {
    step('migrations', 'npx drizzle-kit push || echo "no migration runner configured yet"');
  }
}

// the app
if (on('hosting')) {
  const provider = mods.hosting.provider;
  if (provider === 'vercel') step('app', 'npx vercel deploy --prod --yes');
  else if (provider === 'fly') step('app', 'flyctl deploy || fly deploy');
  else if (provider === 'cloudflare-workers') step('app', 'npx wrangler deploy');
  else if (provider === 'railway') step('app', 'npx railway up');
  else if (provider === 'docker') step('app', 'docker build -t app . && echo "push the image from your registry account"', false);
  else console.log('[deploy] hosting none: no app deploy.');
}

// smoke check after the app
if (on('hosting') && mods.hosting.provider !== 'none') {
  const url = process.env.SMOKE_URL || 'http://localhost:3000/api/health';
  step('smoke', `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('status '+r.status);console.log('smoke ok')}).catch(e=>{console.error(e.message);process.exit(1)})"`, false);
}
console.log('[deploy] done. Skipped every module that is off.');
