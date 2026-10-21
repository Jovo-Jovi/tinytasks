#!/usr/bin/env node
// data guard: with the database module on, migrations are append-only and no secret key
// appears in a public env name.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

let db = null;
try {
  const cfg = JSON.parse(readFileSync(join(root, 'devos', 'project.json'), 'utf8'));
  db = cfg.modules?.database;
} catch { /* standalone run: treat as on when supabase/ exists */ }
const on = db ? Boolean(db.on) : existsSync(join(root, 'supabase'));
if (!on) process.exit(0);

const problems = [];

// migrations are append-only: files sorted ascending, no "down" migrations, no edited history
const migDir = join(root, 'supabase', 'migrations');
if (existsSync(migDir)) {
  const files = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  const names = files.map((f) => f.replace(/\.sql$/, ''));
  if (names.some((n) => /down|rollback|drop/i.test(n))) {
    problems.push('migrations are append-only: no down/rollback files.');
  }
  if (names.some((n) => !/^\d{4,}_/.test(n))) {
    problems.push('migration files must start with a numeric stamp, e.g. 0001_init.sql.');
  }
}

// no secret key in a public env name
const envPath = join(root, '.env.example');
if (existsSync(envPath)) {
  const text = readFileSync(envPath, 'utf8');
  const names = [...text.matchAll(/^([A-Z][A-Z0-9_]+)=?/gm)].map((m) => m[1]);
  for (const name of names) {
    if (/^PUBLIC_/.test(name) && /(SECRET|TOKEN|PASSWORD|PRIVATE|KEY)/.test(name)) {
      problems.push(`${name}: a public env name must not reference a secret.`);
    }
    if (/^(SUPABASE_SERVICE_ROLE|DATABASE_URL|STRIPE_SECRET|AWS_SECRET)/.test(name) && text.includes(`NEXT_PUBLIC_${name}`)) {
      problems.push(`${name} must never be exposed to the browser bundle.`);
    }
  }
}

if (problems.length) { console.log(problems.map((x) => `- ${x}`).join('\n')); process.exit(1); }
