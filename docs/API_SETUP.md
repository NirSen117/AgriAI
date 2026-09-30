# API keys and provider setup

## Minimum setup

No API key is needed to run the deterministic demo. Copy `.env.example` to
`.env`. Add only the providers you choose to enable.

| Provider | Key / variable | Where to get it | Free tier or cost |
|---|---|---|---|
| Gemini assistant, translation, and crop-image triage | `GEMINI_API_KEY` | [Google AI Studio API keys](https://aistudio.google.com/app/apikey) | Model availability, quotas, and data-use terms depend on the Google project and selected model. |
| Weather and place search | none | [Open-Meteo](https://open-meteo.com/) | No key for non-commercial use; free service has usage limits and attribution terms. Commercial use needs a paid plan/key. |
| Modelled surface soil moisture | none | [Open-Meteo forecast API](https://open-meteo.com/en/docs) | Same no-key service as weather; model estimate, not a farm sensor reading. |
| ISRO/NRSC Bhuvan LULC AOI statistics | `BHUVAN_API_TOKEN` | [Bhuvan API portal](https://bhuvan-app1.nrsc.gov.in/api/) | Copy the portal's daily access token into the backend `.env`; AOI statistics are historical land-cover context, not live NDVI. |
| ISRO/NRSC Bhuvan land-cover map | none | [Bhuvan WMS guide](https://bhuvan.nrsc.gov.in/wiki/index.php/How_to_use_WMS_services) | The field map also streams public LULC imagery without an API token. |
| SoilGrids / NASA POWER | none | [SoilGrids](https://rest.isric.org/) / [NASA POWER](https://power.larc.nasa.gov/docs/) | Not currently used in the live pipeline. SoilGrids REST v2 is paused by ISRIC; do not rely on it for this demo. |
| Firebase email/password sign-in (optional) | `VITE_FIREBASE_API_KEY` | Firebase Console → Project settings → Your apps → Web app config | Firebase Spark has no-cost Authentication usage within its current limits. This web key identifies the Firebase project and is public by design; restrict it to Firebase APIs and your app domains. |
| Vertex AI Gemini (optional) | `VERTEX_AI_PROJECT`, `VERTEX_AI_LOCATION`, `VERTEX_AI_MODEL` | Google Cloud project with Vertex AI API and Application Default Credentials | Separate Vertex AI quotas/billing; mock AI is used automatically when unavailable. |
| Hugging Face inference (not currently wired into this app) | `HF_TOKEN` | [Hugging Face access tokens](https://huggingface.co/settings/tokens) | Free accounts currently receive small monthly Inference Provider credits; usage beyond those credits can cost money. |

## Enable Gemini

Put the Gemini key in the root `.env`, for example:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash
MOCK_MODE=false
```

Restart the backend (or run `docker compose up --build`) and check
`/api/system/status`. With `MOCK_MODE=false`, weather and modelled surface soil
moisture use Open-Meteo. Bhuvan provides both AOI statistics from its API and a
public WMS layer for the map. To enable AOI statistics, sign in to the
[Bhuvan API portal](https://bhuvan-app1.nrsc.gov.in/api/), copy its current
daily access token, and set these in the root `.env`:

```env
BHUVAN_API_TOKEN=paste_today_s_token_here
BHUVAN_LULC_API_URL=https://bhuvan-app1.nrsc.gov.in/api/lulc250k/curl_lulc250k.php
BHUVAN_LULC_YEAR=2015_16
```

The Bhuvan API token expires daily, so replace `BHUVAN_API_TOKEN` with the new
portal token and restart the backend when it expires. Keep the token only in
the root `.env`; do not paste it into frontend code or logs. The API request
uses a small WKT area around the saved farm pin. AOI statistics are from the
selected LULC mapping cycle and are not current NDVI or a surveyed farm parcel.
The public WMS map still needs recognized state and saved coordinates.
Gemini handles farm chat, advisory translation, and image/symptom triage. If
Gemini has no key or is unreachable, those AI features return an unavailable
message instead of a mock answer.

Gemini API keys are server secrets. Never put `GEMINI_API_KEY` in frontend
code, `VITE_*` variables, screenshots, or Git. The free tier can have different
data-use terms from paid service, so avoid sending farmer names, phone numbers,
precise personal details, or other sensitive information in prompts. See
[Google's current pricing and data-use details](https://ai.google.dev/gemini-api/docs/pricing).

## Vertex AI fallback

To use Vertex AI first, set `VERTEX_AI_PROJECT` and provide Google Application
Default Credentials in the deployment environment. Vertex AI is selected first
when configured. If both Vertex AI and `GEMINI_API_KEY` are present, the Gemini
API is tried automatically when Vertex initialization or a request fails. If
both live providers fail, AgriAI returns a deterministic mock response labeled
`mock-fallback`; the dashboard remains usable.

## Security status and limits

The backend restricts CORS to configured frontend origins, applies API
security headers, rejects oversized requests, validates image data URLs, and
limits AI/diagnosis traffic per client IP. Set `AI_RATE_LIMIT_PER_MINUTE` and
`MAX_REQUEST_BYTES` to adjust the local limits. These in-memory limits are
single-process protections; use a shared rate-limit store behind a trusted
proxy for a multi-instance deployment.

The backend now verifies Firebase ID tokens on farm, dashboard, chat, and crop
diagnosis endpoints. Set `FIREBASE_PROJECT_ID` to the same project ID as
`VITE_FIREBASE_PROJECT_ID`; each saved farm profile is keyed by the verified
Firebase UID. Local SQLite is for development only. Before Cloud Run launch,
move profiles to durable storage such as Firestore because a Cloud Run
container's local filesystem is not persistent across instances or restarts.

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

## ISRO/NRSC Bhuvan API and WMS map

The field map has an **ISRO LULC** layer switch alongside the street map. It
requests public Bhuvan WMS imagery directly for the saved coordinates and state;
no Bhuvan API token or satellite API key is required. Choose the Indian state
when setting up the farm so the map can select the matching WMS layer. If a
state layer is unavailable, the map falls back to the street view.

The dashboard calls the Bhuvan LULC 250K AOI statistics API with the daily
`BHUVAN_API_TOKEN`. The farm pin is expanded into a small WKT polygon; update
the token in `.env` each day and restart the backend. Bhuvan LULC is historical
land-cover context, not current NDVI or crop health. The 250K statistics are
regional context; the public 50K WMS layer remains available on the field map.

The field map keeps an **ISRO LULC** layer switch that uses the public Bhuvan
WMS. It needs saved coordinates and a recognized Indian state, but no token.
