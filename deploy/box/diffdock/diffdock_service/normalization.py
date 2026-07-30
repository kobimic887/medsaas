from __future__ import annotations

from .errors import InputError

# The platform escapes the same field three different ways depending on which branch built it
# (server/index.js:4986 vs :5027). All three arrive here and all three must work:
#
#   raw               real newlines, no backslashes            — the retry path
#   backslash-newline a backslash BEFORE each real newline     — the ligand-ID path, and every
#                                                                protein ever sent
#   literal-escape    the two characters \ and n, no real
#                     newlines anywhere                        — the SMILES path
#
# The captured traffic settles which of those the upstream NIM actually tolerates: every
# `protein` in the log is backslash-newline and every one of them worked, because a PDB parser
# reads fixed columns and a trailing backslash past column 80 is ignored. The one captured
# ligand in literal-escape form is the one that came back
# `Fail to read ligand molecule description`, three seconds before the identical raw ligand
# succeeded. So the escaping is not cosmetic — it is the production bug, and normalising here
# is what stops the platform's retry from ever firing again.

RAW = "raw"
BACKSLASH_NEWLINE = "backslash-newline"
LITERAL_ESCAPE = "literal-escape"


def decode_escaped(text: str) -> tuple[str, str]:
    """Return (decoded text, the form it arrived in).

    Order matters. Backslash-newline is unwrapped first because stripping it cannot create a
    literal `\\n`; doing it the other way round would turn a legitimate backslash at end of
    line into a spurious newline.
    """
    if "\\\n" in text or "\\\r\n" in text:
        return text.replace("\\\r\n", "\n").replace("\\\n", "\n"), BACKSLASH_NEWLINE

    if "\n" not in text and "\\n" in text:
        # No real newline anywhere: the whole payload is one line of literal escapes.
        # Only in that case is rewriting \n safe — an SDF data field may legitimately
        # contain a backslash, and a mixed payload is not something production produces.
        return text.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n"), LITERAL_ESCAPE

    return text.replace("\r\n", "\n"), RAW


def require_protein(text: str) -> str:
    """The platform sends ATOM records only. Anything without one cannot be docked."""
    stripped = text.strip()
    if not stripped:
        raise InputError("protein is empty")
    for line in stripped.splitlines():
        if line.startswith(("ATOM", "HETATM")):
            return stripped
    raise InputError("protein contains no ATOM or HETATM records")


def ensure_sdf_terminator(text: str) -> str:
    """chem_beo appends `$$$$` when the converter omits it; do the same rather than rely on it."""
    stripped = text.rstrip()
    if not stripped:
        raise InputError("ligand is empty")
    if stripped.endswith("$$$$"):
        return stripped + "\n"
    return stripped + "\n$$$$\n"


def looks_like_sdf(text: str) -> bool:
    return "V2000" in text or "V3000" in text or "M  END" in text
