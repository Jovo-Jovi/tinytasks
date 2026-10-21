# Architecture

TinyTasks is a Next.js App Router dashboard. Dependency direction is one way: routes → features → components. Features may call `src/server`. `src/server` is the only place that may call a provider. Components never import `src/server` or a database client.

## Folder map

| Folder | What lives here |
| --- | --- |
| src/app | Routes and pages. `src/app/page.tsx` is the public shell. `src/app/api/health/route.ts` returns 200. |
| public | Static assets. |
| src/components | Presentational components. No database imports. shadcn/ui components land here. |
| src/features/tasks | The task feature: status, priority, filter, and task count. |
| src/server | Server-side module wiring. No provider module is on, so this folder has no entry file yet. |
| src/lib | Pure helpers, no IO. `src/lib/utils.ts` is the shadcn `cn` helper. |
| src/i18n | Language catalogues for en and ar, plus `translate`. |
| tests | Unit tests and the architecture test. |

## Modules

| Module | Where it lives |
| --- | --- |
| styling (tailwind) | `tailwind.config.ts`, `postcss.config.mjs`, `src/app/globals.css` |
| ui-kit (shadcn) | `components.json`, `src/components`, `src/lib/utils.ts` |
| i18n | `src/i18n` (`en`, `ar`) |
| testing | `vitest.config.ts`, `tests` |
| hosting (vercel) | `vercel.json` |
| automation | `.github/workflows`, `scripts/devos`, `scripts/guards`, `devos/prompts`, `devos/fences` |

## Dependency direction

routes → features → components. Features → src/server → providers. Components never import src/server or a database client. UI files in `src/app` and `src/components` do not read secret environment names.

## Health

`GET /api/health` is `src/app/api/health/route.ts`. It returns `{ ok: true }` with status 200.

## Architecture test

`tests/architecture.test.mjs` fails when a UI file imports the database. It also fails when `src/components`, `src/lib`, `src/features`, or `src/server` is missing.
