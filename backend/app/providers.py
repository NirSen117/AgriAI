"""Provider contracts and deterministic implementations.

Real integrations can implement these protocols without changing route code.
"""

from datetime import datetime, timezone
from http.client import RemoteDisconnected
from math import cos, radians
import base64
import json
import logging
from time import sleep
from typing import Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import AdvisoryResponse, DiagnosisRequest, DiagnosisResponse, Location, SatelliteObservation, SoilObservation, WeatherObservation

logger = logging.getLogger(__name__)
_GEMINI_FAILOVER_STATUSES = {404, 429, 500, 502, 503, 504}


def _model_order(primary: str, fallbacks: list[str] | None) -> list[str]:
    return list(dict.fromkeys([primary, *(model.strip() for model in (fallbacks or []) if model.strip())]))


def _gemini_generate_with_failover(api_key: str, models: list[str], payload_for_model,
                                   timeout_seconds: float, operation: str) -> dict:
    for index, model in enumerate(models):
        request = Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            data=json.dumps(payload_for_model(model)).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            method="POST",
        )
        try:
            with _open_gemini(request, timeout_seconds) as response:
                return json.load(response)
        except Exception as exc:
            status = getattr(exc, "code", None)
            if status not in _GEMINI_FAILOVER_STATUSES or index + 1 >= len(models):
                raise
            logger.warning("Gemini %s model %s returned HTTP %s; trying fallback model %s",
                           operation, model, status, models[index + 1])
    raise RuntimeError(f"All configured Gemini models failed for {operation}")


def _open_gemini(request: Request, timeout_seconds: float):
    """Retry brief Gemini 5xx outages; never retry auth, model, or quota errors."""
    for attempt in range(3):
        try:
            return urlopen(request, timeout=timeout_seconds)
        except Exception as exc:
            status = getattr(exc, "code", None)
            if status not in (500, 502, 503, 504) or attempt == 2:
                raise
            sleep(0.75 * (2 ** attempt))


def _response_text(result: dict) -> str:
    """Collect every user-facing text part, excluding Gemini thought parts."""
    candidates = result.get("candidates", [])
    if not candidates:
        return ""
    parts = candidates[0].get("content", {}).get("parts", [])
    return "\n".join(
        part["text"] for part in parts
        if isinstance(part.get("text"), str) and part["text"].strip() and not part.get("thought")
    ).strip()


class WeatherProvider(Protocol):
    def get_weather(self, location: Location) -> WeatherObservation: ...


class SoilProvider(Protocol):
    def get_soil(self, location: Location) -> SoilObservation: ...


class SatelliteProvider(Protocol):
    def get_observation(self, location: Location) -> SatelliteObservation: ...


class AIProvider(Protocol):
    def answer(self, question: str, crop: str | None = None, context: dict | None = None) -> str: ...


class DiseaseProvider(Protocol):
    def diagnose(self, request: DiagnosisRequest, language: str | None = None) -> DiagnosisResponse: ...


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _thinking_config(model: str) -> dict[str, str | int]:
    # Gemini 2.5 uses thinkingBudget; Gemini 3.x uses thinkingLevel.
    return {"thinkingLevel": "low"} if model.startswith("gemini-3") else {"thinkingBudget": 0}


class MockWeatherProvider:
    def get_weather(self, location: Location) -> WeatherObservation:
        return WeatherObservation(source="mock-weather", temperature_c=28.0, humidity_percent=67,
                                  rainfall_mm=4.0, rainfall_probability=0.65, wind_kph=12, observed_at=_now())


class OpenMeteoWeatherProvider:
    """Weather data from Open-Meteo's public forecast API; no key is required."""

    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds

    def get_weather(self, location: Location) -> WeatherObservation:
        query = urlencode({
            "latitude": location.latitude,
            "longitude": location.longitude,
            "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
            "daily": "precipitation_probability_max",
            "forecast_days": 1,
            "timezone": "auto",
        })
        request = Request(f"{self.base_url}?{query}", headers={"Accept": "application/json"})
        with urlopen(request, timeout=self.timeout_seconds) as response:
            payload = json.load(response)

        current = payload["current"]
        probability = payload.get("daily", {}).get("precipitation_probability_max", [0])[0] or 0
        return WeatherObservation(
            source="open-meteo",
            temperature_c=float(current["temperature_2m"]),
            humidity_percent=int(current["relative_humidity_2m"]),
            rainfall_mm=max(float(current.get("precipitation") or 0), 0),
            rainfall_probability=max(min(float(probability) / 100, 1), 0),
            wind_kph=max(float(current["wind_speed_10m"]), 0),
            observed_at=_now(),
        )


