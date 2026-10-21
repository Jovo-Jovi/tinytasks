# AUTOMATION — the method manual

Every workflow, script, label, and variable in this repository, in one place.

## Workflows

| file | runs when | what it does |
|------|-----------|--------------|
| devos-cycle.yml | dispatch, workflow_call | One attempt of one task on branch task/Tnn. Installs the agent CLIs first (scripts/devos/install-clis.mjs). Builder writes code, checks run, reviewer writes docs/reviews/Tnn-aN.md, runner parses VERDICT. |
| devos-intake.yml | issue labeled devos:change-request or devos:method-fix | Creates a fence and a ledger row, dispatches the cycle. |
| devos-advance.yml | dispatch after a human merge | Marks the ledger row done, dispatches the next cycle. |
| devos-doctor.yml | daily schedule | Runs the guards and the ledger check; opens an issue when red. |
| devos-resume.yml | every 30 minutes | Unparks a run that waited on a usage limit and dispatches the cycle. |
| devos-setup.yml | hourly schedule | Checks required secrets exist; keeps the setup issue honest. |
| devos-deploy.yml | push to main by a human | Deploys active modules only. Hosting is Vercel: the workflow passes VERCEL_TOKEN, VERCEL_ORG_ID, and VERCEL_PROJECT_ID, then smoke-checks the health route. |
| ci.yml | pull_request, push to main | Install, typecheck, lint, test, build, guards. |
| devos-wait.yml | gated pull request merged | Marks the gate handled, dispatches devos-advance. |
| devos-supervisor.yml | every 2 hours | Files an issue when a park ages past six hours or a task halts. |

## Runner scripts (scripts/devos/)

cycle.mjs, intake.mjs, advance.mjs, doctor.mjs, resume.mjs, setup.mjs, deploy.mjs, wait.mjs, supervisor.mjs, common.mjs, install-clis.mjs.

## Guards (scripts/guards/)

run-all.mjs, secrets.mjs, phases.mjs, naming.mjs, manual.mjs, boundary.mjs, catalogues.mjs, data.mjs.

## Labels

- devos:human-gate — a passing attempt that waits for your merge (risk 3, a migration, a rules change, or a method change).
- devos:halted — three attempts failed; the ledger waits for your decision.
- devos:setup — the setup issue lists secret names, never values.
- devos:change-request — issue form label; intake turns it into a task.
- devos:method-fix — issue form label; risk 3 with a human gate.

## Repository variables

- DEVOS_ACTIVE_MODULES — the modules that are on; deploy skips the rest.
- DEVOS_TYPE — the project type chosen at configuration.
- DEVOS_FRAMEWORK — the framework chosen at configuration.

## Roles

- The human merges gates and types secrets.
- The builder model writes code, tests, and its report; it never runs git or gh and never edits fences or reviews.
- The reviewer model writes the verdict and the next fence; it never writes product code.
- The runner (GitHub Actions plus scripts/devos/) moves git, opens pull requests, applies labels, and updates docs/PHASES.md.
- The configuration model is not part of this repository's automation. It ran once at init and never runs again.
