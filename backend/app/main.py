from datetime import datetime, timezone
from collections import defaultdict, deque
import json
import logging
import sqlite3
from pathlib import Path
from time import monotonic
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .advisory import build_advisory, localize_advisory
from .config import get_settings
from .providers import (
    CopernicusSatelliteProvider, GeminiAIProvider, GeminiDiseaseProvider, VertexAIProvider,
    MockAIProvider, MockDiseaseProvider, MockSatelliteProvider, MockSoilProvider, MockWeatherProvider,
    OpenMeteoSoilProvider, OpenMeteoWeatherProvider,
)
from .schemas import (AdvisoryItem, AdvisoryResponse, AskRequest, AskResponse, DashboardResponse, DiagnosisRequest,
                      DiagnosisResponse, FarmProfile, HealthResponse, OnboardingResponse, PermissionResponse,
                      Location, ProviderStatus, SystemStatus)

settings = get_settings()
logger = logging.getLogger(__name__)
app = FastAPI(title=settings.app_name, version="1.0.0", description="Provider-agnostic agricultural decision support API")
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"])

_ai_requests: dict[str, deque[float]] = defaultdict(deque)


def _gemini_failure_message(exc: Exception) -> str:
    status = exc.code if isinstance(exc, HTTPError) else None
    if status in (401, 403):
        return "Gemini rejected the API key or project access. Check GEMINI_API_KEY and enable the Gemini API for its Google project."
    if status == 404:
        return f"Gemini model '{settings.gemini_model}' was not found or is unavailable to this project."
    if status == 429:
        return "Gemini rate limit or free-tier quota reached. Wait for quota to reset, then try again."
    if status == 400:
        return "Gemini rejected the API key or request (HTTP 400). Check the key, model, image format, and request size."
    if isinstance(exc, URLError):
        return "The backend cannot connect to Gemini. Check Docker's internet access and try again."
    return "Gemini request failed. Check the backend logs for the error details."


def _log_gemini_failure(operation: str, exc: Exception) -> None:
    status = exc.code if isinstance(exc, HTTPError) else "none"
    logger.error("Gemini %s failed (exception=%s, http_status=%s)", operation, type(exc).__name__, status, exc_info=True)


@app.middleware("http")
async def api_security(request, call_next):
    def secure(response):
        if request.url.path.startswith("/api/"):
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(self)"
            response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
            if request.url.scheme == "https":
                response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > settings.max_request_bytes:
        return secure(JSONResponse(status_code=413, content={"detail": "Request body is too large."}))
    if request.url.path in {"/api/ai/ask", "/api/disease/analyze", "/api/diagnosis"}:
        ip = request.client.host if request.client else "unknown"
        requests = _ai_requests[ip]
        now = monotonic()
        while requests and now - requests[0] >= 60:
            requests.popleft()
        if len(requests) >= settings.ai_rate_limit_per_minute:
            return secure(JSONResponse(status_code=429, content={"detail": "AI request limit reached. Please wait and try again."}))
        requests.append(now)
    return secure(await call_next(request))

weather = MockWeatherProvider() if settings.mock_mode else OpenMeteoWeatherProvider(
    settings.open_meteo_base_url, settings.http_timeout_seconds
)
soil = MockSoilProvider() if settings.mock_mode else OpenMeteoSoilProvider(
    settings.open_meteo_base_url, settings.http_timeout_seconds
)
copernicus_configured = bool(settings.copernicus_client_id and settings.copernicus_client_secret)
satellite = CopernicusSatelliteProvider(settings.copernicus_client_id, settings.copernicus_client_secret,
                                       settings.http_timeout_seconds) if copernicus_configured else MockSatelliteProvider()
if settings.vertex_ai_project:
    try:
        ai = VertexAIProvider(settings.vertex_ai_project, settings.vertex_ai_location, settings.vertex_ai_model)
    except Exception:
        logger.exception("Vertex AI initialization failed; using mock AI fallback")
        ai = MockAIProvider()
elif settings.gemini_api_key:
    ai = GeminiAIProvider(settings.gemini_api_key, settings.gemini_model, settings.http_timeout_seconds)
else:
    ai = MockAIProvider()
