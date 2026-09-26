#!/usr/bin/env python3
"""PostToolUse: lint the edited source with local Biome; never install or write."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys


def context(message: str) -> None:
    # Exit-0 stderr is invisible to Claude; structured context is deliberate.
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PostToolUse", "additionalContext": message[:8000]
    }}))


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except (ValueError, TypeError):
        return
    if not isinstance(payload, dict):
        return
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return
    raw = tool_input.get("file_path") or tool_input.get("path")
    if not isinstance(raw, str) or not raw:
        return
    root = Path(os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()).resolve()
    cwd = Path(payload.get("cwd") or root)
    file = Path(raw)
    file = (cwd / file if not file.is_absolute() else file).resolve()
    try:
        relative = file.relative_to(root)
    except ValueError:
        return
    if file.suffix not in {".js", ".jsx", ".mjs"} or not file.is_file():
        return
    if {"node_modules", "dist", ".git"}.intersection(relative.parts):
        return
    biome = root / "node_modules/.bin/biome"
    if not biome.is_file() or not os.access(biome, os.X_OK):
        context("Biome hook skipped: project dependencies are missing. Run the relevant "
                "manual lint check after the normal dependency setup; no packages were installed.")
        return
    try:
        result = subprocess.run(
            [str(biome), "lint", "--colors=off", "--max-diagnostics=10",
             "--error-on-warnings", "--no-errors-on-unmatched", "--", str(file)],
            cwd=root, capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        context(f"Biome hook could not complete ({type(error).__name__}). "
                "Run the focused lint command before declaring verification complete.")
        return
    if result.returncode:
        diagnostics = (result.stdout + result.stderr).strip()
        context(f"Biome reported diagnostics for {relative}. The edit already happened; "
                "fix issues introduced by this change without rewriting unrelated code.\n" + diagnostics)


if __name__ == "__main__":
    main()
