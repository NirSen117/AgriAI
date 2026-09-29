"""Fast, dependency-free checks for the demo decision pipeline."""

import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.advisory import build_advisory, localize_advisory
from app.providers import GeminiAIProvider, MockAIProvider, MockDiseaseProvider, OpenMeteoWeatherProvider
from app.schemas import DiagnosisRequest, FarmProfile, Location, SoilObservation, WeatherObservation


class Response:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return json.dumps(self.payload).encode()


class WeatherNormalizationTests(unittest.TestCase):
    @patch("app.providers.urlopen")
    def test_open_meteo_payload_is_normalized(self, urlopen):
        urlopen.return_value = Response({
            "current": {"temperature_2m": 29.5, "relative_humidity_2m": 70,
                        "precipitation": 2.0, "wind_speed_10m": 14},
            "daily": {"precipitation_probability_max": [80]},
        })
        result = OpenMeteoWeatherProvider("https://example.test", 1).get_weather(
            Location(latitude=13.3, longitude=77.1)
        )
        self.assertEqual(result.source, "open-meteo")
        self.assertEqual(result.temperature_c, 29.5)
        self.assertEqual(result.rainfall_probability, 0.8)
        self.assertEqual(result.wind_kph, 14)


class GeminiProviderTests(unittest.TestCase):
    @patch("app.providers.urlopen")
    def test_gemini_receives_farm_context_and_keeps_key_in_header(self, urlopen):
        urlopen.return_value = Response({"candidates": [{"content": {"parts": [{"text": "Check the soil before irrigating."}]}}]})
        provider = GeminiAIProvider("test-secret", "gemini-2.5-flash", 1)
        answer = provider.answer("Should I irrigate?", "Groundnut", {"farm": {"village": "Tumakuru"}})
        request = urlopen.call_args.args[0]
        body = json.loads(request.data)
        self.assertEqual(answer, "Check the soil before irrigating.")
        self.assertEqual(request.get_header("X-goog-api-key"), "test-secret")
        self.assertIn('"village":"Tumakuru"', body["contents"][0]["parts"][0]["text"])
        self.assertNotIn("test-secret", request.full_url)


class AdvisoryTests(unittest.TestCase):
    def test_rain_and_low_organic_carbon_create_explained_actions(self):
        now = datetime.now(timezone.utc)
        weather = WeatherObservation(source="test", temperature_c=28, humidity_percent=65,
            rainfall_mm=2, rainfall_probability=0.8, wind_kph=8, observed_at=now)
        soil = SoilObservation(source="test", ph=6.5, moisture_percent=42,
            nitrogen_index=50, organic_carbon_percent=0.7, observed_at=now)
        result = build_advisory(weather, soil)
        self.assertEqual(len(result.items), 2)
        self.assertIn("80%", result.items[0].reason)
        self.assertIn("Organic carbon", result.items[1].reason)

    def test_rule_advisories_have_local_copy_for_supported_languages(self):
        now = datetime.now(timezone.utc)
        weather = WeatherObservation(source="test", temperature_c=28, humidity_percent=65,
            rainfall_mm=2, rainfall_probability=0.8, wind_kph=8, observed_at=now)
        soil = SoilObservation(source="test", ph=6.5, moisture_percent=42,
            nitrogen_index=50, organic_carbon_percent=0.7, observed_at=now)
        result = localize_advisory(build_advisory(weather, soil), "hi")
        self.assertIn("बारिश", result.items[0].title)
        self.assertIn("80%", result.items[0].reason)

    def test_schema_rejects_out_of_range_location(self):
        with self.assertRaises(ValueError):
            Location(latitude=100, longitude=77)


class FallbackTests(unittest.TestCase):
    def test_disease_provider_returns_cautious_actionable_fallback(self):
        result = MockDiseaseProvider().diagnose(
            DiagnosisRequest(symptoms="small leaf spots", crop="groundnut")
        )
        self.assertLess(result.confidence, 1)
        self.assertIn("Possible", result.diagnosis)
        self.assertTrue(any("agronomist" in action.lower() for action in result.actions))

    def test_mock_assistant_uses_selected_language(self):
        answer = MockAIProvider().answer("क्या मुझे सिंचाई करनी चाहिए?", context={"farm": {"preferred_language": "hi"}})
        self.assertIn("सिंचाई", answer)

    def test_livestock_profile_requires_animal_group(self):
        with self.assertRaises(ValueError):
            FarmProfile(farmer_name="A", location=Location(latitude=13, longitude=77), farm_type="livestock")

    def test_livestock_only_profile_is_valid_without_crop_land(self):
        profile = FarmProfile(farmer_name="A", location=Location(latitude=13, longitude=77), farm_type="livestock",
            livestock=[{"species": "cattle", "count": 3}])
        self.assertEqual(profile.land_area_acres, 0)
        self.assertEqual(profile.livestock[0].count, 3)


if __name__ == "__main__":
    unittest.main()
