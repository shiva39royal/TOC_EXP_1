from fastapi import APIRouter

from app.services.cad_converter import available_converters

router = APIRouter()


@router.get("/health")
def health():
    conv = [c.name for c in available_converters()]
    return {"status": "ok" if conv else "degraded", "converters": conv}
