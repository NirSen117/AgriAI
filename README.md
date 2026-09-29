---
title: AgriAI
sdk: docker
app_port: 7860
---

# AgriAI

AgriAI is a mobile-first, provider-agnostic agricultural decision-support
prototype for small and marginal farmers in India. It turns farm context,
weather, soil, field-health observations, and crop images into explainable
actions while keeping external integrations replaceable.

## What works without credentials

The app requests live Open-Meteo weather and modelled surface-soil moisture by
default. If those requests fail, it falls back to clearly labelled demo values.
Copernicus Sentinel-2 field-health data is used when its OAuth credentials are
configured; otherwise the app labels its field-health value as a demo estimate.
Gemini provides farm chat, advisory translation, and crop-image triage when
`GEMINI_API_KEY` is configured.

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:5173>. For local development, see
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Architecture

```text
React/Vite -> FastAPI routes -> normalized provider interfaces
                         |-> Weather / Soil / Climate / Satellite adapters
                         |-> AI and disease adapters
                         |-> Advisory + regenerative rules
                         |-> interoperability adapters
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/API.md`](docs/API.md), and [`docs/API_SETUP.md`](docs/API_SETUP.md).

## Privacy and limitations

Location is optional and manual entry is always available. Browser permissions
are requested only after an explicit user action. API keys remain server-side.
The prototype uses simulated data by default and recommendations are decision
support, not a confirmed diagnosis or a substitute for a local agronomist.