class OpenMeteoSoilProvider:
    """Modelled surface moisture from Open-Meteo, not an in-field sensor."""

    def __init__(self, base_url: str, timeout_seconds: float) -> None:
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds

    def get_soil(self, location: Location) -> SoilObservation:
        query = urlencode({
            "latitude": location.latitude,
            "longitude": location.longitude,
            "current": "soil_moisture_0_to_1cm,soil_moisture_3_to_9cm",
            "forecast_days": 1,
            "timezone": "auto",
        })
        request = Request(f"{self.base_url}?{query}", headers={"Accept": "application/json"})
        with urlopen(request, timeout=self.timeout_seconds) as response:
            payload = json.load(response)
        current = payload.get("current", {})
        values = [current.get("soil_moisture_0_to_1cm"), current.get("soil_moisture_3_to_9cm")]
        values = [float(value) for value in values if value is not None]
        if not values:
            raise ValueError("Open-Meteo returned no soil moisture values")
        moisture_percent = max(0.0, min(100.0, sum(values) / len(values) * 100))
        return SoilObservation(source="open-meteo-modelled", moisture_percent=moisture_percent,
                              observed_at=_now())


class MockSoilProvider:
    def get_soil(self, location: Location) -> SoilObservation:
        return SoilObservation(source="mock-soil", ph=6.7, moisture_percent=42,
                               nitrogen_index=58, organic_carbon_percent=0.72, observed_at=_now())


class MockSatelliteProvider:
    def get_observation(self, location: Location) -> SatelliteObservation:
        return SatelliteObservation(source="mock-satellite", ndvi=0.64, crop_health="good",
                                    cloud_cover_percent=18, observed_at=_now())


class BhuvanLulcProvider:
    """Bhuvan LULC AOI statistics. The access token is supplied by the user."""

    def __init__(self, token: str, endpoint: str, year: str, timeout_seconds: float) -> None:
        self.token = token.strip()
        self.endpoint = endpoint
        self.year = year
        self.timeout_seconds = timeout_seconds

    @staticmethod
    def _records(payload):
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in ("data", "records", "result", "results"):
                value = payload.get(key)
                if isinstance(value, list):
                    return value
                if isinstance(value, dict):
                    nested = BhuvanLulcProvider._records(value)
                    if nested:
                        return nested
        return []

    def get_observation(self, location: Location) -> SatelliteObservation:
        # Bhuvan's AOI statistics endpoint accepts WKT; use a roughly 200 m
        # neighborhood while this prototype stores only a farm pin.
        lat_delta = 0.001
        lon_delta = lat_delta / max(abs(cos(radians(location.latitude))), 0.15)
        west, east = location.longitude - lon_delta, location.longitude + lon_delta
        south, north = location.latitude - lat_delta, location.latitude + lat_delta
        polygon = f"POLYGON (({west} {south}, {east} {south}, {east} {north}, {west} {north}, {west} {south}))"
        params = urlencode({"polygon": polygon, "year": self.year, "option": "json", "token": self.token})
        request = Request(f"{self.endpoint}?{params}", method="POST",
                          headers={"Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
                                   "Content-Type": "application/json"})
        for attempt in range(3):
            try:
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    raw = response.read().decode("utf-8", errors="replace")
                break
            except RemoteDisconnected:
                if attempt == 2:
                    raise
                sleep(1.5 * (attempt + 1))
        try:
            payload = json.loads(raw)
        except ValueError:
            start = raw.find("[")
            end = raw.rfind("]")
            if start < 0 or end <= start:
                raise ValueError("Bhuvan returned a non-JSON response")
            payload = json.loads(raw[start:end + 1])
        records = self._records(payload)
        if not records:
            raise ValueError("Bhuvan response contained no LULC records")

        totals: dict[str, float] = {}
        for record in records:
            if not isinstance(record, dict):
                continue
            label = str(record.get("LULC Description") or record.get("lulc_description") or
                        record.get("class") or record.get("label") or "").strip()
            raw_area = (record.get("Area in Sq. Km") or record.get("area_sq_km") or
                        record.get("area") or 0)
            try:
                area = float(str(raw_area).replace(",", ""))
            except (TypeError, ValueError):
                continue
            if label and area >= 0:
                totals[label] = totals.get(label, 0.0) + area
        total_area = sum(totals.values())
        if total_area <= 0:
            raise ValueError("Bhuvan response had no usable area statistics")
        land_cover = [{"code": str(index), "label": label, "area_sq_km": round(area, 6),
                       "share_percent": round(area / total_area * 100, 2)}
                      for index, (label, area) in enumerate(sorted(totals.items(), key=lambda item: item[1], reverse=True))]
        return SatelliteObservation(source="isro-bhuvan-lulc-250k", land_cover=land_cover,
                                    crop_health="unavailable", observed_at=_now())


