#!/usr/bin/env python3
"""PreToolUse: block Write/Edit of .env and credential files. Exit 2 denies."""
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


def is_blocked(path: str) -> bool:
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
    tool_input = payload.get("tool_input") or {}
    for path in _paths_from_tool_input(tool_input):
        if is_blocked(path):
            print(
                f"Blocked write to secret-like file ({path}). "
                "Never write .env or credential files.",
                file=sys.stderr,
            )
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
