# Rollback

**Moved.** Bun↔Node / Docker rollback notes (not live Pyxis ops):

[`docs/archive/ROLLBACK-BUN-NODE.md`](./docs/archive/ROLLBACK-BUN-NODE.md)

**Production product rollback** after DNS → `84`: start the three rollback units (stopped,
still enabled), then nginx `:443` → `:5173`
([`docs/PYXIS-WEB-FLIP.md`](./docs/PYXIS-WEB-FLIP.md)). Trees stay on disk. Classic port-swap
reverse in [`docs/ARRIVAL-RUNBOOK.md`](./docs/ARRIVAL-RUNBOOK.md) §8 is unused history.
Host roles: [`docs/POST-PROMOTION-HANDOFF.md`](./docs/POST-PROMOTION-HANDOFF.md).