disease = GeminiDiseaseProvider(settings.gemini_api_key, settings.gemini_model, settings.http_timeout_seconds) if settings.gemini_api_key else MockDiseaseProvider()
def _connect() -> sqlite3.Connection:
    path = Path(settings.database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE IF NOT EXISTS farm_profile (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL, updated_at TEXT NOT NULL)")
    connection.commit()
    return connection


def _load_profile() -> FarmProfile | None:
    with _connect() as connection:
        row = connection.execute("SELECT payload FROM farm_profile WHERE id = 1").fetchone()
    return FarmProfile.model_validate_json(row[0]) if row else None


profile: FarmProfile | None = _load_profile()


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(service=settings.app_name, timestamp=datetime.now(timezone.utc))


@app.get("/api/system/status", response_model=SystemStatus, tags=["system"])
def status() -> SystemStatus:
    providers = [
        ProviderStatus(name="weather", available=True, mode="mock" if settings.mock_mode else "live",
                       message="Deterministic mock provider active" if settings.mock_mode else "Open-Meteo public forecast API"),
        ProviderStatus(name="soil", available=True, mode="mock" if settings.mock_mode else "live",
                       message="Deterministic mock provider active" if settings.mock_mode else "Open-Meteo modelled soil moisture (surface layers; not a sensor)"),
        ProviderStatus(name="satellite", available=True,
                       mode="live" if copernicus_configured else "mock",
                       message="Copernicus Sentinel-2 NDVI near farm pin" if copernicus_configured else "Copernicus credentials not configured; demo field-health values active"),
        ProviderStatus(name="ai", available=True,
                       mode="live" if isinstance(ai, (GeminiAIProvider, VertexAIProvider)) else "mock",
                       message="Vertex AI Gemini configured; mock fallback activates on failure" if isinstance(ai, VertexAIProvider) else f"Gemini key configured for {settings.gemini_model}; mock fallback activates on failure" if isinstance(ai, GeminiAIProvider) else "Mock AI fallback active; no live AI provider is configured"),
        ProviderStatus(name="disease", available=True,
                       mode="live" if isinstance(disease, GeminiDiseaseProvider) else "mock",
                       message="Gemini key configured; mock fallback activates on failure" if isinstance(disease, GeminiDiseaseProvider) else "Mock disease fallback active; no Gemini key is configured"),
    ]
    return SystemStatus(status="ok", mock_mode=settings.mock_mode, providers=providers)


@app.get("/api/status", response_model=SystemStatus, include_in_schema=False)
def status_alias() -> SystemStatus:
    return status()


@app.post("/api/onboarding", response_model=OnboardingResponse, tags=["farm"])
def onboarding(payload: FarmProfile) -> OnboardingResponse:
    global profile
    profile = payload
    with _connect() as connection:
        connection.execute("INSERT INTO farm_profile (id, payload, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at", (payload.model_dump_json(), datetime.now(timezone.utc).isoformat()))
    return OnboardingResponse(saved=True, profile=payload, message="Farm profile saved.")


@app.get("/api/farm", response_model=FarmProfile | None, tags=["farm"])
def get_farm() -> FarmProfile | None:
    return profile


@app.get("/api/geocode", tags=["farm"])
def geocode(q: str = Query(min_length=2, max_length=120)) -> dict:
    """Look up a place with Open-Meteo; manual coordinates remain available offline."""
    from urllib.parse import urlencode
    from urllib.request import urlopen
    try:
        url = "https://geocoding-api.open-meteo.com/v1/search?" + urlencode({"name": q, "count": 5, "language": "en", "format": "json"})
        with urlopen(url, timeout=settings.http_timeout_seconds) as response:
            payload = json.load(response)
        return {"results": [{"name": r.get("name", ""), "admin1": r.get("admin1", ""), "country": r.get("country", ""), "latitude": r["latitude"], "longitude": r["longitude"]} for r in payload.get("results", [])]}
    except Exception:
        return {"results": [], "unavailable": True}


def _location() -> Location:
    # A neutral India-centre coordinate is used only for provider calls before
    # onboarding. It is never returned as a farmer's saved location.
    return profile.location if profile else Location(latitude=20.5937, longitude=78.9629)


@app.get("/api/dashboard", response_model=DashboardResponse, tags=["farm"])
def dashboard() -> DashboardResponse:
    location = _location()
    try:
        weather_observation = weather.get_weather(location)
    except Exception:
        weather_observation = MockWeatherProvider().get_weather(location)
    try:
        soil_observation = soil.get_soil(location)
    except Exception:
        soil_observation = MockSoilProvider().get_soil(location)
    try:
        satellite_observation = satellite.get_observation(location)
    except Exception:
        satellite_observation = MockSatelliteProvider().get_observation(location)
    live_providers = sum(source in {"open-meteo", "open-meteo-modelled", "copernicus-sentinel-2-near-location"}
                         for source in (weather_observation.source, soil_observation.source, satellite_observation.source))
    data_quality = "live" if live_providers == 3 else "mixed" if live_providers else "mock"
    return DashboardResponse(profile=profile, weather=weather_observation, soil=soil_observation,
                             satellite=satellite_observation, data_quality=data_quality)


@app.get("/api/advisory", response_model=AdvisoryResponse, tags=["farm"])
def advisory() -> AdvisoryResponse:
    location = _location()
    try:
        weather_observation = weather.get_weather(location)
    except Exception:
        weather_observation = MockWeatherProvider().get_weather(location)
    try:
        soil_observation = soil.get_soil(location)
    except Exception:
        soil_observation = MockSoilProvider().get_soil(location)
    result = build_advisory(weather_observation, soil_observation)
    if profile and profile.farm_type in {"livestock", "mixed"}:
        groups = ", ".join(f"{group.count} {group.species}" for group in profile.livestock)
        animal_action = AdvisoryItem(
            priority="medium", title="Check water and shade",
            action="Keep clean drinking water available and check that animals have a shaded resting area.",
            reason=f"Livestock in the profile: {groups}.",
        )
        if profile.farm_type == "livestock":
            result = result.model_copy(update={
                "summary": "Routine livestock care reminder based on your farm profile.",
                "items": [animal_action],
            })
        else:
            result = result.model_copy(update={"items": [*result.items, animal_action]})
    lang = profile.preferred_language if profile else "en"
    result = localize_advisory(result, lang)
    if isinstance(ai, GeminiAIProvider) and lang not in (None, "en"):
        try:
            result = ai.translate_advisory(result, lang)
        except Exception:
            pass  # use the built-in reviewed strings for deterministic recommendations
    return result


@app.post("/api/ai/ask", response_model=AskResponse, tags=["ai"])
def ask(payload: AskRequest) -> AskResponse:
    selected_crop = payload.crop or (profile.crops[0] if profile and profile.crops else None)
    context: dict = {}
    if profile:
        context["farm"] = profile.model_dump(mode="json")
        try:
            location = profile.location
            context["weather"] = weather.get_weather(location).model_dump(mode="json")
        except Exception:
            context["weather"] = {"status": "unavailable"}
        try:
            context["soil"] = soil.get_soil(profile.location).model_dump(mode="json")
        except Exception:
            context["soil"] = {"status": "unavailable"}
        try:
            context["field_health"] = satellite.get_observation(profile.location).model_dump(mode="json")
        except Exception:
            context["field_health"] = {"status": "unavailable"}
    try:
        answer = ai.answer(payload.question, selected_crop, context)
        source = "vertex-ai" if isinstance(ai, VertexAIProvider) else "gemini" if isinstance(ai, GeminiAIProvider) else "mock"
    except Exception as exc:
        _log_gemini_failure("text generation", exc)
        answer = MockAIProvider().answer(payload.question, selected_crop, context)
        source = "mock-fallback"
    return AskResponse(answer=answer, source=source)


@app.post("/api/disease/analyze", response_model=DiagnosisResponse, tags=["ai"])
def analyze(payload: DiagnosisRequest) -> DiagnosisResponse:
    if not payload.image_url and not payload.symptoms:
        raise HTTPException(status_code=422, detail="Provide image_url or symptoms to analyze.")
    language = profile.preferred_language if profile else "en"
    try:
        return disease.diagnose(payload, language)
    except Exception as exc:
        _log_gemini_failure("crop image diagnosis", exc)
        return MockDiseaseProvider().diagnose(payload, language).model_copy(update={"source": "mock-fallback"})


@app.post("/api/diagnosis", response_model=DiagnosisResponse, include_in_schema=False)
def diagnosis_alias(payload: DiagnosisRequest) -> DiagnosisResponse:
    return analyze(payload)


@app.get("/api/permissions", response_model=PermissionResponse, tags=["system"])
def permissions() -> PermissionResponse:
    return PermissionResponse(explanation="Permissions are optional; location and camera are requested only after user action.")


@app.get("/api/demo", response_model=DashboardResponse, tags=["system"])
def demo() -> DashboardResponse:
    return dashboard()
