"""FastAPI app factory: config, health check, security headers, routers, SPA serving."""

from __future__ import annotations

import logging
import platform
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from sqlalchemy import text
from starlette.datastructures import MutableHeaders

from medvault import __version__, auth
from medvault.config import DEFAULT_SECRET_KEY, Settings, get_settings
from medvault.db import init_db, make_engine
from medvault.seed import seed_if_empty

log = logging.getLogger("medvault")

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)
NOT_BUILT_HTML = (
    "<!doctype html><title>MedVault</title><body style='font-family:system-ui;padding:2rem'>"
    "<h1>MedVault API is running</h1><p>The frontend is not built yet. Run <code>make build</code>"
    " (or <code>make dev</code> for the Vite dev server on port 5173).</p>"
    "<p>Health: <a href='/api/health'>/api/health</a> · Docs: <a href='/api/docs'>/api/docs</a></p>"
)


class SecurityHeadersMiddleware:
    """Pure ASGI (not BaseHTTPMiddleware) so later SSE streams (VLT-9) are not buffered."""

    def __init__(self, app) -> None:  # noqa: ANN001
        self.app = app

    async def __call__(self, scope, receive, send) -> None:  # noqa: ANN001
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope["path"]
        forwarded_https = (b"x-forwarded-proto", b"https") in scope["headers"]
        https = scope.get("scheme") == "https" or forwarded_https

        async def send_with_headers(message) -> None:  # noqa: ANN001
            if message["type"] == "http.response.start":
                h = MutableHeaders(scope=message)
                h.setdefault("X-Content-Type-Options", "nosniff")
                h.setdefault("X-Frame-Options", "DENY")
                h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
                h.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
                if path.startswith("/api/"):
                    h.setdefault("Cache-Control", "no-store")
                elif path.startswith("/assets/"):
                    h.setdefault("Cache-Control", "public, max-age=31536000, immutable")
                else:
                    h.setdefault("Content-Security-Policy", CSP)
                if https:
                    h.setdefault("Strict-Transport-Security", "max-age=31536000")
            await send(message)

        await self.app(scope, receive, send_with_headers)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(
        level=settings.log_level.upper(), format="%(levelname)s %(name)s: %(message)s"
    )
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.is_prod and settings.secret_key == DEFAULT_SECRET_KEY:
            raise RuntimeError("MEDVAULT_SECRET_KEY must be set when MEDVAULT_ENV=prod")
        init_db(engine)
        if settings.auto_seed and seed_if_empty(engine):
            log.info("Empty database: loaded the demo seed")
        app.state.started_at = time.time()
        yield
        engine.dispose()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        lifespan=lifespan,
        docs_url=None if settings.is_prod else "/api/docs",
        redoc_url=None,
        openapi_url=None if settings.is_prod else "/api/openapi.json",
    )
    app.state.settings = settings
    app.state.engine = engine

    # add_middleware wraps outermost-last: CORS innermost, security headers outermost.
    if settings.cors_origins and not settings.is_prod:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/api/health", tags=["ops"])
    def health(request: Request) -> JSONResponse:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            db_ok = True
        except Exception:  # noqa: BLE001
            log.exception("health: database check failed")
            db_ok = False
        started = getattr(request.app.state, "started_at", time.time())
        body = {
            "status": "ok" if db_ok else "degraded",
            "app": settings.app_name,
            "version": __version__,
            "env": settings.env,
            "demo_mode": settings.demo_mode,
            "db_ok": db_ok,
            "uptime_s": round(time.time() - started, 1),
            "platform": {  # "s390x" on LinuxONE: the FND-6 smoke test records this
                "machine": platform.machine(),
                "system": platform.system(),
                "python": platform.python_version(),
                "hostname": platform.node(),
            },
        }
        return JSONResponse(body, status_code=200 if db_ok else 503)

    app.include_router(auth.router)
    mount_spa(app, settings.static_path)
    return app


def mount_spa(app: FastAPI, static_dir: Path) -> None:
    """Serve the built frontend; unknown non-API paths fall back to index.html (client routing)."""
    root = static_dir.resolve()
    index = root / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):  # noqa: ANN202
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not found")
        if not index.is_file():
            return HTMLResponse(NOT_BUILT_HTML, status_code=503)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


app = create_app()
