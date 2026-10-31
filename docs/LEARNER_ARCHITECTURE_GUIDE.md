# Agro AI — learner and architecture guide

## What this project does

Agro AI is a mobile-first agricultural decision-support web app aimed at farmers in India. A signed-in farmer maintains one or more farm profiles with location, crops/fields, and optional livestock. The dashboard combines that profile with weather, modelled surface-soil moisture, historical land-cover context, market observations, and AI-assisted questions or crop triage.

The UI must distinguish measured observations, model estimates, historical context, demo fallbacks, and unavailable data. Advice is informational and should not be presented as a guaranteed diagnosis or yield/price promise.

## Why this architecture

- **React + TypeScript + Vite** gives a quick, responsive client and typed API contracts. It is straightforward to develop locally and bundles into static files for container deployment.
- **FastAPI + Pydantic** keeps provider credentials and integration logic on the server, validates input/output schemas, exposes OpenAPI docs, and makes provider data normalization explicit.
- **Provider adapters** isolate external services. Weather, soil, satellite, AI, disease triage, and market feeds can fail or be replaced without forcing provider-specific response formats into the UI.
- **Firebase Authentication and Firestore** provide user identity and cross-device storage. Profiles are associated with Firebase UIDs and farm selection is persisted. The frontend uses local storage only as a local cache.
- **One production container** builds the frontend, runs FastAPI, and uses nginx to serve static assets and proxy API/auth helper routes. This keeps the deployed app at one origin and supports Firebase redirect sign-in on mobile browsers.
- **Docker Compose** runs frontend and backend separately for development, with a named volume for local backend data.

## How components interact

```text
Browser (React/Vite)
  ├─ Firebase Auth: sign-in and Firebase ID token
  ├─ Firestore: farm profiles, active farm selection, diagnosis history
  └─ /api requests with ID token
       ↓
FastAPI (Pydantic routes and auth verification)
  ├─ Loads active farm context and builds dashboard/advice
  ├─ Provider adapters: Open-Meteo, Bhuvan, Gemini/Vertex, data.gov.in
  ├─ Normalizes provenance, units, timestamps, quality and limitations
  └─ Returns typed JSON to the browser

Production container: nginx serves React static build and proxies API/auth paths
```

Firebase ID tokens are verified against Firebase's published signing certificates. A service-account JSON private key is not needed for this verification. Firestore client access is governed by `firestore.rules`.

The backend's SQLite database is suitable only for local or legacy compatibility. Cloud Run instances have ephemeral local filesystems; Firestore is the durable store for cross-device farm data.

## Main folders and files

- `frontend/src/App.tsx`: application shell, navigation, dashboard state, field/profile interactions, and major views.
- `frontend/src/api.ts`: typed API contracts, API calls, profile synchronization, and local fallback behavior.
- `frontend/src/farmStore.ts`: Firestore farm profile collection, migration, active farm selection, and profile writes.
- `frontend/src/firebaseAuth.ts`: Firebase setup and email/Google sign-in.
- `backend/app/main.py`: FastAPI routes, authentication dependency, dashboard composition, and local compatibility storage.
- `backend/app/providers.py`: provider interfaces and implementations.
- `backend/app/schemas.py`: Pydantic response/request models.
- `backend/app/advisory.py`: deterministic advisory/rule selection.
- `firestore.rules`: per-user Firestore access control.
- `Dockerfile`, `docker-compose.yml`, `deploy/`: local and production container setup.
- `cloudbuild.yaml`: production image build/push with Firebase web configuration substitutions.
- `docs/`: API, architecture, setup, deployment, and data model references. `AGENT_HANDOFF.md` and `LOCAL_CHANGELOG.md` are local-only.

## Dependencies

### Frontend

Node.js 22 is the project's documented runtime. Dependencies are defined in `frontend/package.json` and pinned by `frontend/package-lock.json`: React 18, TypeScript, Vite, Firebase JS SDK, and lucide-react.

```sh
cd frontend
npm ci
npm run dev
npm run build
npm run preview
```

### Backend

Python 3.12 is the documented runtime. Dependencies are in `backend/requirements.txt`: FastAPI, Uvicorn, Pydantic/Pydantic Settings, Google GenAI, and PyJWT with crypto support.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
PYTHONPATH=backend .venv/bin/uvicorn app.main:app --reload
```

OpenAPI docs are available at `http://localhost:8000/docs` while the API is running.

### Docker / container environment

Docker Engine and the Compose plugin are the recommended full-stack local environment. From repository root:

```sh
cp .env.example .env
cp frontend/.env.example frontend/.env.local
docker compose up --build
```

Open `http://localhost:5173`. The backend is exposed at `http://localhost:8000`. Compose uses a named `agriai-data` volume for local backend data. Stop with Ctrl+C; `docker compose down` stops containers. Avoid `docker compose down -v` unless you intentionally want to delete the named local data volume.

For the combined production-style image:

```sh
docker build -t agro-ai .
docker run --rm -p 7860:7860 --env-file .env agro-ai
```

The image listens on port 7860. Firebase frontend `VITE_FIREBASE_*` values must be supplied at build time as documented in `cloudbuild.yaml`/`docs/DEPLOYMENT.md`; API secrets remain runtime server settings and must never be frontend build args.

## Configuration and integrations

- Copy `.env.example` to `.env` for backend settings. The deterministic demo can run without provider credentials; configure only integrations you intend to use.
- Copy `frontend/.env.example` to `frontend/.env.local` and add Firebase web-app configuration for authentication. These web identifiers are public configuration, but the file remains local and ignored.
- Gemini API key, Bhuvan daily token, and data.gov.in API key are server-side secrets. In production, use Secret Manager references; do not commit, print, or paste their values into chat/logs.
- Open-Meteo needs no key for the documented non-commercial use path. Bhuvan WMS is public; Bhuvan AOI statistics use a daily token and historical LULC mapping cycle.
- Vertex AI is optional; production has historically used Gemini API mode.
- See `docs/API_SETUP.md` and `docs/DEPLOYMENT.md` for up-to-date provider and deployment details.

## Build and validation

Frontend production build:

```sh
cd frontend && npm run build
```

Dependency-free backend checks:

```sh
PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -v
```

The build output is `frontend/dist/` and is generated; do not include it in source backups. `node_modules`, virtual environments, local SQLite data, `.env` files, and `.git` are also excluded from the requested sanitized archive.

## Operational caveats and learning path

1. Trace a UI call from a component to `frontend/src/api.ts`, then to its FastAPI route in `backend/app/main.py`.
2. Follow the route into provider interfaces and inspect how fallback/source labels are preserved.
3. Read `backend/app/schemas.py` to see the JSON contracts and provenance fields.
4. Read `firestore.rules` alongside `frontend/src/farmStore.ts` before changing data paths or access.
5. Use the existing public production hostname consistently for Firebase auth domain, nginx proxy, and OAuth redirect URI.
6. Never treat Bhuvan's historical LULC layer or modelled soil values as live farm measurements.
7. Before deployment, inspect current Cloud Run configuration and secret references; do not replace the service with a partial environment.
