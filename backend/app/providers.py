"""Provider contracts and deterministic implementations.

Real integrations can implement these protocols without changing route code.
"""

from datetime import datetime, timezone
from datetime import timedelta
import base64
import json
from math import cos, radians
from typing import Protocol
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import AdvisoryResponse, DiagnosisRequest, DiagnosisResponse, Location, SatelliteObservation, SoilObservation, WeatherObservation


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


class CopernicusSatelliteProvider:
    """Recent Sentinel-2 NDVI statistics for a small area around the farm pin."""

    endpoint = "https://sh.dataspace.copernicus.eu/statistics/v1"
    token_endpoint = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token"

    def __init__(self, client_id: str, client_secret: str, timeout_seconds: float) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.timeout_seconds = timeout_seconds

    def get_observation(self, location: Location) -> SatelliteObservation:
        token_request = Request(
            self.token_endpoint,
            data=urlencode({"grant_type": "client_credentials", "client_id": self.client_id,
                            "client_secret": self.client_secret}).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            method="POST",
        )
        with urlopen(token_request, timeout=self.timeout_seconds) as response:
            token = json.load(response)["access_token"]

        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=30)).date().isoformat() + "T00:00:00Z"
        end = now.date().isoformat() + "T23:59:59Z"
        # No parcel polygon is collected yet; sample roughly a 200 m square around the farm pin.
        lat_delta = 0.001
        lon_delta = 0.001 / max(abs(cos(radians(location.latitude))), 0.1)
        bbox = [location.longitude - lon_delta, location.latitude - lat_delta,
                location.longitude + lon_delta, location.latitude + lat_delta]
        evalscript = """//VERSION=3
function setup() {
  return {input:[{bands:["B04","B08","SCL","dataMask"]}], mosaicking:"ORBIT",
    output:[{id:"ndvi",bands:1,sampleType:"FLOAT32"},{id:"dataMask",bands:1}]};
}
function evaluatePixel(samples) {
  var total=0, count=0;
  for (var i=0; i<samples.length; i++) {
    var s=samples[i];
    if (s.dataMask && [8,9,10,11].indexOf(s.SCL) < 0 && (s.B08+s.B04) !== 0) {
      total += (s.B08-s.B04)/(s.B08+s.B04); count++;
    }
  }
  return count ? {ndvi:[total/count],dataMask:[1]} : {ndvi:[0],dataMask:[0]};
}"""
        body = {
            "input": {"bounds": {"bbox": bbox, "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}},
                      "data": [{"type": "sentinel-2-l2a", "dataFilter": {
                          "timeRange": {"from": start, "to": end}, "maxCloudCoverage": 80,
                          "mosaickingOrder": "leastCC"}}]},
            "aggregation": {"timeRange": {"from": start, "to": end}, "aggregationInterval": {"of": "P30D"},
                            "evalscript": evalscript, "width": 20, "height": 20},
        }
        request = Request(self.endpoint, data=json.dumps(body).encode(), headers={
            "Content-Type": "application/json", "Accept": "application/json", "Authorization": f"Bearer {token}",
        }, method="POST")
        with urlopen(request, timeout=self.timeout_seconds) as response:
            result = json.load(response)
        rows = result.get("data", [])
        if not rows:
            raise ValueError("Sentinel Hub returned no imagery for the farm location")
        stats = rows[-1].get("outputs", {}).get("ndvi", {}).get("bands", {}).get("B0", {}).get("stats", {})
        ndvi = stats.get("mean")
        if ndvi is None or not stats.get("sampleCount", 0):
            raise ValueError("Sentinel Hub returned no clear NDVI pixels")
        ndvi = max(-1.0, min(1.0, float(ndvi)))
        health = "poor" if ndvi < 0.2 else "fair" if ndvi < 0.4 else "good" if ndvi < 0.6 else "excellent"
        return SatelliteObservation(source="copernicus-sentinel-2-near-location", ndvi=ndvi,
                                    crop_health=health, cloud_cover_percent=None, observed_at=_now())


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

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self.api_key = api_key
        self.model = model
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
        payload = json.dumps({
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "contents": [{"role": "user", "parts": [{"text": user_content}]}],
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 300},
        }).encode()
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        request = Request(url, data=payload, headers={
            "Content-Type": "application/json", "x-goog-api-key": self.api_key,
        }, method="POST")
        with urlopen(request, timeout=self.timeout_seconds) as response:
            result = json.load(response)

        candidates = result.get("candidates", [])
        if not candidates:
            raise ValueError("Gemini returned no answer")
        text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
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
            "generationConfig": {"temperature": 0, "maxOutputTokens": 500, "responseMimeType": "application/json"},
        }).encode()
        request = Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            data=payload, headers={"Content-Type": "application/json", "x-goog-api-key": self.api_key}, method="POST",
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            result = json.load(response)
        candidates = result.get("candidates", [])
        text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "") if candidates else ""
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

    def __init__(self, api_key: str, model: str, timeout_seconds: float) -> None:
        self.api_key = api_key
        self.model = model
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
        payload = json.dumps({
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 450, "responseMimeType": "application/json"},
        }).encode()
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        request_http = Request(endpoint, data=payload, headers={
            "Content-Type": "application/json", "x-goog-api-key": self.api_key,
        }, method="POST")
        with urlopen(request_http, timeout=self.timeout_seconds) as response:
            result = json.load(response)
        candidates = result.get("candidates", [])
        text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "") if candidates else ""
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
