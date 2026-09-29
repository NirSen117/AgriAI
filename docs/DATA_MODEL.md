# Data model

The prototype uses Pydantic contracts as the source of truth for API data.

- `FarmProfile` contains farmer, farm, location, soil, irrigation, and crop
  context. Coordinates are optional from a user-experience perspective because
  manual village/state entry is supported.
- `WeatherObservation`, `SoilObservation`, and `SatelliteObservation` are
  normalized provider outputs. Each includes a `source` so simulated values
  cannot be confused with observations from a live service.
- `AdvisoryResponse` contains prioritized actions and the reason each action
  was selected. This makes deterministic rules explainable and leaves room for
  structured AI output.
- `DiagnosisResponse` deliberately uses “possible” language, confidence, and
  next steps rather than claiming a confirmed disease.

The next persistence step is an SQLAlchemy repository backed by PostgreSQL
(with PostGIS for GeoJSON boundaries). Until then, the API keeps the active
profile in process memory and remains useful as a self-contained demo.
