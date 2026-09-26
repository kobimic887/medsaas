# Security maintenance

Detailed findings, incident records and credential follow-up are maintained privately.
See [operations](OPERATIONS.md) for the record boundary. This page is not a security audit
or a statement that a deployed release has been assessed.

## Application invariants

- A same-origin `401` ends the browser session. Use it for invalid or missing sessions;
  use `403` for authorization failures, `400` for validation and `502` for upstream auth failure.
- Enforce active-user, role and company checks on the server. Client controls are not authorization.
- Resolve checkout prices on the server and grant credits only through verified webhook handling.
- Scope result/history access to the authenticated user or company as required by the route.
- Keep credentials, connection strings and private scientific/customer payloads out of
  source, browser bundles, logs and documentation.
- Keep unauthenticated compute services behind verified access controls.

Browser JWT storage in `localStorage` remains a known architectural limitation. Changing
session transport requires an explicit migration plan; a documentation cleanup does not
resolve it or establish that other security debt has been fixed.

## Relevant checks

| Area | Focused command |
|---|---|
| Configured scientific URLs | `bun --cwd=server run test:ssrf` |
| Scientific proxy access | `bun --cwd=server run test:scientific-services` |
| History ownership | `bun --cwd=server run test:simulation-logs` |
| Payment fulfillment | `bun --cwd=server run test:stripe` |
| Catalog checkout | `bun run test:catalog-pricing` |
| ADMET job lifecycle | `bun --cwd=server run test:admet-queue` |

Choose checks that exercise the changed boundary and record what remains unproved.
Report suspected vulnerabilities privately to the project maintainers with the affected
revision, impact and a minimal reproduction that avoids customer data or secret values.
