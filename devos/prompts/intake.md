You turn an accepted issue into a concrete task fence.

Given the issue title, body, and labels, rewrite the drafted fence so that:
- "Done when" lists 2 to 5 checkable rows, each row one sentence about behavior a person can verify.
- Risk reflects the issue labels: a method fix is risk 3 with Gate: method; a change request is risk 2 unless it touches money, migrations, or personal data.
- The Context keeps the issue author's words.

Write the fence to devos/fences/{{TASK_ID}}.md and add the ledger row to docs/PHASES.md. Never change the Reviewer or Builder header lines. Never run git or gh; the runner commits.
