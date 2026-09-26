# Scientific compute architecture

Pyxis separates the web application, its managed database and scientific compute.
This document describes that boundary. Current machines and release records belong in
[operations](OPERATIONS.md); the migration checklist is [compute-service cutover](ARRIVAL-RUNBOOK.md).

## Components

| Component | Responsibility |
|---|---|
| React client | Search, submission, progress and result visualization |
| Express/Bun application | Authentication, authorization, credits, checkout, history and scientific proxies |
| MongoDB Atlas | Application accounts, company configuration, history, billing and ADMET job records |
| Docking service | Prepared-receptor cache, engine execution and compatible PDB/SDF results |
| convertSTR | CPU SMILES-to-3D-SDF conversion |
| DiffDock service | Compatible request/response envelope around OSS DiffDock |
| Tanimoto API + Postgres/RDKit | Compound datasets and chemical search |
| ADMET, GROMACS, glioblastoma | Independently deployable scientific workloads |
| Hosted NVIDIA services | Folding and molecule generation |

The compute Compose stack is in [`deploy/box/compose.yml`](../deploy/box/compose.yml).
It does not deploy the application API or an application MongoDB instance. Tanimoto's
Postgres is a search database and is distinct from MongoDB Atlas.

## Requests and access

The browser calls the application. The application enforces session, active-user,
authorization and credit rules before calling scientific services. Compute endpoints
are not a replacement for those checks and must not be exposed to arbitrary callers.

The supplied deployment uses loopback container bindings, host-managed HTTPS ingress
and an application-host allowlist. See [ingress](../deploy/box/ingress/README.md) for route
prefix behavior and verification. TLS and access control are separate requirements.

## Jobs and data

Docking caches prepared receptors on the compute host. Cache metadata records preparation
version and artifact integrity; changing preparation semantics invalidates old entries.
Tanimoto migrations copy and validate their own Postgres datasets before routing traffic.
Neither operation replaces the application database.

ADMET uses a MongoDB job collection through `server/utils/admetQueue.js` and the worker in
`services/admet/`. RabbitMQ/CloudAMQP is not the ADMET transport. The worker needs Atlas access
and its configured callback credentials even though the core docking path does not.

## Failure and recovery

Keep the application and database available independently of compute. A failed scientific
service should produce an explicit application error and the appropriate credit handling.
Move one service URL at a time and retain a tested previous endpoint. A compute failure is
not a reason to restore account data or switch back to an obsolete application stack.

See [docking compatibility](DOCKING-CONTRACT.md), [service documentation](../deploy/box/BRIEF-SERVICES.md)
and [hardware qualification](BOX-SPEC.md) for the corresponding acceptance requirements.
