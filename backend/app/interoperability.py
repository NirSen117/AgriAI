"""Normalize this account's farm and provider snapshots to AgroAIRecord/v1."""

from datetime import datetime, timezone

from .schemas import (
    DashboardResponse,
    FarmProfile,
    InteroperabilityRecord,
    InteroperabilityResponse,
    InteroperabilitySource,
    Location,
    NormalizedGeoJSONPoint,
)

ACRES_TO_HECTARES = 0.40468564224


def _point(location: Location) -> NormalizedGeoJSONPoint:
    # GeoJSON/OGC CRS84 axis order is longitude, latitude.
    return NormalizedGeoJSONPoint(coordinates=(location.longitude, location.latitude))


def _quality(source: str, record_type: str) -> str:
    normalized_source = source.lower()
    if normalized_source == "unavailable":
        return "unavailable"
    if normalized_source.startswith("mock"):
        return "simulated"
    if record_type in {"farm_profile", "crop_field", "livestock_group"}:
        return "user-reported"
    if record_type == "satellite_observation" and "bhuvan" in normalized_source:
        return "historical"
    if record_type == "soil_observation" and "model" in normalized_source:
        return "modelled"
    return "live"


def _source_name(source: str, record_type: str, quality: str) -> str:
    if quality == "unavailable":
        return {
            "weather_observation": "Weather provider unavailable",
            "soil_observation": "Soil provider unavailable",
            "satellite_observation": "Bhuvan LULC unavailable",
        }.get(record_type, source)
    if quality == "simulated":
        return f"Demo {record_type.removesuffix('_observation').replace('_', ' ')}"
    if record_type == "weather_observation" and "open-meteo" in source:
        return "Open-Meteo"
    if record_type == "soil_observation" and "open-meteo" in source:
        return "Open-Meteo modelled soil"
    if record_type == "satellite_observation" and quality == "historical":
        return "Bhuvan LULC"
    return source


