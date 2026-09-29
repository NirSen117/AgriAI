# API keys and provider setup

## Minimum setup

No API key is needed to run the deterministic demo. Copy `.env.example` to
`.env`. Add only the providers you choose to enable.

| Provider | Key / variable | Where to get it | Free tier or cost |
|---|---|---|---|
| Gemini assistant, translation, and crop-image triage | `GEMINI_API_KEY` | [Google AI Studio API keys](https://aistudio.google.com/app/apikey) | Model availability, quotas, and data-use terms depend on the Google project and selected model. |
| Weather and place search | none | [Open-Meteo](https://open-meteo.com/) | No key for non-commercial use; free service has usage limits and attribution terms. Commercial use needs a paid plan/key. |
| Modelled surface soil moisture | none | [Open-Meteo forecast API](https://open-meteo.com/en/docs) | Same no-key service as weather; model estimate, not a farm sensor reading. |
| Sentinel-2 field-health NDVI (optional) | `COPERNICUS_CLIENT_ID`, `COPERNICUS_CLIENT_SECRET` | Create an OAuth client in [Copernicus Data Space](https://dataspace.copernicus.eu/) | Requires an account and OAuth client; Sentinel Hub APIs require OAuth access tokens. Current app samples a small area around the farm pin because farm-boundary polygons are not collected. |
| SoilGrids / NASA POWER | none | [SoilGrids](https://rest.isric.org/) / [NASA POWER](https://power.larc.nasa.gov/docs/) | Not currently used in the live pipeline. SoilGrids REST v2 is paused by ISRIC; do not rely on it for this demo. |
| Firebase email/password sign-in (optional) | `VITE_FIREBASE_API_KEY` | Firebase Console → Project settings → Your apps → Web app config | Firebase Spark has no-cost Authentication usage within its current limits. This web key identifies the Firebase project and is public by design; restrict it to Firebase APIs and your app domains. |
| Vertex AI Gemini (optional) | `VERTEX_AI_PROJECT`, `VERTEX_AI_LOCATION`, `VERTEX_AI_MODEL` | Google Cloud project with Vertex AI API and Application Default Credentials | Separate Vertex AI quotas/billing; mock AI is used automatically when unavailable. |
| Hugging Face inference (not currently wired into this app) | `HF_TOKEN` | [Hugging Face access tokens](https://huggingface.co/settings/tokens) | Free accounts currently receive small monthly Inference Provider credits; usage beyond those credits can cost money. |

## Enable Gemini

Put the Gemini key in the root `.env`, for example:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-2.5-flash
MOCK_MODE=false
```

Restart the backend (or run `docker compose up --build`) and check
`/api/system/status`. With `MOCK_MODE=false`, weather and modelled surface soil
moisture use Open-Meteo. If configured, Copernicus supplies Sentinel-2 NDVI
around the farm pin; otherwise field-health shows a labelled demo estimate.
Gemini handles farm chat, advisory translation, and image/symptom triage. If
Gemini has no key or is unreachable, those AI features return an unavailable
message instead of a mock answer.

Gemini API keys are server secrets. Never put `GEMINI_API_KEY` in frontend
code, `VITE_*` variables, screenshots, or Git. The free tier can have different
data-use terms from paid service, so avoid sending farmer names, phone numbers,
precise personal details, or other sensitive information in prompts. See
[Google's current pricing and data-use details](https://ai.google.dev/gemini-api/docs/pricing).

## Vertex AI fallback

To use Vertex AI instead of the Gemini API key, set `VERTEX_AI_PROJECT` and
provide Google Application Default Credentials in the deployment environment.
Vertex AI is selected first when configured. If initialization or a request
fails, AgriAI automatically returns a deterministic mock response and labels
the source as `mock-fallback`; the dashboard remains usable.

## Security status and limits

The backend restricts CORS to configured frontend origins, applies API
security headers, rejects oversized requests, validates image data URLs, and
limits AI/diagnosis traffic per client IP. Set `AI_RATE_LIMIT_PER_MINUTE` and
`MAX_REQUEST_BYTES` to adjust the local limits. These in-memory limits are
single-process protections; use a shared rate-limit store behind a trusted
proxy for a multi-instance deployment.

The current saved farm profile is a single shared local profile, and the
Firebase sign-in widget is not yet verified by the backend. Do not expose this
prototype as a multi-user service until backend identity checks and per-user
farm ownership are implemented. The current SQLite file is for local/demo use;
production deployment needs durable, user-scoped database storage.

## Firebase sign-in setup

1. In Firebase Console, enable **Authentication → Sign-in method → Email/Password** and **Google**.
2. Register a Web app and copy its Firebase Web API key into
   `frontend/.env.local` as `VITE_FIREBASE_API_KEY`.
3. Add the remaining web-app values to `frontend/.env.local`:

   ```env
   VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=your-project
   VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
   VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   VITE_FIREBASE_APP_ID=your-web-app-id
   VITE_FIREBASE_MEASUREMENT_ID=your-measurement-id
   ```

4. Under **Authentication → Settings → Authorized domains**, ensure `localhost`
   is enabled for local development. When you host the site later, add that
   final domain then; no hosted domain is needed for local use.
5. Restrict the key to Firebase APIs and the deployed frontend domains, then
   restart Vite. Firebase API keys identify the project; authentication and
   access control come from Firebase Auth and server-side token verification.

The sign-in dialog presents Google and email options. Email sign-in asks for
the farmer's name and saves it to the Firebase Auth profile; Google sign-in
uses the Google account name. The dashboard greeting uses that signed-in name
instead of the seeded demo farmer name. On narrow/mobile screens, Google uses
Firebase's redirect flow; on desktop it uses a popup. The mobile header keeps
a visible **Sign in** label so the dialog is discoverable.

## Copernicus Sentinel-2 setup

1. Create an account in [Copernicus Data Space Ecosystem](https://dataspace.copernicus.eu/) and register an OAuth client.
2. Put its client ID and secret in the backend root `.env`:

   ```env
   COPERNICUS_CLIENT_ID=your-client-id
   COPERNICUS_CLIENT_SECRET=your-client-secret
   ```

3. Restart the backend. `/api/system/status` should report the satellite
   provider as `live`.

The current implementation calculates a 30-day NDVI average over a small
roughly 200 m square around the saved farm coordinate, not a surveyed field
boundary. The returned crop-health category is an NDVI proxy and is not a
disease diagnosis. Copernicus REST credentials are kept on the backend.
