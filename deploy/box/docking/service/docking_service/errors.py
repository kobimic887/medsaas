from __future__ import annotations


class DockingError(Exception):
    status_code = 400
    public_message = "invalid docking request"

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.public_message)


class InputError(DockingError):
    status_code = 400


class StructureError(DockingError):
    status_code = 422
    public_message = "PDB structure is unsupported for strict receptor preparation"


class PdbFormatUnavailable(DockingError):
    status_code = 404
    public_message = "PDB-format unavailable or entry missing, possibly mmCIF-only"


class RcsbFailure(DockingError):
    status_code = 502
    public_message = "RCSB receptor download failed"


class UnsupportedFixtureError(InputError):
    public_message = "replay fixture does not support this docking request"


class DockingUnavailable(DockingError):
    status_code = 503
    public_message = "docking backend is unavailable"


class DockingFailure(DockingError):
    status_code = 502
    public_message = "docking failed before producing usable poses"


class DockingTimeout(DockingError):
    status_code = 504
    public_message = "docking exceeded its execution time limit"
