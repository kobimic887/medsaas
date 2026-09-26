# CI and verification

The workflow is defined in [ci.yml](../.github/workflows/ci.yml). It selects checks
from the changed files; the full suites remain available when needed.

## What runs automatically

| Change or trigger | Checks |
| --- | --- |
| Documentation only (`*.md` or `docs/`) | Change selection; application builds and container tests are skipped |
| Application, test, or other non-documentation files | Bun build, lint, client contracts, and server suite |
| convertSTR or docking implementation | The corresponding Linux container suite, plus the Bun gate |
| CI workflow or compute Compose configuration | Both compute container suites, plus the Bun gate |
| Manual CI run | Full Bun, Node 24 fallback, and both compute suites |
| Reusable workflow call | Full validation by default; caller may explicitly disable it |

The check-selection job still completes on documentation changes, so there is a
record of why expensive jobs were skipped. Unknown/missing Git history selects
full validation. GitHub-managed security workflows have their own triggers.

Each runtime suite executes its server tests once. Catalog pricing, count-Morgan,
stock, and open-compound server tests are already included there; the root gate
adds the client checks without repeating those server suites.

## Local verification

Choose a check that exercises the changed behavior:

| Change | Starting point |
| --- | --- |
| Documentation | Review commands and local links; `git diff --check` |
| UI or routing | `bun run check`, then the relevant existing lifecycle check |
| Auth, billing, shared middleware | Relevant `server/package.json` test; full server suite for shared behavior |
| Compound search | `bun run test:simulation-search` plus the changed source's focused test |
| Catalog pricing or basket | `bun run test:catalog-pricing` |
| Macrocycle index | `bun run test:macrocycle-index` |
| Broad release/configuration change | `bun run ci`; manual CI also checks Node and compute containers |

`bun run test` is the server suite. `bun run ci` is the full local Bun gate;
`npm run ci:node` is the Node fallback gate. A passing build or source-text check
does not establish that a user interaction works; exercise the relevant browser
or runtime path when behavior changes. Reuse existing checks before adding tests.

Server integration tests use an isolated MongoDB test process. The first run may
download its binary; this does not require starting the project's legacy local
MongoDB stack or connecting tests to an application database.
Runtime fixtures must set their own application URLs; CORS expectations must not
depend on a developer's private environment file.

## Deployment

Pushing or merging code does not deploy it.
[deploy.yml](../.github/workflows/deploy.yml) is a manual non-production workflow.
It calls the full CI workflow, sends a tracked-source archive, builds the image
on the configured target, and checks application health. Credentials and the
host environment file are managed outside the repository.

Production releases follow the [operations guide](OPERATIONS.md) and current
private operator record. Build, upload, restart, and verify the intended artifact
as separate steps, with a release-specific rollback prepared beforehand.
