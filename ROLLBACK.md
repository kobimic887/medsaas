# Rollback

A rollback must use the previous verified release for the affected environment.
Record its source, frontend bundle, service configuration, and restore procedure
before deploying. Keep the record and backups private; see
[Operations](docs/OPERATIONS.md).

Restore only the components changed by that release, restart only their services,
and verify health, artifact identity, and the affected user path. Code rollback
does not undo database writes, payments, credits, or provider jobs. A staging code
failure is not a reason to restore the shared production database.

Historical port swaps and retired stacks are not general-purpose rollback plans.