class MockAIProvider:
    def answer(self, question: str, crop: str | None = None, context: dict | None = None) -> str:
        farm = (context or {}).get("farm", {})
        language = farm.get("preferred_language", "en")
        answers = {
            "hi": "सिंचाई से पहले मिट्टी की नमी जाँचें। मौसम या मिट्टी के माप उपलब्ध न हों तो अनुमान न लगाएँ; स्थानीय कृषि अधिकारी से सलाह लें।",
            "kn": "ನೀರಾವರಿಗೆ ಮೊದಲು ಮಣ್ಣಿನ ತೇವಾಂಶ ಪರಿಶೀಲಿಸಿ. ಹವಾಮಾನ ಅಥವಾ ಮಣ್ಣಿನ ಅಳತೆ ಲಭ್ಯವಿಲ್ಲದಿದ್ದರೆ ಊಹಿಸಬೇಡಿ; ಸ್ಥಳೀಯ ಕೃಷಿ ಅಧಿಕಾರಿಯನ್ನು ಸಂಪರ್ಕಿಸಿ.",
            "ta": "நீர்ப்பாசனத்திற்கு முன் மண் ஈரப்பதத்தைச் சரிபார்க்கவும். வானிலை அல்லது மண் அளவுகள் இல்லையெனில் ஊகிக்க வேண்டாம்; உள்ளூர் வேளாண் அதிகாரியிடம் கேளுங்கள்.",
            "te": "నీటిపారుదలకు ముందు నేల తేమను తనిఖీ చేయండి. వాతావరణం లేదా నేల కొలతలు లేకపోతే ఊహించవద్దు; స్థానిక వ్యవసాయ అధికారిని సంప్రదించండి.",
            "bn": "সেচের আগে মাটির আর্দ্রতা পরীক্ষা করুন। আবহাওয়া বা মাটির পরিমাপ না থাকলে অনুমান করবেন না; স্থানীয় কৃষি কর্মকর্তার পরামর্শ নিন।",
            "mr": "सिंचनापूर्वी मातीतील ओलावा तपासा. हवामान किंवा मातीची मोजमापे उपलब्ध नसतील तर अंदाज बांधू नका; स्थानिक कृषी अधिकाऱ्यांचा सल्ला घ्या.",
        }
        if language in answers:
            return answers[language]
        subject = f" for {crop}" if crop else ""
        return f"For your question{subject}, check soil moisture before irrigation, scout leaves regularly, and follow local agricultural guidance."


def ai_unavailable_message(language: str | None = None) -> str:
    """Return a clear localized message instead of inventing an AI response."""
    messages = {
        "en": "AI advice is unavailable right now. Please try again later.",
        "hi": "AI सलाह अभी उपलब्ध नहीं है। कृपया बाद में फिर कोशिश करें।",
        "kn": "AI ಸಲಹೆ ಈಗ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
        "ta": "AI ஆலோசனை இப்போது கிடைக்கவில்லை. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.",
        "te": "AI సలహా ప్రస్తుతం అందుబాటులో లేదు. దయచేసి కొంత సమయం తర్వాత మళ్లీ ప్రయత్నించండి.",
        "bn": "AI পরামর্শ এখন পাওয়া যাচ্ছে না। অনুগ্রহ করে পরে আবার চেষ্টা করুন।",
        "mr": "AI सल्ला सध्या उपलब्ध नाही. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.",
    }
    return messages.get(language or "en", messages["en"])


