@AGENTS.md

## Claude Code

`AGENTS.md` is the project source for Claude and Codex. Do not duplicate it here.

Start mode, git, sync, and prod live in `~/.codex/AGENTS.md`. Use the named Pyxis
skill when the trigger fits. Small one-pass work may stay inline; use subagents
when independent lanes add value (default fleet **4**; bigger only with explicit
authorization this turn). UltraCode explicitly calls dynamic Workflow orchestration.
Diagnose fully, execute small.

Project skills: `.agents/skills/` (linked into `.claude/skills/`).
Project subagents: `.claude/agents/`.

When a trap or deploy path changes, update `AGENTS.md` and the matching skill in
the same change. Do not add `LANDMINES.md`.
