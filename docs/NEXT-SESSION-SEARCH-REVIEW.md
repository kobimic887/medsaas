# Next session: reconcile Simulation search work

Prepared 2026-09-07 while the owner leaves two agents working. This is a handoff,
not an instruction to start more implementation overnight.

## Objective and user-visible success

Reconcile the two agents' Simulation-search implementations, then verify:
Simulation query/drawing → ranked stock hits → correct paging → select a molecule
→ existing simulation/docking handoff. Preserve surrounding Asinex functionality.
The separate Deep Similarity dataset picker does not satisfy Anna's request.

## Fixed constraints and decisions

- Owner says two agents are working on Simulation search; the second uses a separate
  worktree. Do not overwrite their work, merge blindly, or run a competing rewrite.
- Protein UX ideas are **remembered, deferred**: reliable folding, saved prediction
  history/comparison, target-focused Proteinbase references, and eventually binder
  generation. Do not implement these merely because this handoff mentions them.
- Compute box is planned but not ordered or received. Current work cannot depend on it.
- No new live deployment or production data import approval is recorded here.
  Old approval covered the separate picker only. Preserve scratch import evidence.
- Do not incur paid docking/folding jobs just to exercise a handoff.

## Completed state and evidence

- `42bb141`: first Simulation stock-search implementation is committed in main.
  Mac and oracleOld both reported this HEAD with clean working trees at inspection.
  Changes include Simulation UI, stock adapters/routes, tests and documentation.
  Read `docs/DATA-STOCK-COMPOUNDS.md` for its contract and reported verification.
  This coordinating agent has not reviewed or browser-verified that implementation.
- `2c9cc61`: OpenFold3 request/result fixes and inline Molstar preview; focused
  contract/build/viewer/auth checks passed. Real NVIDIA prediction and browser
  rendering remain unproved. Not deployed by this agent.
- `5ea156f`: protein research preserved in `docs/PROTEIN-DESIGN-RESEARCH.md` with
  sources, uncertainty, future options and implementation status.
- `ff166d0`: separate Deep Similarity picker deployed previously; keep it.
- Stock source/import evidence: 630,652 source rows, 630,646 scratch records.
  Reconfirm service availability, do not rerun the long import without reason.

## Uncertainty / blockers

Second agent's worktree was not found. Mac `git worktree list --porcelain` lists
main plus three stale/prunable registrations: casual-greetings, chatbot-model-inquiry,
and test-hi-lol, all at ff53ea8. They are not identified as the search agent.
OracleOld's registry lists only its main checkout. Bounded inspection of usual
Codex/T3/Claude worktree locations found no additional checkout. Nothing was pruned.
The second checkout may be managed elsewhere or registered under another clone.
Obtain its path/branch/commit from the agent report or owner if still undiscoverable.

## Next concrete action and stop point

1. Read both agent completion reports and remeasure Git status/HEAD/worktrees.
2. Locate the second implementation and compare scope, fixes and verification
   against 42bb141. Preserve any independent improvements; resolve overlaps deliberately.
3. Verify the actual Simulation flow with the existing scratch dataset, especially
   ranking/pagination, IDs, stale-request isolation and selection/handoff. Distinguish
   fixture/static checks from browser and real-service evidence.
4. Report remaining defects and fix the agreed integration slice. No protein-feature
   expansion. Follow normal focused verification, commit/push and Mac↔151 sync.
5. Prepare deployment and dataset provisioning separately; state what is actually
   live and seek fresh approval before live mutation.

No overnight watcher or automatic follow-up task was created. Resume on the owner's
next message rather than implying unattended monitoring is running.
