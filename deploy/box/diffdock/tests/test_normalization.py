from __future__ import annotations

from diffdock_service.normalization import (
    BACKSLASH_NEWLINE,
    LITERAL_ESCAPE,
    RAW,
    decode_escaped,
    ensure_sdf_terminator,
)

from .conftest import load_reference


def test_raw_text_is_left_alone() -> None:
    text, form = decode_escaped("ATOM      1  N\nATOM      2  C\n")
    assert form == RAW
    assert text == "ATOM      1  N\nATOM      2  C\n"


def test_backslash_newline_is_unwrapped() -> None:
    text, form = decode_escaped("ATOM      1  N\\\nATOM      2  C\\\n")
    assert form == BACKSLASH_NEWLINE
    assert "\\" not in text
    assert text.splitlines() == ["ATOM      1  N", "ATOM      2  C"]


def test_literal_backslash_n_is_decoded() -> None:
    text, form = decode_escaped("ATOM      1  N\\nATOM      2  C\\n")
    assert form == LITERAL_ESCAPE
    assert text.splitlines() == ["ATOM      1  N", "ATOM      2  C"]


def test_the_three_captured_wire_forms_decode_to_the_same_molecule() -> None:
    """The production bug, as a test.

    The successful dock and the failed one three seconds earlier are the SAME ligand sent
    two different ways. Normalising here is what stops the platform's retry from firing.
    """
    ok = load_reference("response-success-1pose.json")["response"]["ligand"]
    broken = load_reference("response-failed-unreadable-ligand.json")["response"]["ligand"]

    ok_text, ok_form = decode_escaped(ok)
    broken_text, broken_form = decode_escaped(broken)

    assert ok_form == RAW
    assert broken_form == LITERAL_ESCAPE
    # Same atom and bond counts line — the payloads differ only in escaping.
    assert ok_text.splitlines()[3] == broken_text.splitlines()[3]
    assert "\\" not in broken_text


def test_captured_protein_is_backslash_newline_and_decodes_to_atom_records() -> None:
    protein = load_reference("response-success-1pose.json")["response"]["protein"]
    text, form = decode_escaped(protein)
    assert form == BACKSLASH_NEWLINE
    assert "\\" not in text
    assert all(line.startswith("ATOM") for line in text.splitlines() if line.strip())


def test_sdf_terminator_is_added_once() -> None:
    assert ensure_sdf_terminator("M  END").endswith("$$$$\n")
    assert ensure_sdf_terminator("M  END\n$$$$\n").count("$$$$") == 1
