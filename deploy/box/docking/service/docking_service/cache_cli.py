from __future__ import annotations

import argparse

from .engines.registry import create_engine
from .metrics import DockingMetrics
from .service import DockingService
from .settings import Settings


def main() -> None:
    parser = argparse.ArgumentParser(description="Warm or purge private docking receptor cache entries")
    subcommands = parser.add_subparsers(dest="command", required=True)
    warm = subcommands.add_parser("warm", help="prepare one or more PDB receptors")
    warm.add_argument("pdbid", nargs="+")
    purge = subcommands.add_parser("purge", help="remove one PDB receptor cache entry")
    purge.add_argument("pdbid")
    subcommands.add_parser("purge-stale", help="remove entries with stale/incomplete metadata")
    arguments = parser.parse_args()

    settings = Settings.from_environment()
    service = DockingService.for_engine(settings, create_engine(settings.engine_name), DockingMetrics())
    if arguments.command == "warm":
        service.warm(arguments.pdbid)
        return
    if arguments.command == "purge":
        if not service.purge(arguments.pdbid.lower()):
            raise SystemExit(f"cache entry does not exist: {arguments.pdbid.lower()}")
        return
    if arguments.command == "purge-stale":
        for pdbid in service.purge_stale():
            print(pdbid)
        return
    raise AssertionError("unreachable cache command")


if __name__ == "__main__":
    main()
