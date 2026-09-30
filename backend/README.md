# AgriAI backend

## Run locally

```bash
python -m venv .venv
.venv/bin/pip install -r requirements.txt
uvicorn app.main:app --reload --app-dir backend
```

The API requests Open-Meteo weather and modelled surface-soil moisture when
`MOCK_MODE=false`. The frontend field map can display ISRO/NRSC Bhuvan's public
1:50K LULC WMS imagery without a token. A daily Bhuvan API token enables 1:250K AOI
land-cover statistics near the farm pin; this remains historical context, not
NDVI or current crop health. Gemini provides chat, advisory
translation, and image/symptom crop triage when `GEMINI_API_KEY` is configured.
Unavailable providers are labelled unavailable. Configure `FRONTEND_ORIGIN` for
a deployed frontend.
Interactive docs are available at `/docs`.

Run the dependency-free backend checks from the repository root with
`PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -v`.
