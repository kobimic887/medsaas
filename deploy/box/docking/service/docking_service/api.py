from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .engines.autodock_gpu import AutoDockGpuEngine
from .engines.registry import create_engine
from .errors import DockingError, InputError
from .metrics import DockingMetrics
from .models import DockingRequestBody, DockingResponse
from .normalization import normalize_request, parse_legacy_path
from .service import DockingService
from .settings import Settings

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    configured_settings = settings or Settings.from_environment()
    metrics = DockingMetrics()
    engine = create_engine(configured_settings.engine_name)
    service = DockingService.for_engine(configured_settings, engine, metrics)

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.metrics = metrics
    app.state.service = service

    @app.exception_handler(DockingError)
    async def handle_docking_error(_: Request, exc: DockingError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc)})

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": str(exc.detail)})

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        del exc
        return JSONResponse(status_code=400, content={"error": "invalid docking request"})

    @app.exception_handler(Exception)
    async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unexpected docking service failure", exc_info=exc)
        return JSONResponse(status_code=502, content={"error": "docking service failed"})

    @app.get("/health")
    def health() -> dict[str, str]:
        if isinstance(engine, AutoDockGpuEngine):
            engine.require_qualified()
        return {"status": "ok"}

    @app.post("/docking", response_model=DockingResponse)
    def post_docking(body: DockingRequestBody) -> DockingResponse:
        request = normalize_request(
            pdbid=body.pdbid,
            smiles=body.smiles,
            metrics=metrics,
        )
        result = service.dock(request)
        return DockingResponse(pdb=result.pdb, sdf=result.sdf)

    @app.get("/docking/{legacy:path}", response_model=DockingResponse)
    def get_docking(request: Request, legacy: str) -> DockingResponse:
        del legacy
        raw_path = request.scope.get("raw_path")
        if not isinstance(raw_path, bytes):
            raise InputError("legacy docking path is unavailable without raw path support")
        pdbid, smiles = parse_legacy_path(raw_path)
        normalized = normalize_request(
            pdbid=pdbid,
            smiles=smiles,
            metrics=metrics,
            already_decoded=True,
        )
        result = service.dock(normalized)
        return DockingResponse(pdb=result.pdb, sdf=result.sdf)

    return app
