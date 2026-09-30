# Deployment

## Local

Run `cp .env.example .env`, then `docker compose up --build`. Without Docker,
install the backend requirements and run `uvicorn app.main:app --reload` from
`backend`, and run `npm install && npm run dev` from `frontend`.

The backend requires Firebase ID tokens for farm data, chat, and crop diagnosis.
Set `FIREBASE_PROJECT_ID` in `.env` to the same project ID as
`VITE_FIREBASE_PROJECT_ID`. The backend checks token signatures against
Firebase's published signing certificates and validates the project, issuer,
expiry, and UID. This does not need gcloud ADC or a service-account key. Local
Docker therefore does not mount host gcloud credentials.

## Google Cloud Run

Build the combined frontend/backend image from the repository root and deploy
that image as a Cloud Run service. Set `MOCK_MODE=false`, the Firebase project
ID, and required provider settings. Store `GEMINI_API_KEY` and `BHUVAN_API_TOKEN`
in Secret Manager and map them as Cloud Run secrets. Attach a dedicated runtime
service account with the minimum roles needed for Vertex AI and secret access;
do not upload or use a service-account JSON key. Firebase ID-token verification
uses Firebase's public signing certificates and does not require a private
service-account key. SQLite is not durable across Cloud Run instances, so
profiles must move to Firestore or another persistent database before a
multi-user production launch.

The root Dockerfile builds Firebase's browser configuration into the static
frontend. Supply the seven `VITE_FIREBASE_*` values from the Firebase web app
configuration as Docker build arguments when building the image. For production
on Cloud Run, set `VITE_FIREBASE_AUTH_DOMAIN` to the exact Cloud Run hostname
users open (currently `agriai-273532640183.asia-south1.run.app`). Nginx proxies
`/__/auth/` to this Firebase project's sign-in helper so Android Chrome and
other browsers that block third-party storage can complete Google redirect
sign-in. Keep the Firebase `firebaseapp.com` auth domain for local Vite dev
unless you also configure a same-origin proxy there.

These Firebase values identify the web app and are public; never pass
`GEMINI_API_KEY` or `BHUVAN_API_TOKEN` as frontend build arguments. Add the
Cloud Run hostname to **Firebase Console → Authentication → Settings →
Authorized domains**. Also add
`https://agriai-273532640183.asia-south1.run.app/__/auth/handler` to the
authorized redirect URIs of the Google OAuth web client used by Firebase Auth.
If the app is opened at a different Cloud Run hostname, use that same hostname
as `VITE_FIREBASE_AUTH_DOMAIN`, proxy target origin, Firebase authorized domain,
and OAuth redirect URI.

## Hugging Face Docker Space

The root `Dockerfile` builds the frontend, starts FastAPI on an internal port,
and serves the React app through nginx on port `7860`. Create a Space with the
Docker SDK, push this repository, and add `GEMINI_API_KEY` under **Settings →
Variables and secrets**. Add `MOCK_MODE=false` and `GEMINI_MODEL=gemini-3.5-flash`
as variables if you want live weather and Gemini; the app still works with
mock mode enabled.

```bash
git remote add hf https://huggingface.co/spaces/YOUR_USER/YOUR_SPACE
git push hf main
```

The Space URL will be `https://YOUR_USER-YOUR_SPACE.hf.space`. Never commit
`.env`; Hugging Face secrets are injected at runtime. For Cloud Run, deploy
the same root image and set `FRONTEND_ORIGIN` to the public frontend origin.

For Firebase sign-in in the Space, add the `VITE_FIREBASE_*` values as Space
variables before rebuilding. They are browser configuration values, not Gemini
secrets. Add `GEMINI_API_KEY` as a **Secret**, not a variable.

If using Vertex AI, configure `VERTEX_AI_PROJECT`, `VERTEX_AI_LOCATION`, and
`VERTEX_AI_MODEL` as variables and attach an appropriate Google identity to the
runtime. If Vertex AI or Gemini is missing, invalid, quota-limited, or
unavailable, the backend automatically uses the mock AI and disease providers.
