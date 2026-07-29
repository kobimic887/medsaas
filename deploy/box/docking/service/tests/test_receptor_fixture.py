from hashlib import sha256
from importlib.resources import files

from docking_service.receptor import FixedRcsbClient, _parse_and_validate_source, _select_box
from docking_service.settings import ReceptorConfig


CANONICAL_REPLAY_SHA256 = "d4536ba7dfbdc96e82f4a4660ac2a299b2ed0996a2f3331905d0d36f7dfa73dd"


def test_committed_replay_fixture_has_canonical_hash() -> None:
    fixture = files("docking_service").joinpath("assets/1cx7-asinex.json").read_bytes()
    assert sha256(fixture).hexdigest() == CANONICAL_REPLAY_SHA256


def test_raw_1cx7_fixture_selects_hed_over_waters_and_ions() -> None:
    source = FixedRcsbClient.for_1cx7().fetch_pdb("1cx7")
    box = _select_box(_parse_and_validate_source(source), ReceptorConfig())
    assert box.ligand_resname == "HED"
    assert box.fallback_reason is None
    assert all(value > 0 for value in box.size)
