# Compute-service cutover

Use this checklist when preparing or moving scientific services to a compute host.
It describes acceptance gates, not a record of purchased hardware or completed deployment.
Host access, deployed identities and recovery records belong in [operations](OPERATIONS.md).

The application API stays on the application host. MongoDB Atlas stays in place.
The compute host may run docking, DiffDock, conversion, Tanimoto/Postgres and the
additional scientific services described in [the architecture](BOX-ARCHITECTURE.md).

## Prepare

1. Confirm the requested scope, application and compute host identities, current service URLs,
   and a working recovery path. Begin with read-only checks.
2. Measure CPU architecture, memory, storage, GPU/driver compatibility, network access and
   container support. Do not infer readiness from a proposed specification.
3. Arrange service secrets through the operator's secure configuration process. Keep them
   out of source, transcripts, fixture files and logs.
4. Build the required images on an appropriate Docker host. Use the supplied
   [service checks](../deploy/box/BRIEF-SERVICES.md); avoid installing scientific toolchains
   on the development laptop.
5. Obtain the current Tanimoto image/source and a fresh, verified database backup if search
   is in scope. The Compose file references an external Tanimoto image; it does not build it.
6. Record the existing settings and release artifacts needed to reverse each individual change.

## Validate before routing traffic

- Keep compute ports bound to loopback. Set up [HTTPS ingress and access control](../deploy/box/ingress/README.md)
  and verify access from both an allowed and a disallowed machine. Preserve an independent
  recovery path before changing SSH or firewall policy.
- Start one service at a time. Review the resolved Compose configuration and selected engines.
  Set `DOCKING_ENGINE=vina` explicitly for the implemented CPU backend; the Compose fallback
  is `autodock-gpu`, which is deliberately unavailable. Replay mode is test data.
- Run the [docking contract verifier](DOCKING-CONTRACT.md) against a real engine response.
  Check receptor coordinates, SDF serialization, positive pose count and viewer behavior.
- Exercise convertSTR with valid and invalid SMILES. Run DiffDock preflight and a real
  inference request; replay fixtures do not establish GPU or dependency readiness.
- For Tanimoto, restore into the target Postgres instance and verify dataset identities,
  row counts, indexes and representative exact/similarity searches against the source.
  The existing `scripts/verify-tanimoto-restore.sh` pins a historical schema/count; review
  those assumptions before using it with an explicit backup path. It is not sufficient
  evidence for newer datasets. Keep the source intact.

## Cut over and verify

Change one application service setting at a time. Restart only the affected application
service when it reads the setting at startup. Verify the response through the actual
application, including result rendering and relevant credit/refund behavior, before
proceeding to the next service.

For each step, record the measured build identity, changed setting name, acceptance result
and previous working value in private operations records. Do not record secret values.
A health endpoint proves process availability; it does not prove a successful scientific job.

If a gate fails, restore that service's previous working configuration and verify the
application again. Confirm the rollback endpoint is still functional before relying on it.
This compute cutover does not require a legacy frontend port swap or application database restore.

## Additional services and retirement

ADMET is a Mongo-backed worker and requires approved Atlas access plus callback configuration.
GROMACS and glioblastoma are separate acceptance steps; they do not block an otherwise
complete docking cutover. Folding and molecule generation continue to use hosted services.

Retire old containers, datasets or volumes only after the migrated services pass their
contracts, recoverable backups exist, and the operator explicitly approves that cleanup.
Do not remove unrelated workloads on shared hosts.
