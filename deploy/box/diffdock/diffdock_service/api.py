from __future__ import annotations

import logging

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
    def generate(body: GenerateRequest) -> GenerateResponse:
        return service.generate(body)

    return app