def _records(profile: FarmProfile | None, snapshot: DashboardResponse,
             recorded_at: datetime) -> list[InteroperabilityRecord]:
    records: list[InteroperabilityRecord] = []
    if not profile:
        return records

    point = _point(profile.location)
    records.append(InteroperabilityRecord(
        id="farm-profile", record_type="farm_profile", source="Farmer-entered profile",
        quality="user-reported", recorded_at=recorded_at, location=point,
        units={"farm_area_ha": "ha"},
        data={"farm_type": profile.farm_type,
              "farm_area_ha": round(profile.land_area_acres * ACRES_TO_HECTARES, 4),
              "field_count": len(profile.fields) or len(profile.crops),
              "livestock_group_count": len(profile.livestock),
              "soil_type": profile.soil_type, "irrigation": profile.irrigation},
        limitations=["Farm and soil details are self-reported; they are not independently verified."],
    ))

    if profile.fields:
        for index, field in enumerate(profile.fields):
            records.append(InteroperabilityRecord(
                id=f"crop-field-{index + 1}", record_type="crop_field", source="Farmer-entered profile",
                quality="user-reported", recorded_at=recorded_at, location=point,
                units={"area_ha": "ha"},
                data={"name": field.name.strip(), "crop": " ".join(field.crop.split()),
                      "area_ha": round(field.area_acres * ACRES_TO_HECTARES, 4),
                      "variety": field.crop_variety,
                      "sowing_date": field.sowing_date.isoformat() if field.sowing_date else None,
                      "growth_stage": field.growth_stage, "irrigation": field.irrigation,
                      "soil_type": field.soil_type},
                limitations=["Field details are self-reported."],
            ))
    else:
        for index, crop in enumerate(profile.crops):
            records.append(InteroperabilityRecord(
                id=f"crop-field-{index + 1}", record_type="crop_field", source="Farmer-entered profile",
                quality="user-reported", recorded_at=recorded_at, location=point,
                units={"area_ha": "ha"},
                data={"name": None, "crop": " ".join(crop.split()), "area_ha": None,
                      "area_status": "not supplied for this crop"},
                limitations=["No separate field boundary or crop-specific area was supplied."],
            ))

    for index, group in enumerate(profile.livestock):
        records.append(InteroperabilityRecord(
            id=f"livestock-group-{index + 1}", record_type="livestock_group",
            source="Farmer-entered profile", quality="user-reported", recorded_at=recorded_at,
            location=point, data={"species": group.species, "animal_count": group.count,
                                  "breed": group.breed, "purpose": group.purpose},
            units={"animal_count": "head"}, limitations=["Livestock details are self-reported."],
        ))

    weather = snapshot.weather
    weather_quality = _quality(weather.source, "weather_observation")
    records.append(InteroperabilityRecord(
        id="weather-current", record_type="weather_observation",
        source=_source_name(weather.source, "weather_observation", weather_quality),
        quality=weather_quality, recorded_at=recorded_at, observed_at=weather.observed_at,
        location=point,
        units={"temperature_c": "Cel", "relative_humidity_percent": "%", "precipitation_mm": "mm",
               "precipitation_probability": "1", "wind_speed_m_s": "m/s"},
        data={"temperature_c": weather.temperature_c,
              "relative_humidity_percent": weather.humidity_percent,
              "precipitation_mm": weather.rainfall_mm,
              "precipitation_probability": weather.rainfall_probability,
              "wind_speed_m_s": round(weather.wind_kph / 3.6, 3)},
        limitations=["Weather is a provider grid estimate for the farm coordinates, not a field sensor reading."]
        if weather_quality == "live" else [],
    ))

    soil = snapshot.soil
    soil_quality = _quality(soil.source, "soil_observation")
    soil_values = {"ph": soil.ph, "moisture_percent": soil.moisture_percent,
                   "nitrogen_index": soil.nitrogen_index,
                   "organic_carbon_percent": soil.organic_carbon_percent}
    records.append(InteroperabilityRecord(
        id="soil-current", record_type="soil_observation",
        source=_source_name(soil.source, "soil_observation", soil_quality),
        quality=soil_quality, recorded_at=recorded_at, observed_at=soil.observed_at,
        location=point,
        units={"ph": "1", "moisture_percent": "%", "nitrogen_index": "index_0_100",
               "organic_carbon_percent": "%"},
        data={key: value for key, value in soil_values.items() if value is not None},
        limitations=["Modelled surface moisture is not a soil test or field sensor reading."]
        if soil_quality == "modelled" else [],
    ))

    satellite = snapshot.satellite
    satellite_quality = _quality(satellite.source, "satellite_observation")
    satellite_data: dict = {"crop_health": satellite.crop_health}
    if satellite.ndvi is not None:
        satellite_data["ndvi"] = satellite.ndvi
    if satellite.cloud_cover_percent is not None:
        satellite_data["cloud_cover_percent"] = satellite.cloud_cover_percent
    if satellite.land_cover:
        satellite_data["land_cover"] = satellite.land_cover
    limitations = (["Bhuvan LULC is historical regional land-cover context, not current crop health or a surveyed field boundary."]
                   if satellite_quality == "historical" else [])
    if satellite.availability_message and satellite_quality == "unavailable":
        limitations.append(satellite.availability_message)
    records.append(InteroperabilityRecord(
        id="satellite-current", record_type="satellite_observation",
        source=_source_name(satellite.source, "satellite_observation", satellite_quality),
        quality=satellite_quality, recorded_at=recorded_at, observed_at=satellite.observed_at,
        location=point,
        units={"ndvi": "1", "cloud_cover_percent": "%", "land_cover[].area_sq_km": "km2",
               "land_cover[].share_percent": "%"},
        data=satellite_data, limitations=limitations,
    ))
    return records


def normalize_interoperability(profile: FarmProfile | None,
                               snapshot: DashboardResponse) -> InteroperabilityResponse:
    """Build canonical per-account records without filling gaps with invented values."""
    timestamp = datetime.now(timezone.utc)
    records = _records(profile, snapshot, timestamp)
    source_groups: dict[str, list[InteroperabilityRecord]] = {}
    for record in records:
        source_groups.setdefault(record.source, []).append(record)
    sources = [InteroperabilitySource(
        name=name,
        status=("unavailable" if all(record.quality == "unavailable" for record in source_records)
                else "simulated" if all(record.quality == "simulated" for record in source_records)
                else "user-reported" if all(record.quality == "user-reported" for record in source_records)
                else "connected"),
        categories=list(dict.fromkeys(record.record_type for record in source_records)),
        record_count=len(source_records),
    ) for name, source_records in source_groups.items()]
    counts: dict[str, int] = {}
    for record in records:
        counts[record.quality] = counts.get(record.quality, 0) + 1
    labels = ("user-reported", "live", "modelled", "historical", "simulated", "unavailable")
    quality = ", ".join(f"{counts[label]} {label}" for label in labels if counts.get(label, 0)) or "no farm records yet"
    return InteroperabilityResponse(
        sources=sources, records=records, normalized_count=len(records), data_quality=quality,
        last_sync=timestamp,
        limitation="This feed represents the signed-in farm and configured providers. State government datasets are not connected yet.",
    )
