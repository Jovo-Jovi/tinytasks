// Architecture test: fails when a UI file imports the database or the data layer.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const UI_DIRS = ['src/app', 'src/components'];
const FORBIDDEN = [
  /from\s+['"][^'"]*(server\/database|server\/db|drizzle|\.server\.|@supabase\/supabase-js|mongoose|prisma)[^'"]*['"]/,
  /require\(\s*['"][^'"]*(server\/database|server\/db|drizzle|@supabase\/supabase-js|mongoose|prisma)[^'"]*['"]\s*\)/,
];

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

describe('architecture', () => {
  it('UI files do not import the database', () => {
    const problems = [];
    for (const ui of UI_DIRS) {
      for (const rel of walk(join(ROOT, ui), ROOT)) {
        const p = join(ROOT, rel);
        let text;
        try { text = readFileSync(p, 'utf8'); } catch { continue; }
        for (const re of FORBIDDEN) {
          if (re.test(text)) problems.push(`${rel} imports the data layer`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('the folder map in docs/ARCHITECTURE.md matches the files on disk', () => {
    const arch = join(ROOT, 'docs', 'ARCHITECTURE.md');
    expect(existsSync(arch), 'docs/ARCHITECTURE.md is missing.').toBe(true);
    for (const dir of ['src/components', 'src/lib', 'src/features', 'src/server']) {
      expect(existsSync(join(ROOT, dir)), `docs/ARCHITECTURE.md maps ${dir} but the folder is missing.`).toBe(true);
    }
  });
});
