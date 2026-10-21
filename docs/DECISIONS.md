# Decisions

- Type: dashboard (Dashboard or internal tool).
- Framework: next (Next.js App Router, TypeScript). Package manager: npm.
- Reviewer: cursor grok-4.7-xhigh.
- Builder: cursor grok-4.7-high.
- Light reviewer: same as the reviewer (cursor grok-4.7-xhigh).
- Configuration model: cursor grok-4.7-high (stage configuration-only). It runs once at init and is not a cycle role.
- Pick policy: reviewer-picks.
- Builder pool: cursor grok-4.7-high.
- Base branch: main. Max attempts: 3.
- Languages: en, ar.
- Active modules:
  - styling: tailwind
  - ui-kit: shadcn
  - i18n: en and ar
  - testing: unit on, Playwright off
  - hosting: vercel
  - automation: always on
