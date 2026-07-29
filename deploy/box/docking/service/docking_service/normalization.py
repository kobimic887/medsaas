from __future__ import annotations

from collections import Counter
import hashlib
import logging
import re
from urllib.parse import unquote_to_bytes

from .errors import InputError
from .metrics import DockingMetrics
from .models import NormalizedRequest

_PDBID_RE = re.compile(r"^[0-9a-z]{4}$", re.IGNORECASE)
_PERCENT_ESCAPE_RE = re.compile(r"%(?![0-9A-Fa-f]{2})")
_PERCENT_TOKEN_RE = re.compile(r"%([0-9A-Fa-f]{2})")
_MAX_SMILES_LENGTH = 16_384
logger = logging.getLogger(__name__)


def decode_percent_once(value: str, field_name: str) -> str:
    """Decode URL escapes one time, rejecting malformed escapes and non-UTF-8 bytes."""
    if not isinstance(value, str):
        raise InputError(f"{field_name} must be a string")
    if _PERCENT_ESCAPE_RE.search(value):
        raise InputError(f"{field_name} contains an invalid percent escape")
    try:
        return unquote_to_bytes(value).decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise InputError(f"{field_name} must decode as UTF-8") from exc


def _looks_like_unencoded_ring_smiles(value: str) -> bool:
    """Preserve paired `%10`-`%99` SMILES ring labels that resemble URL escapes."""
    tokens = _PERCENT_TOKEN_RE.findall(value)
    if not tokens or len(tokens) != value.count("%") or re.search(r"%25[1-9][0-9]", value, re.IGNORECASE):
        return False
    counts = Counter(tokens)
    return all(token.isdigit() and int(token) >= 10 for token in tokens) and all(
        count % 2 == 0 for count in counts.values()
    )


def normalize_request(
    *,
    pdbid: str,
    smiles: str,
    metrics: DockingMetrics,
    already_decoded: bool = False,
) -> NormalizedRequest:
    if not isinstance(pdbid, str):
        raise InputError("pdbID must be a string")
    normalized_pdbid = pdbid.strip().lower()
    if not _PDBID_RE.fullmatch(normalized_pdbid):
        raise InputError("pdbID must be a four-character PDB identifier")
    if not isinstance(smiles, str):
        raise InputError("smiles must be a string")

    decoded_smiles = (
        smiles
        if already_decoded or _looks_like_unencoded_ring_smiles(smiles)
        else decode_percent_once(smiles, "smiles")
    )
    if not decoded_smiles or len(decoded_smiles) > _MAX_SMILES_LENGTH:
        raise InputError("smiles must be a non-empty string within the supported length")
    if any(ord(character) < 32 or ord(character) == 127 for character in decoded_smiles):
        raise InputError("smiles contains unsupported control characters")

    has_semicolon = ";" in decoded_smiles
    has_comma = "," in decoded_smiles
    if has_semicolon:
        metrics.increment("rejected_multi_input_semicolon")
    if has_comma:
        metrics.increment("rejected_multi_input_comma")
    if has_semicolon or has_comma:
        logger.warning(
            "rejected multi-input SMILES separator",
            extra={
                "pdbid": normalized_pdbid,
                "has_semicolon": has_semicolon,
                "has_comma": has_comma,
                "smiles_sha256": hashlib.sha256(decoded_smiles.encode("utf-8")).hexdigest(),
            },
        )
        raise InputError("smiles must contain exactly one molecule; multi-input separators are unsupported")

    return NormalizedRequest(
        pdbid=normalized_pdbid,
        smiles=decoded_smiles,
        smiles_sha256=hashlib.sha256(decoded_smiles.encode("utf-8")).hexdigest(),
    )


def parse_legacy_path(raw_path: bytes) -> tuple[str, str]:
    """Parse the legacy raw path without FastAPI's already-decoded path parameter."""
    prefix = b"/docking/"
    if not raw_path.startswith(prefix):
        raise InputError("legacy docking path is malformed")
    payload = raw_path[len(prefix) :]
    # The compatibility form is exactly one raw path segment. A literal slash is
    # a second segment; a slash that is part of a valid SMILES must be percent-encoded.
    if b"/" in payload:
        raise InputError("legacy docking path must contain exactly one path segment")
    parts = payload.split(b"&")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise InputError("legacy docking path must contain one pdbID&smiles segment")
    try:
        pdbid = decode_percent_once(parts[0].decode("ascii"), "pdbID")
        raw_smiles = parts[1].decode("ascii")
        smiles = (
            raw_smiles
            if _looks_like_unencoded_ring_smiles(raw_smiles)
            else decode_percent_once(raw_smiles, "smiles")
        )
    except UnicodeDecodeError as exc:
        raise InputError("legacy docking path must be ASCII percent-encoded") from exc
    return pdbid, smiles
