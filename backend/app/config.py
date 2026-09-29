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
    gemini_model: str = "gemini-2.5-flash"
    vertex_ai_project: str | None = None
    vertex_ai_location: str = "us-central1"
    vertex_ai_model: str = "gemini-2.5-flash"
    copernicus_client_id: str | None = None
    copernicus_client_secret: str | None = None
    hf_token: str | None = None
    open_meteo_base_url: str = "https://api.open-meteo.com/v1/forecast"
    http_timeout_seconds: float = 8.0
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
