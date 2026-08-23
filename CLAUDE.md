@AGENTS.md

## Claude Code

`AGENTS.md` is the project source for Claude and Codex. Do not duplicate it here.

Start mode, git, sync, and prod live in `~/.codex/AGENTS.md`. Use the named Pyxis
skill when the trigger fits. **Use subagents** (prefer **1** when cheap/narrow;
default fleet **3**; bigger only with explicit authorization this turn).
Cheap/token-conserve still prefers **1**, not a swarm. Voice is normal
readable English (complete sentences; pretty English allowed); do not dump
GOAL. Diagnose fully, execute small.
Do not open `GOAL.md` or handoff/runbooks unless this task needs them.

Project skills: `.agents/skills/` (linked into `.claude/skills/`).
Project subagents: `.claude/agents/`.

When a trap or deploy path changes, update `AGENTS.md` and the matching skill in
the same change. Do not add `LANDMINES.md`.
