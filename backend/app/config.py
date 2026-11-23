"""Runtime configuration (environment variables / .env)."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    temp_dir: Path = BASE_DIR / "temp"
    bitmap_dir: Path = BASE_DIR.parent / "Bitmaps"
    temp_file_ttl_minutes: int = 60
    max_upload_size_mb: int = 500
    processing_timeout_seconds: int = 900   # whole job
    converter_timeout_seconds: int = 600    # DWG -> DXF step
    max_concurrent_jobs: int = 2
    cleanup_interval_seconds: int = 60
    purge_raw_dwg: bool = False

    # Converters are tried in this order (see app.services.cad_converter).
    converter_order: str = "oda,libredwg"
    oda_converter_path: str = "ODAFileConverter"
    oda_output_version: str = "ACAD2018"
    libredwg_dwg2dxf_path: str = "dwg2dxf"

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024


settings = Settings()
