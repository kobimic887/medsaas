# Application service units

This directory name is historical. The files are deployment templates, not an inventory
of running services or a reason to use a particular host. Follow [operations](../../../docs/OPERATIONS.md)
for current deployment and rollback records.

| Unit | Purpose |
|---|---|
| `pyxis-web.service` | Maintained Bun API serving the built client |
| `pyxis-vite-legacy.service` | Retained legacy frontend template |
| `pyxis-api-legacy.service` | Retained legacy API template |
| `pyxis-stripe.service` | Retained legacy checkout/contact process template |

Before using a template, check its executable, service user, working directory, environment,
frontend path and port against the intended installation. The committed units contain
installation-specific values; do not bulk-copy them onto a shared host.

The maintained application requires source, dependencies and a separately built `client/dist`.
Verify both deployed artifacts, restart only the affected unit and wait for application health
before checking the actual user flow. Do not move a serving application tree out from under
its running process during an in-place release.

Legacy units are recovery artifacts, not the default release path. Starting them can restore
older behavior and security limitations; validate a release-specific recovery plan first.
If the legacy frontend is needed, its unit uses `dev-vite-only`: the broader `npm run dev`
also starts the separate checkout process and can cause a port collision.

Keep server credentials outside any web-served tree. Changing unit files requires a systemd
configuration reload; that alone does not restart the application or prove readiness.
