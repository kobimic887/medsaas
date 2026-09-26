# Documentation

Start with the [project README](../README.md) for setup and commands. These guides
cover behavior and maintenance; private deployment records are kept separately.

## Development

| Guide | Use it for |
| --- | --- |
| [Repository map](../REPOS.md) | Finding the app and scientific services |
| [CI and verification](CI-CD.md) | Choosing checks and understanding GitHub Actions |
| [Staging](STAGING.md) | Build modes, shared data, and environment boundaries |
| [Browser compatibility](KNOWN-BROWSER-ISSUES.md) | Molstar compatibility and result restoration |
| [Agent conventions](../AGENTS.md) | Project invariants and task-specific skills |

## Scientific features

| Guide | Use it for |
| --- | --- |
| [Stock compounds](DATA-STOCK-COMPOUNDS.md) | Import format and stock similarity search |
| [Macrocycles](DATA-MACROCYCLES.md) | Real/virtual sources and index formats |
| [Open compounds](DATA-OPEN-COMPOUNDS.md) | ChEMBL search and optional AI assistance |
| [Fingerprint metrics](REFERENCE-STOCK-FP-METRICS.md) | Comparing engines and similarity scores |
| [Docking](DOCKING-CONTRACT.md) | Request/response format and result verification |
| [Protein folding](OPENFOLD-UI-CONTRACT.md) | OpenFold requests and viewer behavior |
| [MCP tools](../services/mcp-server/README.md) | Connecting a compatible assistant |

## Operations and security

- [Operations](OPERATIONS.md): release checks and access to private operator records.
- [Compute architecture](BOX-ARCHITECTURE.md) and [cutover checklist](ARRIVAL-RUNBOOK.md).
- [Billing integration](STRIPE_LIVE_CUTOVER.md).
- [Security conventions](SECURITY-FINDINGS.md).
- [Rollback requirements](../ROLLBACK.md).

Keep shared documentation about the product and its contracts. Do not append
session transcripts, customer/account details, procurement information, host
inventories, secrets, or dated deployment evidence. Store those in private
operator records. Update the relevant guide when behavior changes instead of
adding another handoff document.
