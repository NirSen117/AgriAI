from datetime import datetime, timezone
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from http.client import RemoteDisconnected
import json
import logging
import sqlite3
import re
from threading import Lock
from pathlib import Path
from time import monotonic, time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .advisory import build_advisory, localize_advisory
from .config import get_settings
from .providers import (
    GeminiAIProvider, GeminiDiseaseProvider, VertexAIProvider,
    BhuvanLulcProvider, MockAIProvider, MockDiseaseProvider, MockSatelliteProvider, MockSoilProvider, MockWeatherProvider,
    OpenMeteoSoilProvider, OpenMeteoWeatherProvider,
)
from .schemas import (AdvisoryItem, AdvisoryResponse, AskRequest, AskResponse, DashboardResponse, DiagnosisRequest,
                      DiagnosisResponse, FarmProfile, HealthResponse, OnboardingResponse, PermissionResponse,
                      Location, ProviderStatus, SatelliteObservation, SystemStatus)

settings = get_settings()
logger = logging.getLogger(__name__)
app = FastAPI(title=settings.app_name, version="1.0.0", description="Provider-agnostic agricultural decision support API")
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"])

_ai_requests: dict[str, deque[float]] = defaultdict(deque)
_firebase_certificates: dict[str, str] = {}
_firebase_certificates_expires_at = 0.0
_firebase_certificates_lock = Lock()
_satellite_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="bhuvan-lulc")
_satellite_lock = Lock()
_satellite_cache: dict[tuple[float, float], tuple[float, SatelliteObservation]] = {}
_satellite_in_flight: set[tuple[float, float]] = set()


def _get_firebase_signing_certificates() -> dict[str, str]:
    global _firebase_certificates, _firebase_certificates_expires_at
    if _firebase_certificates and monotonic() < _firebase_certificates_expires_at:
        return _firebase_certificates
    with _firebase_certificates_lock:
        if _firebase_certificates and monotonic() < _firebase_certificates_expires_at:
            return _firebase_certificates
        request = Request(
            "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
            headers={"Accept": "application/json"},
        )
        with urlopen(request, timeout=settings.http_timeout_seconds) as response:
            certificates = json.load(response)
            cache_control = response.headers.get("Cache-Control", "")
        if not isinstance(certificates, dict) or not certificates:
            raise ValueError("Firebase returned no signing certificates")
        max_age = re.search(r"max-age=(\d+)", cache_control)
        cache_seconds = int(max_age.group(1)) if max_age else 3600
        _firebase_certificates = certificates
        _firebase_certificates_expires_at = monotonic() + max(60, cache_seconds)
        return _firebase_certificates


