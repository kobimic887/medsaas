from __future__ import annotations

import logging
import re
from threading import Lock
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .engines.registry import create_engine
from .errors import DiffDockError, EngineUnavailable
from .models import GenerateRequest, GenerateResponse
from .service import DiffDockService
from .settings import Settings

logger = logging.getLogger(__name__)

# The path is upstream's, unchanged, so the cutover is one environment variable:
#   DIFFDOCK_API_URL=https://services.asinex.com:58000/molecular-docking/diffdock/generate
#   DIFFDOCK_API_URL=https://<box>/molecular-docking/diffdock/generate
GENERATE_PATH = "/molecular-docking/diffdock/generate"


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or Settings.from_environment()
    engine = create_engine(configured)
    service = DiffDockService(configured, engine)

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = service
    app.state.settings = configured
    inference_slot = Lock()

    @app.middleware("http")
    async def log_request(request: Request, call_next):
        supplied_id = request.headers.get("X-Pyxis-Request-Id", "")
        request.state.request_id = supplied_id if re.fullmatch(r"[A-Za-z0-9_-]{1,64}", supplied_id) else uuid4().hex
        started = time.monotonic()
        logger.info("request started: id=%s method=%s", request.state.request_id, request.method)
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("request failed: id=%s elapsed=%.3f", request.state.request_id, time.monotonic() - started)
            raise
        response.headers["X-Pyxis-Request-Id"] = request.state.request_id
        logger.info("request completed: id=%s status=%d elapsed=%.3f", request.state.request_id, response.status_code, time.monotonic() - started)
        return response

    @app.exception_handler(DiffDockError)
    async def handle_diffdock_error(_: Request, exc: DiffDockError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc)})

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        del exc
        return JSONResponse(status_code=400, content={"error": "invalid DiffDock request"})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unexpected DiffDock failure", exc_info=exc)
        return JSONResponse(status_code=502, content={"error": "DiffDock service failed"})

    @app.get("/health")
    def health() -> dict[str, str]:
        # An engine that cannot serve must fail its healthcheck rather than accept work and
        # answer `status: "failed"` — that shape means "the chemistry did not work", and a
        # missing weights directory is not that.
        try:
            engine.preflight()
        except EngineUnavailable:
            raise
        return {"status": "ok", "engine": engine.name}

    @app.post(GENERATE_PATH, response_model=GenerateResponse)
    def generate(body: GenerateRequest, request: Request):
        # One model subprocess per service. An unbounded thread-pool queue would
        # consume the application's deadline before inference even starts.
        if not inference_slot.acquire(blocking=False):
            return JSONResponse(status_code=503, headers={"Retry-After": "10"}, content={
                "code": "DIFFDOCK_BUSY", "error": "DiffDock is processing another request. Please try again shortly."
            })
        try:
            logger.info("inference admitted: id=%s poses=%d", request.state.request_id, body.num_poses)
            result = service.generate(body)
            logger.info("inference completed: id=%s status=%s poses=%d", request.state.request_id, result.status, sum(bool(pose.strip()) for pose in result.ligand_positions))
            return result
        finally:
            inference_slot.release()

    return app
