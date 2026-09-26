---
name: pyxis-arrival
description: Prepare, audit, execute, or resume the Pyxis Amsterdam GPU-box arrival and compute-service cutover. Use when the box arrived, box day, arrival day, docking cutover, DiffDock cutover, Tanimoto migration, convertSTR move, arrival readiness, or rollback is mentioned. Routes the agent through the measured pre- or post-DNS runbook without changing application/Mongo placement.
---

# Pyxis arrival

The compute box hosts scientific services only. The application API and MongoDB
Atlas stay separate. Current host identities and rollback records are private;
read `docs/OPERATIONS.md` to locate them and confirm operational facts read-only.

## Establish the mode

1. Inspect `git status`; read `GOAL.md` only when product priorities are relevant.
2. Resolve `app.pyxis-discovery.com`; do not infer the live application host from an old prompt.
3. Read `docs/OPERATIONS.md`, the relevant private operator record, and `AGENTS.md`.
   Historical records provide context; measured state determines the current target.
4. Read `docs/ARRIVAL-RUNBOOK.md`, `docs/BOX-ARCHITECTURE.md`, and the specific service contract.
5. Summarize the measured host roles, approved scope, next gate, rollback, and stop condition before
   any mutation.

## Execute safely

- Ask once for genuinely missing access or operational inputs. Receive secrets through configured
  auth or secure prompts; never echo or persist them.
- Probe DNS, host identity, architecture, GPUs, listeners, services, disk/RAM, network reachability,
  database access, and deployed build identity read-only first.
- Keep the application API and MongoDB Atlas off the compute box.
- Bring up and validate one compute service at a time. Use real request/response contract evidence;
  replay fixtures alone are insufficient.
- Repoint one production path at a time and retain the previous Asinex/host value as rollback.
- Verify credit consumption/refund behavior and the actual user path after each relevant cutover.
- Change shared Atlas company configuration only within the approved cutover. Apply
  host-local environment changes on the measured application host.
- Keep source datasets, containers, and volumes intact until all service gates pass
  and cleanup of the named resources is explicitly authorized. Do not start local Mongo.

## Stop instead of improvising

Stop and report evidence when DNS/host roles are unexpected, database access fails, the GPU or
network does not meet the runbook, a service fails its real contract, the Tanimoto dataset count is
wrong, or the next action would delete data, alter DNS/network policy, or affect an unrelated service.

Do not blindly run the historical port swap. Do not rearchitect arrival day. The success condition is
a measured, reversible compute cutover with the existing user experience intact.
