import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health, processing, upload
from app.config import settings
from app.services import job_store

class PollingLogFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if "GET /api/v1/cad/jobs/" in msg:
            return False
        return True


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logging.getLogger("uvicorn.access").addFilter(PollingLogFilter())
logging.getLogger("ezdxf").setLevel(logging.WARNING)
log = logging.getLogger("cad.api")


async def _janitor() -> None:
    while True:
        try:
            n = await asyncio.to_thread(job_store.purge_expired)
            if n:
                log.info("purged %d expired job(s)", n)
        except Exception:
            log.exception("cleanup failed")
        await asyncio.sleep(settings.cleanup_interval_seconds)


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Ensure temp directory exists and purge expired sessions on startup
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    await asyncio.to_thread(job_store.purge_expired)
    task = asyncio.create_task(_janitor())
    yield
    task.cancel()


app = FastAPI(title="DWG CAD Layout Viewer", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    return JSONResponse({"detail": "Invalid request."}, status_code=422)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("unhandled error")  # never leak stack traces to the client
    return JSONResponse({"detail": "Unexpected server error."}, status_code=500)


for r in (health.router, upload.router, processing.router):
    app.include_router(r, prefix="/api/v1")
