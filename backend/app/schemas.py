from datetime import date, datetime
import base64
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    timestamp: datetime


class ProviderStatus(BaseModel):
    name: str
    available: bool
    mode: Literal["mock", "live", "fallback"]
    message: str


class SystemStatus(BaseModel):
    status: Literal["ok", "degraded"]
    mock_mode: bool
    providers: list[ProviderStatus]


class Location(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    village: str | None = None
    state: str | None = None


class FarmField(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    area_acres: float = Field(gt=0, le=100000)
    crop: str = Field(min_length=1, max_length=120)
    crop_variety: str | None = Field(default=None, max_length=120)
    sowing_date: date | None = None
    growth_stage: str | None = Field(default=None, max_length=80)
    irrigation: str | None = Field(default=None, max_length=80)
    soil_type: str | None = Field(default=None, max_length=120)


class LivestockGroup(BaseModel):
    species: Literal["cattle", "buffalo", "goat", "sheep", "poultry", "pig", "other"]
    count: int = Field(gt=0, le=1000000)
    breed: str | None = Field(default=None, max_length=120)
    purpose: str | None = Field(default=None, max_length=120)


class FarmProfile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    farmer_name: str = Field(min_length=1, max_length=120)
    farm_name: str | None = None
    location: Location
    farm_type: Literal["crops", "livestock", "mixed"] = "crops"
    land_area_acres: float = Field(default=0, ge=0, le=100000)
    soil_type: str | None = None
    irrigation: str | None = None
    crops: list[str] = Field(default_factory=list, max_length=20)
    fields: list[FarmField] = Field(default_factory=list, max_length=100)
    livestock: list[LivestockGroup] = Field(default_factory=list, max_length=100)
    preferred_language: str | None = Field(default=None, max_length=40)
    crop_variety: str | None = Field(default=None, max_length=120)
    sowing_date: date | None = None
    growth_stage: str | None = Field(default=None, max_length=80)
    previous_crop: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def check_operation_type(self):
        if self.farm_type in ("crops", "mixed") and (not self.crops or self.land_area_acres <= 0):
            raise ValueError("Crop and mixed farms need at least one crop and a positive land area.")
        if self.farm_type in ("livestock", "mixed") and not self.livestock:
            raise ValueError("Livestock and mixed farms need at least one livestock group.")
        return self


class OnboardingResponse(BaseModel):
    saved: bool
    profile: FarmProfile
    message: str


class WeatherObservation(BaseModel):
    source: str
    temperature_c: float
    humidity_percent: float = Field(ge=0, le=100)
    rainfall_mm: float = Field(ge=0)
    rainfall_probability: float = Field(ge=0, le=1)
    wind_kph: float = Field(ge=0)
    observed_at: datetime


class SoilObservation(BaseModel):
    source: str
    ph: float | None = Field(default=None, ge=0, le=14)
    moisture_percent: float | None = Field(default=None, ge=0, le=100)
    nitrogen_index: float | None = Field(default=None, ge=0, le=100)
    organic_carbon_percent: float | None = Field(default=None, ge=0, le=100)
    observed_at: datetime


class SatelliteObservation(BaseModel):
    source: str
    availability_message: str | None = None
    ndvi: float | None = Field(default=None, ge=-1, le=1)
    crop_health: Literal["poor", "fair", "good", "excellent", "unavailable"] = "unavailable"
    land_cover: list[dict[str, str | float]] = Field(default_factory=list)
    cloud_cover_percent: float | None = Field(default=None, ge=0, le=100)
    observed_at: datetime


class DashboardResponse(BaseModel):
    profile: FarmProfile | None
    weather: WeatherObservation
    soil: SoilObservation
    satellite: SatelliteObservation
    data_quality: Literal["mock", "live", "mixed"]


class AdvisoryItem(BaseModel):
    priority: Literal["high", "medium", "low"]
    title: str
    action: str
    reason: str


class AdvisoryResponse(BaseModel):
    generated_at: datetime
    summary: str
    items: list[AdvisoryItem]
    source: str = "rules"


class DiagnosisRequest(BaseModel):
    image_url: str | None = Field(default=None, max_length=6 * 1024 * 1024)
    crop: str | None = None
    symptoms: str | None = None

    @model_validator(mode="after")
    def validate_image_data(self):
        if self.image_url:
            match = re.fullmatch(r"data:image/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})", self.image_url)
            if not match:
                raise ValueError("Image must be a base64 PNG, JPEG, or WebP data URL.")
            try:
                raw = base64.b64decode(match.group(1), validate=True)
            except ValueError as exc:
                raise ValueError("Image data is invalid.") from exc
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError("Image must be 4 MB or smaller.")
        if self.symptoms and len(self.symptoms) > 2000:
            raise ValueError("Symptoms text is too long.")
        return self


class DiagnosisResponse(BaseModel):
    diagnosis: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    severity: Literal["low", "medium", "high"]
    actions: list[str]
    source: str


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    crop: str | None = None


class AskResponse(BaseModel):
    answer: str
    source: str


class PermissionResponse(BaseModel):
    location: bool = False
    camera: bool = False
    notifications: bool = False
    explanation: str


class ErrorResponse(BaseModel):
    detail: str
    code: str | None = None
