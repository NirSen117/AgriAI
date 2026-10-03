import { firebaseAuth } from './firebaseAuth'
import { loadFarmProfile, saveFarmProfile, saveFarmProfileIfMissing } from './farmStore'

export type Location = { latitude: number; longitude: number; village?: string; state?: string }
export type FarmType = 'crops' | 'livestock' | 'mixed'
export type LivestockGroup = { species: 'cattle'|'buffalo'|'goat'|'sheep'|'poultry'|'pig'|'other'; count: number; breed?: string; purpose?: string }
export type FarmField = { name: string; area_acres: number; crop: string; crop_variety?: string; sowing_date?: string; growth_stage?: string; irrigation?: string; soil_type?: string }
export type Profile = { farmer_name: string; farm_name?: string; location: Location; farm_type?: FarmType; land_area_acres: number; soil_type?: string; irrigation?: string; crops: string[]; fields?: FarmField[]; livestock?: LivestockGroup[]; preferred_language?: string; crop_variety?: string; sowing_date?: string; growth_stage?: string; previous_crop?: string }
export type Dashboard = { profile: Profile | null; profile_sync?: 'synced' | 'unavailable'; weather: { temperature_c: number; humidity_percent: number; rainfall_mm: number; rainfall_probability: number; wind_kph: number; source: string }; soil: { ph?: number | null; moisture_percent?: number | null; nitrogen_index?: number | null; organic_carbon_percent?: number | null; source: string }; satellite: { ndvi?: number | null; crop_health: 'poor'|'fair'|'good'|'excellent'|'unavailable'; land_cover?: { code: string; label: string; area_sq_km: number; share_percent: number }[]; cloud_cover_percent?: number | null; observed_at?: string; availability_message?: string | null; source: string }; data_quality: string }
export type Advisory = { summary: string; items: { priority: 'high'|'medium'|'low'; title: string; action: string; reason: string }[]; source: string }
export type Diagnosis = { diagnosis: string; confidence?: number | null; severity: 'low'|'medium'|'high'; actions: string[]; source: string }
export type Interoperability = {
  schema: string
  sources: { name: string; status: 'connected'|'user-reported'|'simulated'|'unavailable'; categories: string[]; record_count: number }[]
  records: { id: string; record_type: string; source: string; quality: string; recorded_at: string; observed_at?: string | null; location?: { type: 'Point'; coordinates: [number, number] } | null; coordinate_reference_system?: string | null; units: Record<string, string>; data: Record<string, unknown>; limitations: string[] }[]
  normalized_count: number
  data_quality: string
  last_sync: string
  limitation: string
}

const profileKey = (uid: string) => `agriai-farm-profile:${uid}`
const localProfile = (uid?: string): Profile | null => {
  if (!uid) return null
  try { const value = localStorage.getItem(profileKey(uid)); return value ? JSON.parse(value) as Profile : null } catch { return null }
}
const unavailableDashboard = (profile: Profile | null): Dashboard => ({
  profile,
  weather: { temperature_c: 0, humidity_percent: 0, rainfall_mm: 0, rainfall_probability: 0, wind_kph: 0, source: 'unavailable' },
  soil: { source: 'unavailable' },
  satellite: { crop_health: 'unavailable', source: 'unavailable' }, data_quality: 'unavailable',
})

