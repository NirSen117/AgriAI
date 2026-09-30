from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "AgriAI API"
    environment: str = "development"
    mock_mode: bool = False
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    frontend_origin: str | None = None
    api_prefix: str = "/api"
    weather_api_key: str | None = None
    ai_api_key: str | None = None
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash"
    gemini_fallback_models: str = "gemini-3.5-flash-lite,gemini-3.5-flash,gemini-3.6-flash"
    firebase_project_id: str | None = None
    vertex_ai_project: str | None = None
    vertex_ai_location: str = "us-central1"
    vertex_ai_model: str = "gemini-3.5-flash"
    hf_token: str | None = None
    open_meteo_base_url: str = "https://api.open-meteo.com/v1/forecast"
    bhuvan_api_token: str | None = None
    # Bhuvan's AOI endpoint is published under lulc250k; the guessed 50K
    # endpoint path returns 404. The 50K layer remains available as public WMS.
    bhuvan_lulc_api_url: str = "https://bhuvan-app1.nrsc.gov.in/api/lulc250k/curl_lulc250k.php"
    bhuvan_lulc_year: str = "2015_16"
    http_timeout_seconds: float = 30.0
    database_path: str = "./data/agriai.db"
    ai_rate_limit_per_minute: int = 15
    max_request_bytes: int = 7 * 1024 * 1024

    # Keep names aligned with the documented deployment variables so providers
    # can be enabled without an additional translation layer.
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_prefix="",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        configured = self.frontend_origin or self.cors_origins
        return [origin.strip() for origin in configured.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
