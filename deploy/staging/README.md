# Staging deployment

The full `/staging/` application uses a separate process and frontend build, but shares
production accounts, Atlas data, history, credits, orders, Stripe and scientific providers.
**Staging actions can change real production data and balances.** Separate browser storage
and a different URL do not make it a sandbox.

See [the staging contract](../../docs/STAGING.md) for behavior and [operations](../../docs/OPERATIONS.md)
for host paths, deployed identities and release-specific rollback records.

## Assets in this directory

| Asset | Purpose |
|---|---|
| `pyxis-web-staging-full.service` | Full application with staging mode and demo mode disabled |
| `pyxis-macrocycle-search-staging.service`, `10-macrocycle-search.conf` | Separate macrocycle index and application URL configuration |
| `pyxis-open-compounds-ai-proxy.service`, `pyxis-open-compounds-ai-tunnel.service` | Restricted AI bridge and its transport |
| `nginx-staging.conf` | `/staging/` proxy configuration |
| `pyxis-web-staging.service`, `env.server.template` | Older isolated demo assets |

Unit files contain installation-specific values. Review the intended service, paths,
environment and access boundaries before installing or changing them. Keep credentials
in operator-managed configuration and out of source archives and command output.

## Build and verify

From the repository root:

```bash
bun --cwd=client run build:staging
bun run test:staging-build
```

The build uses `/staging/` asset URLs and writes `client/dist`. After packaging the staging
artifact, restore the normal local build with `bun --cwd=client run build` before preparing
a consumer release. A normal bundle must not be installed as the staging bundle.

Run the focused server/lifecycle checks for the changed surface. After an approved release,
check process health and `/api/staging/status`; full staging must report `demo:false` and
`sharedProductionData:true`. Check sign-in, existing history, source availability and the
changed user flow. Verify the consumer service and bundle remain unchanged. Do not treat
these checks as proof of payment completion or a paid scientific request.

For a format-2 macrocycle index, deploy the complete `.fpb`, `.rows.csv`, `.cnt` and
`.manifest.json` artifact set. Missing count files make the dataset unavailable. Format-1
indexes remain valid and advertise binary Tanimoto only. Preserve the existing index for
UI-only changes; use the matching prior index when rolling back an index-format change.

## Recovery

Use the snapshot recorded for the specific release. Restore only the affected staging
source/bundle, service configuration and, when necessary, matching search artifacts.
Restart only the affected staging services. Do not restore shared Mongo records, alter
production credentials or replace the consumer bundle as a side effect of code recovery.

The older demo mode uses separate signing configuration, in-process history and fixtures,
and refuses checkout. Restoring it is a deliberate mode change, not a routine full-staging
rollback. Older demo teardown procedures remove the staging route and tree; they are not
a substitute for restoring a full-staging release. Use the procedure matched to the intended
mode and verify `/api/staging/status` afterward.

When backing up an nginx configuration reached through a `sites-enabled` symlink, preserve
the target file's contents. Copying the symlink alone does not preserve the previous config.
