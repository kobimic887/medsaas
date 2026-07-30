from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(prog="pyxis-diffdock")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("serve", help="run the private HTTP service")
    commands.add_parser("preflight", help="check the configured engine can run, then exit")
    arguments = parser.parse_args()

    if arguments.command == "preflight":
        from .engines.registry import create_engine
        from .settings import Settings

        settings = Settings.from_environment()
        engine = create_engine(settings)
        engine.preflight()
        print(f"OK: engine {engine.name} is ready")
        return

    import uvicorn

    # Access logs would carry a 100 KB protein per line; the service logs what matters itself.
    uvicorn.run(
        "diffdock_service.api:create_app",
        factory=True,
        host="0.0.0.0",
        port=8002,
        access_log=False,
    )


if __name__ == "__main__":
    main()
