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
| GET | `/api/interoperability` | State adapters and normalized records |

All provider output is normalized before it reaches the frontend.
