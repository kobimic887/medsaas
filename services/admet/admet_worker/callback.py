"""Writing a finished prediction back to the platform.

The route already exists and is already authenticated:

    PUT /api/simulation/{simulationKey}/admet     header: x-admet-secret

⚠ The header name is `x-admet-secret` and the server reads `ADMET_CALLBACK_SECRET`
(server/index.js:1700). deploy/box/compose.yml used to pass `ADMET_CALLBACK_TOKEN`, which
this worker would have sent as nothing at all — a 401 on every completed job, after the GPU
work was already done. Both are now `ADMET_CALLBACK_SECRET`.
"""

from __future__ import annotations

import logging

import requests

logger = logging.getLogger(__name__)


class CallbackError(RuntimeError):
    pass


class PlatformCallback:
    def __init__(self, base_url: str, secret: str, *, timeout: float = 30.0):
        if not base_url:
            raise ValueError("ADMET_CALLBACK_URL is required")
        if not secret:
            # Failing here rather than at the first completed job means a misconfigured
            # worker never claims work it cannot deliver.
            raise ValueError("ADMET_CALLBACK_SECRET is required")
        self._base_url = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout

    def url_for(self, simulation_key: str) -> str:
        return f"{self._base_url}/api/simulation/{simulation_key}/admet"

    def send(self, simulation_key: str, admet: dict) -> None:
        url = self.url_for(simulation_key)
        try:
            response = requests.put(
                url,
                json={"admet": admet},
                headers={
                    "Content-Type": "application/json",
                    "x-admet-secret": self._secret,
                },
                timeout=self._timeout,
            )
        except requests.RequestException as exc:
            raise CallbackError(f"callback to {url} failed: {exc}") from exc

        if response.status_code != 200:
            body = (response.text or "")[:300]
            raise CallbackError(f"callback returned {response.status_code}: {body}")

        logger.info("delivered ADMET result for %s", simulation_key)
