# Deployment

## Local

Run `cp .env.example .env`, then `docker compose up --build`. Without Docker,
install the backend requirements and run `uvicorn app.main:app --reload` from
`backend`, and run `npm install && npm run dev` from `frontend`.

## Hugging Face Docker Space

The root `Dockerfile` builds the frontend, starts FastAPI on an internal port,
and serves the React app through nginx on port `7860`. Create a Space with the
Docker SDK, push this repository, and add `GEMINI_API_KEY` under **Settings →
Variables and secrets**. Add `MOCK_MODE=false` and `GEMINI_MODEL=gemini-2.5-flash`
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