class GeminiAIProvider:
    """Text-only Gemini integration that keeps the API key on the server."""

    def __init__(self, api_key: str, model: str, timeout_seconds: float,
                 fallback_models: list[str] | None = None) -> None:
        self.api_key = api_key
        self.model = model
        self.models = _model_order(model, fallback_models)
        self.timeout_seconds = timeout_seconds

    def answer(self, question: str, crop: str | None = None, context: dict | None = None) -> str:
        farm_context = json.dumps(context or {}, ensure_ascii=False, separators=(",", ":"))
        language_code = ((context or {}).get("farm") or {}).get("preferred_language", "en")
        language = {
            "en": "English", "hi": "Hindi", "kn": "Kannada", "ta": "Tamil",
            "te": "Telugu", "bn": "Bengali", "mr": "Marathi",
        }.get(language_code, "English")
        system_instruction = (
            "You are AgriAI, a careful agricultural assistant for smallholder farmers in India. "
            f"Use the supplied farm context when relevant and answer in {language}. "
            "Treat measurements in context as the only available measurements: never invent weather, soil, "
            "satellite, field, or farm-history facts. Clearly say when data is simulated, estimated, or missing. "
            "Give concise, practical, low-risk steps in at most 140 words. For pesticide dosage or urgent disease "
            "decisions, recommend a local agronomist. Do not provide hidden reasoning; give a short evidence summary."
        )
        user_content = f"Farmer question: {question}\nCrop: {crop or 'not specified'}\nStructured farm context: {farm_context}"
        result = _gemini_generate_with_failover(
            self.api_key,
            self.models,
            lambda model: {
                "systemInstruction": {"parts": [{"text": system_instruction}]},
                "contents": [{"role": "user", "parts": [{"text": user_content}]}],
                "generationConfig": {"temperature": 0.3, "maxOutputTokens": 700,
                                     "thinkingConfig": _thinking_config(model)},
            },
            self.timeout_seconds,
            "text generation",
        )

        text = _response_text(result)
        if not text:
            raise ValueError("Gemini returned an empty answer")
        return text

    def translate_advisory(self, advisory: AdvisoryResponse, language_code: str) -> AdvisoryResponse:
        language = {"hi": "Hindi", "kn": "Kannada", "ta": "Tamil", "te": "Telugu", "bn": "Bengali", "mr": "Marathi"}.get(language_code)
        if not language:
            return advisory
        source = {"summary": advisory.summary, "items": [{"title": item.title, "action": item.action, "reason": item.reason} for item in advisory.items]}
        instruction = (
            f"Translate the provided agricultural advisory into {language}. Return only valid JSON with the same keys "
            "and same number of items. Translate text only. Preserve every number, unit, uncertainty, and meaning; "
            "do not add facts, recommendations, or diagnoses."
        )
        payload = json.dumps({
            "systemInstruction": {"parts": [{"text": instruction}]},
            "contents": [{"role": "user", "parts": [{"text": json.dumps(source, ensure_ascii=False)}]}],
            "generationConfig": {"temperature": 0, "maxOutputTokens": 900,
                                 "thinkingConfig": _thinking_config(self.model), "responseMimeType": "application/json"},
        }).encode()
        request = Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            data=payload, headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key}, method="POST",
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            result = json.load(response)
        text = _response_text(result)
        translated = json.loads(text)
        if not isinstance(translated.get("summary"), str) or len(translated.get("items", [])) != len(advisory.items):
            raise ValueError("Gemini returned an invalid translated advisory")
        items = []
        for original, item in zip(advisory.items, translated["items"]):
            if not all(isinstance(item.get(key), str) for key in ("title", "action", "reason")):
                raise ValueError("Gemini returned incomplete translated advisory text")
            items.append(original.model_copy(update={"title": item["title"], "action": item["action"], "reason": item["reason"]}))
        return advisory.model_copy(update={"summary": translated["summary"], "items": items, "source": "rules+gemini-translation"})


class GeminiDiseaseProvider:
    """Uses Gemini multimodal input for image and symptom-based crop triage."""

    def __init__(self, api_key: str, model: str, timeout_seconds: float,
                 fallback_models: list[str] | None = None) -> None:
        self.api_key = api_key
        self.model = model
        self.models = _model_order(model, fallback_models)
        self.timeout_seconds = timeout_seconds

    def diagnose(self, request: DiagnosisRequest, language: str | None = None) -> DiagnosisResponse:
        language_name = {"en": "English", "hi": "Hindi", "kn": "Kannada", "ta": "Tamil",
                         "te": "Telugu", "bn": "Bengali", "mr": "Marathi"}.get(language or "en", "English")
        prompt = (
            "Assess this crop report for cautious agricultural triage. The result is not a confirmed diagnosis. "
            f"Respond in {language_name} as JSON with keys diagnosis (string), confidence (number 0 to 1), "
            "severity (low, medium, or high), and actions (array of 2-4 short strings). Include uncertainty; "
            "if the image is unclear or lacks a crop, say so. Do not prescribe pesticide products or dosage. "
            f"Crop: {request.crop or 'not provided'}. Farmer symptoms: {request.symptoms or 'not provided'}."
        )
        parts: list[dict[str, str | dict[str, str]]] = [{"text": prompt}]
        if request.image_url:
            header, image_data = request.image_url.split(",", 1)
            mime_type = header.removeprefix("data:").removesuffix(";base64")
            parts.append({"inlineData": {"mimeType": mime_type, "data": image_data}})
        result = _gemini_generate_with_failover(
            self.api_key,
            self.models,
            lambda model: {
                "contents": [{"role": "user", "parts": parts}],
                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 900,
                                     "thinkingConfig": _thinking_config(model), "responseMimeType": "application/json"},
            },
            self.timeout_seconds,
            "crop diagnosis",
        )
        text = _response_text(result)
        parsed = json.loads(text)
        diagnosis = DiagnosisResponse.model_validate({**parsed, "source": "gemini-vision"})
        if not diagnosis.actions:
            raise ValueError("Gemini returned no diagnosis actions")
        return diagnosis


