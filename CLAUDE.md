# Home Planner — AI development operating rules

Repository: dedudette/home-planner. This is an existing application; do not rebuild it.

## Operating model
- Human owner approves scope, production deployment, payments, irreversible changes and paid external integrations.
- Orchestrator scopes work; developer and AI engineer implement; QA validates.
- Use GitHub Issues for requirements and pull requests for review. Never merge automatically.
- Work on feature branches; avoid concurrent edits to the same files.
- Inspect the repository and documentation before changes; do not infer feature completeness from installed dependencies.
- Keep secrets out of commits and logs. Never expose real user data in test fixtures.
- Prefer minimal, reversible changes with acceptance criteria and tests.
- Report completed work, commands run, results, known issues, costs and decisions requiring approval.

## Local verification
- npm run typecheck
- npm test
- npm run build
- npm run e2e (only with suitable browser/server setup)

## Product context
Home Planner includes routines, cleaning, fitness, habits, energy-aware planning and personalization. Paolo is the in-app AI owl, distinct from the engineering agents. Proposed business model: 14-day trial, €25 monthly, annual subscription discounted 15%; verify implementation and tax/payment details before enabling billing.
