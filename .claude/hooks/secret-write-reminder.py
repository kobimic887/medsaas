#!/usr/bin/env python3
"""PreToolUse: remind file-editing tools of named secret-write authorization.

This is model guidance, not a sandbox: shell commands are not intercepted and
prior user approval cannot be inferred reliably from hook input. Never deny an
already authorized workflow or claim that all secret writes are blocked.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ALLOW_NAMES = {
    ".env.example",
    ".env.sample",
    ".env.template",
}

BLOCK_NAMES = {
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    ".env.staging",
    ".env.test",
    "credentials.json",
    "credentials.yml",
    "credentials.yaml",
    "secrets.json",
    "secrets.yml",
    "secrets.yaml",
}


def _paths_from_tool_input(tool_input: object) -> list[str]:
    found: list[str] = []

    def walk(value: object) -> None:
        if isinstance(value, str):
            return
        if isinstance(value, dict):
            for key, inner in value.items():
                if key in {"file_path", "path", "filePath"} and isinstance(inner, str):
                    found.append(inner)
                else:
                    walk(inner)
            return
        if isinstance(value, list):
            for inner in value:
                walk(inner)

    walk(tool_input)
    return found


def is_secret_like(path: str) -> bool:
    name = Path(path).name
    if name in ALLOW_NAMES:
        return False
    if name in BLOCK_NAMES:
        return True
    if name == ".env" or name.startswith(".env."):
        return True
    lower = name.lower()
    if lower.startswith("credentials.") or lower.startswith("secrets."):
        return True
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(payload, dict):
        return 0
    tool_input = payload.get("tool_input") or {}
    for path in _paths_from_tool_input(tool_input):
        if is_secret_like(path):
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": (
                    "This edit targets a secret-like file. Proceed only if the user "
                    "named that file and explicitly approved the write in this session. "
                    "Existing approval is sufficient; do not ask again. If approval "
                    "is missing, do not perform or route around this edit. Never "
                    "print secret values or commit the file."
                ),
            }}))
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
