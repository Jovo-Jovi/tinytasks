The task failed its review. Rewrite the fence for the next attempt.

Given the previous fence, the review file, and the failing check output:
- Keep the Reviewer and Builder header lines exactly as they are.
- Keep the task id. Update Attempt to {{ATTEMPT}}.
- Narrow the scope so the next attempt can pass: fewer done-when rows, clearer wording, one behavior per row.
- Record what you learned in the Notes section so the builder does not repeat the failure.

Do not run git or gh. Do not write product code. Write only the fence file.