def disease_unavailable_response(language: str | None = None) -> DiagnosisResponse:
    messages = {
        "en": "Crop diagnosis is unavailable right now. Please try again later.",
        "hi": "फसल की जाँच अभी उपलब्ध नहीं है। कृपया बाद में फिर कोशिश करें।",
        "kn": "ಬೆಳೆ ರೋಗ ಪರಿಶೀಲನೆ ಈಗ ಲಭ್ಯವಿಲ್ಲ. ದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
        "ta": "பயிர் நோய் ஆய்வு இப்போது கிடைக்கவில்லை. பின்னர் மீண்டும் முயற்சிக்கவும்.",
        "te": "పంట వ్యాధి విశ్లేషణ ప్రస్తుతం అందుబాటులో లేదు. తర్వాత మళ్లీ ప్రయత్నించండి.",
        "bn": "ফসলের রোগ নির্ণয় এখন পাওয়া যাচ্ছে না। পরে আবার চেষ্টা করুন।",
        "mr": "पिकाचे निदान सध्या उपलब्ध नाही. कृपया नंतर पुन्हा प्रयत्न करा.",
    }
    return DiagnosisResponse(diagnosis=messages.get(language or "en", messages["en"]),
                             confidence=None, severity="low", actions=[], source="unavailable")


class VertexAIProvider:
    """Gemini through Vertex AI using Application Default Credentials.

    Credentials are resolved by the Google SDK at runtime (for example, a
    service account attached to Cloud Run). No service-account JSON belongs in
    the repository or browser bundle.
    """

    def __init__(self, project: str, location: str, model: str) -> None:
        from google import genai

        self.model = model
        self.client = genai.Client(vertexai=True, project=project, location=location)

    def answer(self, question: str, crop: str | None = None, context: dict | None = None) -> str:
        prompt = (
            "You are AgriAI, a careful agricultural assistant for smallholder farmers in India. "
            "Use only the supplied context; do not invent measurements. State uncertainty and give "
            "concise, practical, low-risk steps. Recommend a local agronomist for pesticide dosage "
            "or urgent disease decisions. "
            f"Question: {question}\nCrop: {crop or 'not specified'}\n"
            f"Farm context: {json.dumps(context or {}, ensure_ascii=False, separators=(',', ':'))}"
        )
        response = self.client.models.generate_content(model=self.model, contents=prompt)
        text = getattr(response, "text", None)
        if not text or not text.strip():
            raise ValueError("Vertex AI returned an empty answer")
        return text.strip()


