# AgriAI frontend

The AgriAI frontend is a mobile-first Vite + React + TypeScript dashboard for farm, weather, soil, field-health and crop-diagnosis workflows.

## Run locally

```bash
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5173` and proxies `/api` to the FastAPI service at `http://localhost:8000`. If the API is unavailable, the typed service in `src/api.ts` uses clearly labelled deterministic demo data, so the UI remains usable during development.

## Build

```bash
npm run build
npm run preview
```

No API keys are sent to the browser. Browser permissions are requested only after the user enables them in the Permissions center.
