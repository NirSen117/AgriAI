# Provider options

These are practical free or open-data integrations for the next build stage.
Add calls behind a backend provider interface; do not call them directly from the browser.

| Need | Provider | Authentication | Notes |
|---|---|---|---|
| Weather forecast | [Open-Meteo](https://open-meteo.com/en/docs) | None | Already integrated for live weather. Cache requests by location. |
| Soil properties | [ISRIC SoilGrids](https://rest.isric.org/soilgrids/v2.0/docs) | None | Use for baseline soil attributes, not live moisture. Its beta REST service has a fair-use limit and downtime risk. |
| Climate history | [NASA POWER](https://power.larc.nasa.gov/docs/services/api/) | None | Good for historical weather and seasonal planning. |
| Satellite imagery / NDVI | [Copernicus Data Space Ecosystem](https://documentation.dataspace.copernicus.eu/APIs.html) | Free account for most processing | Use Sentinel-2 and an NDVI calculation; start with one field and a scheduled backend job. |
| Geocoding | [Nominatim](https://nominatim.org/release-docs/latest/api/Overview/) | None | Respect its usage policy; self-host or use a paid service for scale. |
| Crop disease models | [PlantVillage dataset](https://github.com/spMohanty/PlantVillage-Dataset) | None | Open dataset for training/evaluation, not a ready-to-use diagnostic API. Validate models locally before advice. |
| Government market data | [data.gov.in](https://data.gov.in/) | API key | Many Indian agricultural datasets are available; select a stable dataset and cache responses. |

For production, prioritize Open-Meteo plus a field-owned sensor for actual moisture, then add satellite NDVI. Avoid treating SoilGrids or an image model as a real-time diagnosis.
