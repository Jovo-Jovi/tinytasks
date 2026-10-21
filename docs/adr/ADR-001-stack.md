# ADR-001 — Stack decision

- Status: accepted
- Date: 2026-10-21
- Deciders: the owner (via the DEV_OS wizard), recorded by the configuration stage

## Context

TinyTasks needs a stack that the DEV_OS cycle can build, check, and review unattended. The choice is made once, at bootstrap, and every later automation (guards, required checks, workflows, deploy) assumes it.

## Decision

- Type: dashboard
- Framework: next
- Language: typescript
- Package manager: npm
- Reviewer: cursor grok-4.7-xhigh
- Builder: cursor grok-4.7-high

## Consequences

The guards and the required checks validate exactly this stack. Changing any of these decisions means a new ADR that supersedes this one — never a quiet edit of the answers or the automation.
