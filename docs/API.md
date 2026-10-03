# API

The API is served at `http://localhost:8000`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/system/status` | Provider availability |
| GET | `/api/demo` | Complete deterministic demo context |
| GET | `/api/dashboard` | Normalized dashboard data |
| POST | `/api/onboarding` | Save farmer/farm/crop profile |
| GET | `/api/farm` | Read the saved farm profile |
| GET | `/api/geocode?q=...` | Search place names with Open-Meteo geocoding |
| GET | `/api/advisory` | Structured recommendation |
| POST | `/api/ai/ask` | Ask the agriculture assistant |
| POST | `/api/disease/analyze` | Analyze an uploaded crop image |
| GET | `/api/permissions` | Current permission metadata |
| GET | `/api/interoperability` | Signed-in account's canonical farm and provider records |

Provider output is mapped to typed observation contracts before it reaches the
frontend. `/api/interoperability` serializes the active account's records in
`AgroAIRecord/v1`, with units, GeoJSON coordinates, timestamps, provenance, and
limitations. It does not claim to connect state datasets that are not
integrated.
