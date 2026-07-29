from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="pyxis-docking")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("serve", help="run the private HTTP service")
    warm = commands.add_parser("warm", help="populate receptor cache entries")
    warm.add_argument("pdbid", nargs="+", help="one or more four-character PDB IDs")
    purge = commands.add_parser("purge", help="remove one receptor cache entry")
    purge.add_argument("pdbid", help="lowercase four-character PDB ID")
    commands.add_parser("purge-stale", help="remove incomplete or incompatible cache entries")
    arguments = parser.parse_args()

    if arguments.command in {None, "serve"}:
        import uvicorn
        # The legacy GET embeds molecular input in the path, so default access logs would leak it.
        uvicorn.run(
            "docking_service.api:create_app",
            factory=True,
            host="0.0.0.0",
            port=8000,
            access_log=False,
        )
        return

    from .engines.registry import create_engine
    from .metrics import DockingMetrics
    from .service import DockingService
    from .settings import Settings

    settings = Settings.from_environment()
    service = DockingService.for_engine(settings, create_engine(settings.engine_name), DockingMetrics())
    if arguments.command == "warm":
        service.warm(arguments.pdbid)
    elif arguments.command == "purge":
        service.purge(arguments.pdbid)
    elif arguments.command == "purge-stale":
        service.purge_stale()


if __name__ == "__main__":
    main()