async function liveWeather(location: Location) {
  const query = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    daily: 'precipitation_probability_max', forecast_days: '1', timezone: 'auto',
  })
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`)
  if (!response.ok) throw new Error('Weather service unavailable')
  const payload = await response.json()
  const current = payload.current
  if (!current) throw new Error('Weather data unavailable')
  return {
    temperature_c: Number(current.temperature_2m), humidity_percent: Number(current.relative_humidity_2m),
    rainfall_mm: Number(current.precipitation || 0),
    rainfall_probability: Math.max(0, Math.min(1, Number(payload.daily?.precipitation_probability_max?.[0] || 0) / 100)),
    wind_kph: Number(current.wind_speed_10m), source: 'open-meteo',
  }
}
const advisory: Advisory = { summary: 'Your crops are looking healthy. Keep an eye on soil moisture before the next warm spell.', source: 'rules', items: [
  { priority: 'high', title: 'Plan irrigation', action: 'Irrigate cotton for 25 minutes tomorrow morning.', reason: 'Soil moisture is below the ideal range and temperatures are rising.' },
  { priority: 'medium', title: 'Scout for pests', action: 'Walk the north field and check the underside of leaves.', reason: 'Recent humidity can favour early pest activity.' },
  { priority: 'low', title: 'Build soil health', action: 'Add compost around soybean rows after the next rain.', reason: 'Organic carbon is a little below the target for this soil.' },
] }

async function request<T>(path: string, options?: RequestInit, fallback?: T): Promise<T> {
  let response: Response
  try {
    const headers = new Headers(options?.headers)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const idToken = await firebaseAuth.getIdToken()
    if (idToken) headers.set('Authorization', `Bearer ${idToken}`)
    response = await fetch(`/api${path}`, { ...options, headers })
  } catch (error) {
    if (fallback !== undefined) return fallback
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error('Could not connect to the Agro AI backend. Check that Docker is running and try again.')
  }
  if (!response.ok) {
    if (fallback !== undefined) return fallback
    const body = await response.json().catch(() => undefined) as { detail?: unknown } | undefined
    const detail = typeof body?.detail === 'string' ? body.detail : undefined
    throw new Error(detail || `Agro AI request failed (HTTP ${response.status}). Check the backend and proxy logs.`)
  }
  return await response.json() as T
}
export const api = {
  dashboard: async (): Promise<Dashboard> => {
    const uid = firebaseAuth.currentUser()?.uid
    const cached = localProfile(uid)
    let sharedProfile: Profile | null = null
    let firestoreAvailable = false
    if (uid) {
      try { sharedProfile = await loadFarmProfile(uid); firestoreAvailable = true }
      catch { /* Preserve local/legacy behavior while Firestore is not yet configured. */ }
    }
    let dashboard: Dashboard
    if (sharedProfile) {
      localStorage.setItem(profileKey(uid!), JSON.stringify(sharedProfile))
      try { await request('/onboarding', { method: 'POST', body: JSON.stringify(sharedProfile) }) }
      catch { /* Profile remains safely stored in Firestore; dashboard can still show cached data. */ }
    }
    try { dashboard = await request<Dashboard>('/dashboard') }
    catch { dashboard = unavailableDashboard(cached) }
    if (uid && firestoreAvailable && !sharedProfile) {
      const existing = dashboard.profile || cached
      if (existing) {
        try {
          sharedProfile = await saveFarmProfileIfMissing(uid, existing)
          localStorage.setItem(profileKey(uid), JSON.stringify(sharedProfile))
          if (JSON.stringify(sharedProfile) !== JSON.stringify(dashboard.profile)) {
            await request('/onboarding', { method: 'POST', body: JSON.stringify(sharedProfile) })
            dashboard = await request<Dashboard>('/dashboard')
          }
        } catch { firestoreAvailable = false }
      }
    }
    const farmProfile = sharedProfile || dashboard.profile || cached
    dashboard = { ...dashboard, profile: farmProfile, profile_sync: firestoreAvailable ? 'synced' : 'unavailable' }
    if (dashboard.weather.source === 'mock-weather' || dashboard.weather.source === 'unavailable') {
      if (farmProfile) {
        try { dashboard = { ...dashboard, profile: farmProfile, weather: await liveWeather(farmProfile.location) } }
        catch { dashboard = { ...dashboard, profile: farmProfile, weather: { ...unavailableDashboard(farmProfile).weather, source: 'unavailable' } } }
      } else dashboard = { ...dashboard, weather: { ...unavailableDashboard(null).weather, source: 'location-required' } }
    } else if (!dashboard.profile && cached) dashboard = { ...dashboard, profile: cached }
    return dashboard
  },
  advisory: () => request<Advisory>('/advisory', undefined, advisory),
  onboarding: async (profile: Profile) => {
    const uid = firebaseAuth.currentUser()?.uid
    if (!uid) throw new Error('Sign in before saving your farm profile.')
    const result = await request<{ saved: boolean; profile: Profile }>('/onboarding', { method: 'POST', body: JSON.stringify(profile) })
    localStorage.setItem(profileKey(uid), JSON.stringify(profile))
    let synced = false
    try { await saveFarmProfile(uid, profile); synced = true } catch { /* Tell the UI the save is device/backend-only until Firestore is ready. */ }
    return { ...result, synced }
  },
  geocode: async (query: string, signal?: AbortSignal) => {
    let backendResults: { name: string; admin1: string; country: string; latitude: number; longitude: number }[] = []
    try { backendResults = (await request<{ results: typeof backendResults; unavailable?: boolean }>(`/geocode?q=${encodeURIComponent(query)}`, { signal })).results }
    catch { /* Retry through the public geocoder from the browser. */ }
    if (backendResults.length) return { results: backendResults }
    try {
      const params = new URLSearchParams({ name: query, count: '8', language: 'en', format: 'json' })
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { signal })
      if (!response.ok) throw new Error('Place search unavailable')
      const payload = await response.json()
      const results = (payload.results || []).map((place: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }) => ({ name: place.name, admin1: place.admin1 || '', country: place.country || '', latitude: place.latitude, longitude: place.longitude }))
      return { results, unavailable: results.length === 0 }
    } catch { return { results: [], unavailable: true } }
  },
  ask: (question: string, crop?: string, language?: string) => request<{ answer: string; source: string }>('/ai/ask', { method: 'POST', body: JSON.stringify({ question, crop, language }) }),
  diagnose: (symptoms: string, crop?: string, image_url?: string, document_url?: string, language?: string) => request<Diagnosis>('/disease/analyze', { method: 'POST', body: JSON.stringify({ symptoms, crop, image_url, document_url, language }) }),
  permissions: () => request<{ location: boolean; camera: boolean; notifications: boolean; explanation: string }>('/permissions', undefined, { location: false, camera: false, notifications: false, explanation: 'Permissions are optional and only requested after your action.' }),
  interoperability: () => request<Interoperability>('/interoperability'),
}
