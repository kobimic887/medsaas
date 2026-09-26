# Compute-host requirements

This is a qualification checklist, not a purchase order, delivery status or deployment record.
Procurement details and machine inventories are maintained privately through [operations](OPERATIONS.md).

The host runs scientific compute; the application API and MongoDB Atlas remain separate.
See [the architecture](BOX-ARCHITECTURE.md) and [cutover checklist](ARRIVAL-RUNBOOK.md).

| Workload | Requirements to establish |
|---|---|
| CPU docking | Supported Linux/container architecture, working Vina image, receptor cache storage and network access for uncached structures |
| DiffDock | Compatible NVIDIA GPU, driver/container runtime, OSS dependencies, model weights and successful real inference |
| convertSTR | CPU/RDKit container; no GPU, database or network dependency during conversion |
| Tanimoto | Compatible API image, Postgres/RDKit cartridge, enough storage for the current datasets, backups and index build space |
| ADMET | Supported model runtime, Atlas access and callback configuration |
| GROMACS | Qualified image and representative CPU/GPU simulation |
| Glioblastoma | Model assets, runtime dependencies and a representative prediction |

Size CPU, memory, GPU memory and storage from representative workloads and expected concurrency.
Check GPU assignments in the resolved Compose configuration: several optional workloads share
a device. A GPU inventory alone does not prove driver, model or engine compatibility.

The docking `autodock-gpu` engine is currently a stub that returns 503. Use the implemented
`vina` backend when qualifying CPU docking. DiffDock uses the OSS adapter; replay engines
exercise compatibility but do not prove scientific inference.

Before deployment, establish secure remote access, recovery access, backup ownership,
service monitoring and enough disk space for artifacts, caches and database restore checks.
