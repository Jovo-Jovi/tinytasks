# AGENTS.md — the rules every agent follows in this repository

The builder, the reviewer, the doctor, and any other agent that works here read
this file first. The rules are short on purpose: they are a contract, not a guide.

- Read docs/PHASES.md and the task fence devos/fences/T<nn>.md before writing anything. The fence is the whole assignment for the attempt.
- Work only inside this repository. The runner owns git and gh: agents never push, never merge, never open issues.
- Keep the boundary in docs/BOUNDARY_MODEL.md: UI files never import from the server or data zones.
- Secrets are names only (.env.example). A secret value never enters a file, a prompt, a log, or an issue.
- Finish every attempt with the fence's done-when rows demonstrably true; the reviewer checks them one by one and writes docs/reviews/T<nn>-aN.md.
- When the fence is wrong or incomplete, say so in docs/reports/T<nn>-aN.md. The reviewer rewrites the fence; the builder never edits it silently.
- Follow docs/adr/ for decisions already made; a decision that conflicts with an ADR is a new ADR, not a quiet change.
