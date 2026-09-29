# AgriAI backend

## Run locally

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
uvicorn app.main:app --reload --app-dir backend
```

The API requests Open-Meteo weather and modelled surface-soil moisture when
`MOCK_MODE=false`. It can use Copernicus Sentinel-2 for near-pin NDVI when
OAuth credentials are configured, and Gemini for chat, advisory translation,
and image/symptom crop triage when `GEMINI_API_KEY` is configured. Failed
providers fall back to labelled demo data; unavailable AI reports an explicit
unavailable response. Configure `FRONTEND_ORIGIN` for a deployed frontend.
Interactive docs are available at `/docs`.

Run the dependency-free backend checks from the repository root with
`PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -v`.