class MockDiseaseProvider:
    def diagnose(self, request: DiagnosisRequest, language: str | None = None) -> DiagnosisResponse:
        symptoms = (request.symptoms or "").lower()
        translated = {
            "hi": ("संभावित फफूंद जनित पत्ती धब्बा", "पत्ती पर स्पष्ट रोग लक्षण नहीं मिले", ["बहुत प्रभावित पत्तियाँ हटाएँ", "ऊपर से पानी देने से बचें", "उपचार से पहले कृषि विशेषज्ञ से सलाह लें"], ["पत्तियों के नीचे जाँच करें", "48 घंटे बाद लक्षण फिर देखें", "पुष्टि के लिए स्थानीय कृषि सेवा से संपर्क करें"]),
            "kn": ("ಸಂಭಾವ್ಯ ಶಿಲೀಂಧ್ರ ಎಲೆ ಚುಕ್ಕೆ", "ಸ್ಪಷ್ಟ ರೋಗ ಲಕ್ಷಣ ಕಂಡುಬಂದಿಲ್ಲ", ["ತೀವ್ರವಾಗಿ ಬಾಧಿತ ಎಲೆಗಳನ್ನು ತೆಗೆದುಹಾಕಿ", "ಮೇಲಿನಿಂದ ನೀರು ಹಾಕುವುದನ್ನು ತಪ್ಪಿಸಿ", "ಚಿಕಿತ್ಸೆಗೂ ಮುನ್ನ ಕೃಷಿ ತಜ್ಞರನ್ನು ಸಂಪರ್ಕಿಸಿ"], ["ಎಲೆಗಳ ಕೆಳಭಾಗ ಪರಿಶೀಲಿಸಿ", "48 ಗಂಟೆಗಳ ನಂತರ ಮತ್ತೆ ಪರಿಶೀಲಿಸಿ", "ದೃಢೀಕರಣಕ್ಕೆ ಸ್ಥಳೀಯ ಕೃಷಿ ಸೇವೆಯನ್ನು ಸಂಪರ್ಕಿಸಿ"]),
            "ta": ("சாத்தியமான பூஞ்சை இலைப்புள்ளி", "தெளிவான நோய் அறிகுறி கண்டறியப்படவில்லை", ["மிகவும் பாதிக்கப்பட்ட இலைகளை அகற்றவும்", "மேலிருந்து நீர் பாய்ச்சுவதைத் தவிர்க்கவும்", "சிகிச்சைக்கு முன் வேளாண் நிபுணரிடம் கேளுங்கள்"], ["இலைகளின் அடிப்பகுதியைப் பாருங்கள்", "48 மணி நேரத்தில் மீண்டும் சரிபார்க்கவும்", "உறுதிப்படுத்த உள்ளூர் வேளாண் சேவையை அணுகவும்"]),
            "te": ("సంభావ్య ఫంగస్ ఆకు మచ్చ", "స్పష్టమైన వ్యాధి లక్షణం గుర్తించలేదు", ["బాగా ప్రభావితమైన ఆకులను తొలగించండి", "పై నుంచి నీరు పోయడాన్ని నివారించండి", "చికిత్సకు ముందు వ్యవసాయ నిపుణుడిని సంప్రదించండి"], ["ఆకుల కింద భాగాన్ని చూడండి", "48 గంటల తర్వాత మళ్లీ తనిఖీ చేయండి", "నిర్ధారణకు స్థానిక వ్యవసాయ సేవను సంప్రదించండి"]),
            "bn": ("সম্ভাব্য ছত্রাকজনিত পাতার দাগ", "স্পষ্ট রোগের লক্ষণ পাওয়া যায়নি", ["খুব আক্রান্ত পাতা সরিয়ে ফেলুন", "উপর থেকে জল দেওয়া এড়িয়ে চলুন", "চিকিৎসার আগে কৃষি বিশেষজ্ঞের পরামর্শ নিন"], ["পাতার নিচের দিক দেখুন", "৪৮ ঘণ্টা পরে আবার পরীক্ষা করুন", "নিশ্চিত হতে স্থানীয় কৃষি পরিষেবায় যোগাযোগ করুন"]),
            "mr": ("संभाव्य बुरशीजन्य पानावरील ठिपके", "ठळक रोगाची लक्षणे आढळली नाहीत", ["जास्त बाधित पाने काढा", "वरून पाणी देणे टाळा", "उपचारापूर्वी कृषी तज्ज्ञांचा सल्ला घ्या"], ["पानांची खालची बाजू तपासा", "48 तासांनी पुन्हा तपासा", "खात्रीसाठी स्थानिक कृषी सेवेशी संपर्क साधा"]),
        }.get(language or "")
        if "spot" in symptoms or "blight" in symptoms:
            return DiagnosisResponse(diagnosis=translated[0] if translated else "Possible fungal leaf spot", confidence=0.68, severity="medium",
                                     actions=translated[2] if translated else ["Remove severely affected leaves", "Avoid overhead watering", "Consult an agronomist before applying treatment"], source="mock-disease")
        if translated:
            return DiagnosisResponse(diagnosis=translated[1], confidence=0.55, severity="low", actions=translated[3], source="mock-disease")
        return DiagnosisResponse(diagnosis="No clear disease pattern detected", confidence=0.55, severity="low",
                                 actions=["Inspect the underside of leaves", "Recheck symptoms in 48 hours", "Use a local extension service for confirmation"], source="mock-disease")
