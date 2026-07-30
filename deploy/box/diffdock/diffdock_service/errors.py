from __future__ import annotations


class DiffDockError(Exception):
    """Base for every error this service raises deliberately."""

    status_code = 400
    public_message = "invalid DiffDock request"

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.public_message)


class InputError(DiffDockError):
    """The request is structurally wrong — answered with a real 4xx, not a failed envelope."""

    status_code = 400


class DockFailure(DiffDockError):
    """The request was well formed and the dock did not produce poses.

    This is the ONLY error class that becomes an HTTP 200 `status: "failed"` body, because
    that is what the upstream NIM does and the platform parses it that way. See README §2.
    """

    status_code = 200
    public_message = "DiffDock did not produce poses"


class EngineUnavailable(DiffDockError):
    """The configured engine cannot run at all — missing weights, missing repo, no GPU."""

    status_code = 503
    public_message = "DiffDock engine is unavailable"


class ConversionFailure(DiffDockError):
    """convertSTR could not turn the supplied SMILES into an SDF."""

    status_code = 400
    public_message = "SMILES to SDF conversion failed"