def require_firebase_user(authorization: str | None = Header(default=None)) -> str:
    """Validate a Firebase ID token and return its stable Firebase UID."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in to access your farm data.",
                            headers={"WWW-Authenticate": "Bearer"})
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid sign-in token.",
                            headers={"WWW-Authenticate": "Bearer"})
    if not settings.firebase_project_id:
        logger.error("Firebase token verification is not configured: FIREBASE_PROJECT_ID is empty")
        raise HTTPException(status_code=503, detail="Firebase authentication is not configured on the backend.")

    try:
        import jwt
        from cryptography import x509

        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")
        certificates = _get_firebase_signing_certificates()
        certificate = certificates.get(key_id) if isinstance(key_id, str) else None
        if not certificate:
            raise jwt.InvalidTokenError("Firebase signing key is unknown")
        public_key = x509.load_pem_x509_certificate(certificate.encode("utf-8")).public_key()
        decoded = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            audience=settings.firebase_project_id,
            issuer=f"https://securetoken.google.com/{settings.firebase_project_id}",
            options={"require": ["exp", "iat", "auth_time", "sub"]},
        )
        user_id = decoded.get("sub")
        auth_time = decoded.get("auth_time")
        if isinstance(auth_time, bool) or not isinstance(auth_time, (int, float)) or auth_time > time():
            raise jwt.InvalidTokenError("Firebase token has an invalid authentication time")
        if not isinstance(user_id, str) or not user_id:
            raise jwt.InvalidTokenError("Firebase token has no UID")
        return user_id
    except HTTPException:
        raise
    except (HTTPError, URLError, TimeoutError):
        logger.exception("Unable to fetch Firebase token-signing certificates")
        raise HTTPException(status_code=503, detail="Could not verify sign-in right now. Please retry.")
    except Exception as exc:
        try:
            import jwt
            invalid_token = isinstance(exc, (jwt.InvalidTokenError, ValueError, KeyError))
        except ImportError:
            invalid_token = isinstance(exc, (ValueError, KeyError))
        if invalid_token:
            raise HTTPException(status_code=401, detail="Your sign-in session is invalid or expired. Sign in again.",
                                headers={"WWW-Authenticate": "Bearer"}) from exc
        logger.exception("Firebase ID-token verification failed")
        raise HTTPException(status_code=503, detail="Could not verify your sign-in with Firebase. Please retry.") from exc


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
    if status == 503:
        return "Gemini is temporarily unavailable (HTTP 503). Your request reached Google, but its service could not process it. Please try again shortly."
    if status in (500, 502, 504):
        return f"Gemini returned a temporary server error (HTTP {status}). Please try again shortly."
    if status == 408:
        return "Gemini timed out while processing the request (HTTP 408). Please try again shortly."
    if isinstance(exc, URLError):
        return "The backend cannot connect to Gemini. Check Docker's internet access and try again."
    if isinstance(exc, TimeoutError):
        return "Gemini took too long to respond. Try again; if it repeats, check Docker's internet connection."
    return "Gemini request failed. Check the backend logs for the error details."


def _log_gemini_failure(operation: str, exc: Exception) -> None:
    status = exc.code if isinstance(exc, HTTPError) else "none"
    if isinstance(exc, HTTPError):
        # Google includes the violated quota/rate metric and retry guidance in
        # the error body. Log only those fields; never log request headers or
        # the API key.
        try:
            payload = json.loads(exc.read(8192).decode("utf-8", errors="replace"))
            error = payload.get("error", {}) if isinstance(payload, dict) else {}
            message = error.get("message", "") if isinstance(error, dict) else ""
            reason = error.get("status", "") if isinstance(error, dict) else ""
            retry_after = exc.headers.get("Retry-After") if exc.headers else None
        except Exception:
            message, reason, retry_after = "", "", None
        logger.warning(
            "Gemini %s failed (exception=%s, http_status=%s, google_status=%s, retry_after=%s, message=%s)",
            operation, type(exc).__name__, status, reason or "unknown", retry_after or "unknown",
            message[:500] or "no provider message",
        )
    else:
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
satellite = MockSatelliteProvider() if settings.mock_mode else (
    BhuvanLulcProvider(settings.bhuvan_api_token, settings.bhuvan_lulc_api_url,
                       settings.bhuvan_lulc_year, settings.http_timeout_seconds)
    if settings.bhuvan_api_token else None
)
ai_fallback: GeminiAIProvider | None = (
    GeminiAIProvider(settings.gemini_api_key, settings.gemini_model, settings.http_timeout_seconds,
                    settings.gemini_fallback_models.split(","))
    if settings.gemini_api_key else None
)
if settings.vertex_ai_project:
    try:
        ai = VertexAIProvider(settings.vertex_ai_project, settings.vertex_ai_location, settings.vertex_ai_model)
    except Exception:
        logger.exception("Vertex AI initialization failed; falling back to Gemini API")
        ai = ai_fallback
else:
    ai = ai_fallback
disease = GeminiDiseaseProvider(settings.gemini_api_key, settings.gemini_model, settings.http_timeout_seconds,
                                settings.gemini_fallback_models.split(",")) if settings.gemini_api_key else None
def _connect() -> sqlite3.Connection:
    path = Path(settings.database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE IF NOT EXISTS farm_profiles (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)")
    connection.commit()
    return connection


def _load_profile(user_id: str) -> FarmProfile | None:
    with _connect() as connection:
        row = connection.execute("SELECT payload FROM farm_profiles WHERE user_id = ?", (user_id,)).fetchone()
    return FarmProfile.model_validate_json(row[0]) if row else None

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
        ProviderStatus(name="satellite", available=settings.mock_mode or satellite is not None,
                       mode="mock" if settings.mock_mode else "live" if satellite else "fallback",
                       message=("Demo satellite values active" if settings.mock_mode else
                                "Bhuvan LULC AOI statistics configured; results are historical land-cover context" if satellite else
                                "Bhuvan API token missing; add BHUVAN_API_TOKEN; public Bhuvan WMS map remains available")),
        ProviderStatus(name="ai", available=isinstance(ai, (GeminiAIProvider, VertexAIProvider)),
                       mode="live" if isinstance(ai, (GeminiAIProvider, VertexAIProvider)) else "fallback",
                       message=("Vertex AI configured with Gemini API fallback; access is checked when an AI action runs" if isinstance(ai, VertexAIProvider) and ai_fallback else
                                "Vertex AI configured; access is checked when an AI action runs" if isinstance(ai, VertexAIProvider) else
                                f"Gemini key configured for {settings.gemini_model}; access is checked when an AI action runs" if isinstance(ai, GeminiAIProvider) else
                                "Gemini unavailable: no live AI provider is configured")),
        ProviderStatus(name="disease", available=isinstance(disease, GeminiDiseaseProvider),
                       mode="live" if isinstance(disease, GeminiDiseaseProvider) else "fallback",
                       message="Gemini key configured; access is checked when image diagnosis runs" if isinstance(disease, GeminiDiseaseProvider) else "Gemini unavailable: no API key is configured"),
    ]
    return SystemStatus(status="ok", mock_mode=settings.mock_mode, providers=providers)


@app.get("/api/status", response_model=SystemStatus, include_in_schema=False)
def status_alias() -> SystemStatus:
    return status()


@app.post("/api/onboarding", response_model=OnboardingResponse, tags=["farm"])
def onboarding(payload: FarmProfile, user_id: str = Depends(require_firebase_user)) -> OnboardingResponse:
    with _connect() as connection:
        connection.execute("INSERT INTO farm_profiles (user_id, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at", (user_id, payload.model_dump_json(), datetime.now(timezone.utc).isoformat()))
    return OnboardingResponse(saved=True, profile=payload, message="Farm profile saved.")


@app.get("/api/farm", response_model=FarmProfile | None, tags=["farm"])
def get_farm(user_id: str = Depends(require_firebase_user)) -> FarmProfile | None:
    return _load_profile(user_id)


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


def _location(profile: FarmProfile | None) -> Location:
    # A neutral India-centre coordinate is used only for provider calls before
    # onboarding. It is never returned as a farmer's saved location.
    return profile.location if profile else Location(latitude=20.5937, longitude=78.9629)


def _satellite_unavailable_message(exc: Exception) -> str:
    if isinstance(exc, HTTPError):
        if exc.code in (401, 403):
            return "Bhuvan rejected the API token (HTTP 401/403). Copy the current daily token into BHUVAN_API_TOKEN and recreate the backend container."
        if exc.code == 404:
            return "Bhuvan API endpoint was not found (HTTP 404). Check BHUVAN_LULC_API_URL."
        if exc.code == 414:
            return "Bhuvan rejected the AOI URL as too long (HTTP 414)."
        return f"Bhuvan API request failed with HTTP {exc.code}. Check the API endpoint and token."
    if isinstance(exc, ValueError):
        return f"Bhuvan response could not be read: {exc}"
    if isinstance(exc, TimeoutError):
        return "The Bhuvan LULC request timed out. The app will retry automatically after a short wait."
    if isinstance(exc, RemoteDisconnected):
        return "Bhuvan closed the hosted server connection. The app will retry automatically; the map layer may still be available."
    if isinstance(exc, URLError):
        return "The hosted server could not connect to Bhuvan. The app will retry automatically after a short wait."
    return f"Bhuvan API request failed ({type(exc).__name__}). Check backend logs."


def _request_satellite_observation(location: Location) -> SatelliteObservation:
    """Return cached Bhuvan data immediately while refreshing slow calls in the background."""
    if not satellite or not isinstance(satellite, BhuvanLulcProvider):
        return SatelliteObservation(source="unavailable", crop_health="unavailable",
                                    availability_message="Bhuvan API token is not configured in the backend environment.",
                                    observed_at=datetime.now(timezone.utc))

    key = (round(location.latitude, 5), round(location.longitude, 5))
    now = monotonic()
    with _satellite_lock:
        cached = _satellite_cache.get(key)
        if cached and now < cached[0]:
            return cached[1]
        if key not in _satellite_in_flight:
            _satellite_in_flight.add(key)

            def fetch() -> None:
                result: SatelliteObservation | None = None
                cache_seconds = 120
                try:
                    result = satellite.get_observation(location)
                    cache_seconds = 12 * 60 * 60
                except Exception as exc:
                    message = _satellite_unavailable_message(exc)
                    status_code = exc.code if isinstance(exc, HTTPError) else "n/a"
                    logger.warning("Bhuvan LULC request failed (exception=%s, http_status=%s, reason=%s)",
                                   type(exc).__name__, status_code, message)
                    result = SatelliteObservation(source="unavailable", crop_health="unavailable",
                                                 availability_message=message,
                                                 observed_at=datetime.now(timezone.utc))
                    cache_seconds = 30
                finally:
                    with _satellite_lock:
                        _satellite_in_flight.discard(key)
                        if result is not None:
                            _satellite_cache[key] = (monotonic() + cache_seconds, result)

            _satellite_executor.submit(fetch)

    return SatelliteObservation(source="unavailable", crop_health="unavailable",
                                availability_message="Bhuvan is loading your land-cover data. Please wait a few seconds; this dashboard will refresh automatically.",
                                observed_at=datetime.now(timezone.utc))


@app.get("/api/dashboard", response_model=DashboardResponse, tags=["farm"])
def dashboard(user_id: str = Depends(require_firebase_user)) -> DashboardResponse:
    profile = _load_profile(user_id)
    location = _location(profile)
    try:
        weather_observation = weather.get_weather(location)
    except Exception:
        weather_observation = MockWeatherProvider().get_weather(location)
    try:
        soil_observation = soil.get_soil(location)
    except Exception:
        soil_observation = MockSoilProvider().get_soil(location)
    if satellite and profile:
        satellite_observation = _request_satellite_observation(location)
    else:
        satellite_observation = SatelliteObservation(
            source="unavailable", crop_health="unavailable",
            availability_message=("Save your farm coordinates to request Bhuvan AOI statistics." if satellite and not profile
                                 else "Bhuvan API token is not configured in the backend environment."),
            observed_at=datetime.now(timezone.utc)
        )
    live_providers = sum(source in {"open-meteo", "open-meteo-modelled", "isro-bhuvan-lulc-250k"}
                         for source in (weather_observation.source, soil_observation.source, satellite_observation.source))
    data_quality = "live" if live_providers == 3 else "mixed" if live_providers else "mock"
    return DashboardResponse(profile=profile, weather=weather_observation, soil=soil_observation,
                             satellite=satellite_observation, data_quality=data_quality)


@app.get("/api/advisory", response_model=AdvisoryResponse, tags=["farm"])
def advisory(user_id: str = Depends(require_firebase_user)) -> AdvisoryResponse:
    profile = _load_profile(user_id)
    location = _location(profile)
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
def ask(payload: AskRequest, user_id: str = Depends(require_firebase_user)) -> AskResponse:
    profile = _load_profile(user_id)
    selected_crop = payload.crop or (profile.crops[0] if profile and profile.crops else None)
    language = payload.language or (profile.preferred_language if profile else "en")
    if ai is None:
        context = {"farm": profile.model_dump(mode="json")} if profile else {"farm": {}}
        context["farm"]["preferred_language"] = language
        fallback = MockAIProvider().answer(payload.question, selected_crop, context)
        return AskResponse(answer=fallback, source="mock-fallback")
    context: dict = {}
    if profile:
        context["farm"] = profile.model_dump(mode="json")
        context["farm"]["preferred_language"] = language
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
        if isinstance(ai, VertexAIProvider) and ai_fallback is not None:
            try:
                answer = ai_fallback.answer(payload.question, selected_crop, context)
                source = "gemini-fallback"
            except Exception as fallback_exc:
                _log_gemini_failure("Gemini fallback text generation", fallback_exc)
                answer = MockAIProvider().answer(payload.question, selected_crop, context)
                source = "mock-fallback"
        else:
            answer = MockAIProvider().answer(payload.question, selected_crop, context)
            source = "mock-fallback"
    return AskResponse(answer=answer, source=source)


@app.post("/api/disease/analyze", response_model=DiagnosisResponse, tags=["ai"])
def analyze(payload: DiagnosisRequest, user_id: str = Depends(require_firebase_user)) -> DiagnosisResponse:
    profile = _load_profile(user_id)
    if not payload.image_url and not payload.document_url and not payload.symptoms:
        raise HTTPException(status_code=422, detail="Provide an image, PDF report, or symptoms to analyze.")
    language = payload.language or (profile.preferred_language if profile else "en")
    try:
        return disease.diagnose(payload, language)
    except Exception as exc:
        _log_gemini_failure("crop image diagnosis", exc)
        return MockDiseaseProvider().diagnose(payload, language).model_copy(update={"source": "mock-fallback"})


@app.post("/api/diagnosis", response_model=DiagnosisResponse, include_in_schema=False)
def diagnosis_alias(payload: DiagnosisRequest, user_id: str = Depends(require_firebase_user)) -> DiagnosisResponse:
    return analyze(payload, user_id)


@app.get("/api/permissions", response_model=PermissionResponse, tags=["system"])
def permissions(user_id: str = Depends(require_firebase_user)) -> PermissionResponse:
    return PermissionResponse(explanation="Permissions are optional; location and camera are requested only after user action.")


@app.get("/api/demo", response_model=DashboardResponse, tags=["system"])
def demo(user_id: str = Depends(require_firebase_user)) -> DashboardResponse:
    return dashboard(user_id)


@app.get("/api/interoperability", tags=["interoperability"])
def interoperability(user_id: str = Depends(require_firebase_user)) -> dict:
    states = ["Karnataka", "Maharashtra", "Tamil Nadu"]
    timestamp = datetime.now(timezone.utc).isoformat()
    return {
        "schema": "AgricultureRecord/v1",
        "sources": [
            {"name": f"{state} demo adapter", "state": state, "status": "connected",
             "categories": ["crops", "soil", "weather", "field observations"]}
            for state in states
        ],
        "records": [
            {"source": f"{state} demo adapter", "state": state, "district": "Demo district",
             "location": {"type": "Point", "coordinates": [78.9629, 20.5937]},
             "crop": "Groundnut", "observations": {"soil": "normalized", "weather": "normalized",
             "field": "normalized"}, "timestamp": timestamp, "quality": "simulated"}
            for state in states
        ],
        "normalized_count": len(states),
        "data_quality": "simulated demo records",
        "last_sync": timestamp,
    }
