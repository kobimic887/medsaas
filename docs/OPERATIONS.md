# Operations

Deployment is manual. Git pushes run the configured checks and do not update the
running application. The GitHub deployment workflow targets a separately
configured non-production environment.

## Private operator records

Host inventories, credentials, account identifiers, purchase information,
incident reports, deployment evidence, and release-specific rollback locations
belong outside the shared repository. Obtain the current operator record from
the maintainer before a deployment or migration.

Existing maintainers have a restricted local archive of the documentation removed
during this cleanup at `~/.local/share/pyxis/private-docs/2026-09-26/`. It preserves
the former paths, including `docs/POST-PROMOTION-HANDOFF.md`, `docs/WHERE.md`, and
`docs/STAGING.md`. These are historical records, not proof of the current runtime.
Use them to recover context and rollback information, then measure the relevant
state. Do not copy their contents into shared docs or publish the archive.

Removing text from the current tree does not remove it from Git history. Repository
access and any necessary credential rotation or history cleanup must be handled
separately by the owner.

## Before changing a running service

1. Confirm the requested environment and authorization. Identify DNS, host,
   listeners, service unit, source revision, frontend artifact, and database target
   with read-only checks. Avoid printing environment values or credentials.
2. Run the checks for the affected behavior. A source revision, a built frontend,
   and a restarted service are separate release steps.
3. Record the previous source, built assets, unit configuration, and exact recovery
   procedure in the private operator record. Back up configuration without exposing
   secrets. Do not substitute an obsolete stack for a release-specific rollback.
4. Deploy only to the measured target and restart only the intended service.
5. Verify health, served artifact identity, and the changed user path. Restore the
   saved release if the agreed checks fail; confirm recovery afterwards.

Application data lives in MongoDB Atlas. Scientific compute is separate from the
application API and database. Do not move application data during compute cutover,
start a local MongoDB as a substitute, or change unrelated network/services.

## Related guides

- [Staging deployment](../deploy/staging/README.md): separate build and process,
  with shared production data and providers.
- [Compute cutover](ARRIVAL-RUNBOOK.md): qualify one service at a time.
- [CI](CI-CD.md): automation boundaries.
- [Rollback](../ROLLBACK.md): recovery checklist.
