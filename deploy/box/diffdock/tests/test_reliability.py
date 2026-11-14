from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import logging
import sys
from threading import Event
import time
from types import SimpleNamespace

import pytest

from diffdock_service import cuda_inference
from diffdock_service.engines.oss import OssDiffDockEngine
from diffdock_service.errors import DockFailure
from diffdock_service.settings import EngineConfig
from .test_oss_engine import _request, _settings


def test_busy_request_is_rejected_without_waiting_and_slot_recovers(client, canonical_request, monkeypatch, caplog):
    entered, release = Event(), Event()
    service = client.app.state.service
    original = service.generate

    def blocked(body):
        entered.set()
        assert release.wait(5)
        return original(body)

    monkeypatch.setattr(service, "generate", blocked)
    caplog.set_level(logging.INFO, logger="diffdock_service")
    body = {**canonical_request, "num_poses": 1}
    with ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(client.post, "/molecular-docking/diffdock/generate", json=body, headers={"X-Pyxis-Request-Id": "test-request"})
        try:
            assert entered.wait(5)
            busy = client.post("/molecular-docking/diffdock/generate", json=body)
            assert busy.status_code == 503
            assert busy.json()["code"] == "DIFFDOCK_BUSY"
            assert busy.headers["Retry-After"] == "10"
        finally:
            release.set()
        assert first.result(timeout=5).status_code == 200
    monkeypatch.setattr(service, "generate", original)
    assert client.post("/molecular-docking/diffdock/generate", json=body).status_code == 200
    assert "id=test-request" in caplog.text
    assert canonical_request["ligand"] not in caplog.text
    assert canonical_request["protein"] not in caplog.text


def test_slot_released_after_engine_error(client, canonical_request, monkeypatch):
    service = client.app.state.service
    original = service.generate

    def fail(_body):
        raise DockFailure("fixture failure")

    monkeypatch.setattr(service, "generate", fail)
    assert client.post("/molecular-docking/diffdock/generate", json=canonical_request).json()["error"] == "fixture failure"
    monkeypatch.setattr(service, "generate", original)
    assert client.post("/molecular-docking/diffdock/generate", json=canonical_request).status_code == 200


def test_cuda_guard_does_not_start_cpu_fallback(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)))
    monkeypatch.setattr(cuda_inference.runpy, "run_module", lambda *a, **k: pytest.fail("inference must not run"))
    with pytest.raises(RuntimeError, match="requires CUDA"):
        cuda_inference.main()


def test_cuda_guard_proves_operation_before_inference(monkeypatch):
    calls = []
    torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: True, synchronize=lambda: calls.append("synchronize")),
        empty=lambda n, device: SimpleNamespace(zero_=lambda: calls.append((n, device))),
    )
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setattr(cuda_inference.runpy, "run_module", lambda *a, **k: calls.append("inference"))
    cuda_inference.main()
    assert calls == [(1, "cuda"), "synchronize", "inference"]


def test_cuda_guard_refuses_broken_context(monkeypatch):
    def broken_device(*args, **kwargs):
        raise RuntimeError("CUDA context lost")
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True), empty=broken_device))
    monkeypatch.setattr(cuda_inference.runpy, "run_module", lambda *a, **k: pytest.fail("inference must not run"))
    with pytest.raises(RuntimeError, match="context lost"):
        cuda_inference.main()


def test_required_cuda_uses_guarded_entrypoint(tmp_path):
    settings = replace(_settings(tmp_path), engine=EngineConfig(require_cuda=True))
    argv = OssDiffDockEngine(settings).build_argv(_request(), tmp_path / "p", tmp_path / "l", tmp_path / "out")
    assert argv[2] == "diffdock_service.cuda_inference"


def test_timeout_kills_preprocessing_children_and_returns_promptly(tmp_path):
    settings = replace(_settings(tmp_path), python_executable=sys.executable, engine=EngineConfig(inference_timeout_seconds=0.3))
    sentinel = tmp_path / "child-survived"
    child_script = f"import time; from pathlib import Path; time.sleep(1); Path({str(sentinel)!r}).touch()"
    (settings.repo_dir / "inference.py").write_text(
        f"import subprocess, sys, time\nsubprocess.Popen([sys.executable, '-c', {child_script!r}])\ntime.sleep(10)\n"
    )
    work = tmp_path / "job"
    work.mkdir()
    started = time.monotonic()
    with pytest.raises(DockFailure, match="exceeded"):
        OssDiffDockEngine(settings)._run(_request(), work)
    assert time.monotonic() - started < 2
    time.sleep(1.1)
    assert not sentinel.exists()
