# Data model and normalization

Pydantic contracts define the API boundary. Provider adapters first map source
responses into the typed weather, soil, and satellite observation models. The
`/api/interoperability` endpoint then emits account-specific `AgroAIRecord/v1`
records; it no longer fabricates state adapters or sample records.

## Canonical record rules

- Spatial points follow GeoJSON/OGC CRS84 order: `[longitude, latitude]`.
- Land area is emitted in hectares (`ha`), converting farmer-entered acres
  with `1 acre = 0.40468564224 ha`. Crop-specific field area stays null when
  the farmer did not enter it; the normalizer never divides or guesses it.
- Weather is emitted in degrees Celsius, millimetres, relative humidity as a
  percent, precipitation probability as a 0–1 ratio, and wind speed in metres
  per second. The displayed unit is included beside each measurement.
- Each record includes its source, record and observation times, quality class,
  units, and any interpretation limits. `live`, `modelled`, `historical`,
  `user-reported`, `simulated`, and `unavailable` are kept distinct.
- Farmer names and email addresses are not included in the interoperability
  feed. Each signed-in user sees only records built from their own farm profile.

## Current coverage and limits

The endpoint currently normalizes a signed-in farmer's profile and the
configured weather, soil, and Bhuvan outputs. Bhuvan LULC is labeled historical
land-cover context, and Open-Meteo soil moisture is labeled modelled rather than
a sensor reading. State government datasets and cross-state connectors are not
integrated yet. The Data network page reports that limit instead of showing
invented state adapters.

Farm profiles are shared between devices through Firestore by the frontend;
the API's SQLite profile is a per-instance working cache. Diagnosis history is
also stored per Firebase UID in Firestore.

`AdvisoryResponse` retains prioritized actions and their reasons.
`DiagnosisResponse` uses cautious assessment language, confidence, and next
steps rather than claiming a confirmed disease.
