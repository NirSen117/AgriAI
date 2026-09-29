import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, Bell, Bot, Camera, Check, ChevronRight, CloudSun, Droplets, Gauge, Home, Leaf, MapPin, Menu, MessageCircle, Plus, ShieldCheck, Sprout, Sun, Thermometer, Upload, UserRound, Wind, X } from 'lucide-react'
import { api, Advisory, Dashboard, Diagnosis, Profile } from './api'
import { AuthModal } from './AuthModal'
import { AuthUser, firebaseAuth } from './firebaseAuth'
import { languages, t } from './i18n'

type Page = 'overview' | 'fields' | 'advice' | 'permissions'
const nav = [{ id: 'overview' as Page, key: 'overview' as const, icon: Home }, { id: 'fields' as Page, key: 'fields' as const, icon: Sprout }, { id: 'advice' as Page, key: 'advice' as const, icon: Leaf }, { id: 'permissions' as Page, key: 'permissions' as const, icon: ShieldCheck }]
const dataNotice = (dashboard: Dashboard) => {
  const weather = dashboard.weather.source === 'open-meteo' ? 'Live weather' : dashboard.weather.source === 'mock-weather' ? 'Demo weather (mock mode)' : dashboard.weather.source === 'location-required' ? 'Set your farm location to get local weather' : 'Weather unavailable right now'
  const soil = dashboard.soil.source.includes('open-meteo') ? 'modelled soil moisture' : 'demo soil values'
  const field = dashboard.satellite.source.startsWith('copernicus') ? 'Sentinel-2 NDVI near the farm pin' : 'demo field-health estimate'
  return `${weather} · ${soil} · ${field}`
}

function App() {
  const [page, setPage] = useState<Page>('overview')
  const [dashboard, setDashboard] = useState<Dashboard>()
  const [advice, setAdvice] = useState<Advisory>()
  const [farmAnalysis, setFarmAnalysis] = useState<{ answer: string; source: string }>()
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [diagnosis, setDiagnosis] = useState(false)
  const [assistant, setAssistant] = useState(false)
  const [authUser, setAuthUser] = useState<AuthUser | undefined>(() => firebaseAuth.currentUser())
  const [authReady, setAuthReady] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => {
    return firebaseAuth.subscribe(user => { setAuthUser(user); setAuthReady(true) })
  }, [])
  useEffect(() => {
    if (!authUser) { setDashboard(undefined); setAdvice(undefined); return }
    Promise.all([api.dashboard(), api.advisory()]).then(([nextDashboard, nextAdvice]) => {
      setDashboard(nextDashboard); setAdvice(nextAdvice)
      setNotice(dataNotice(nextDashboard))
      if (!nextDashboard.profile) setShowOnboarding(true)
    })
  }, [authUser?.uid])
  const runAnalysis = async (includeGemini = true) => {
    setAnalysisLoading(true)
    if (includeGemini) setFarmAnalysis(undefined)
    setNotice(includeGemini ? 'Refreshing farm data and asking Gemini…' : 'Refreshing farm data…')
    try {
      const [nextDashboard, nextAdvice] = await Promise.all([api.dashboard(), api.advisory()])
      setDashboard(nextDashboard); setAdvice(nextAdvice)
      if (includeGemini && nextDashboard.profile) {
        const result = await api.ask('Analyze my farm using the current data. Clearly distinguish live measurements from estimates, state what data is missing, and give three short prioritized actions for my crop and farm. Do not invent measurements.', nextDashboard.profile.crops[0])
        setFarmAnalysis(result)
        setNotice(`${dataNotice(nextDashboard)} · ${result.source === 'gemini' ? 'Gemini farm analysis ready' : 'Gemini unavailable'}`)
      } else if (includeGemini) {
        setNotice('Finish setting up your farm before running a farm analysis.')
      } else {
        setNotice(dataNotice(nextDashboard))
      }
    } catch {
      setNotice('Farm analysis could not reach the API. Start the backend container and try again.')
    } finally { setAnalysisLoading(false) }
  }
  const profile = dashboard?.profile
  const language = profile?.preferred_language || 'en'
  const firstName = authUser?.displayName?.trim().split(/\s+/)[0] || profile?.farmer_name?.split(' ')[0] || 'Farmer'
  if (!authReady) return <main className="auth-gate"><div className="auth-gate-card"><Logo/><p>Checking your sign-in…</p></div></main>
  if (!authUser) return <main className="auth-gate"><div className="auth-gate-card"><Logo/><span className="eyebrow">FARMER ACCOUNT</span><h1>Sign in to AgriAI</h1><p>Log in or create an account to see your farm dashboard and personalized advice.</p><button className="primary-button" onClick={() => setShowAuth(true)}>Sign in or create an account <ArrowRight size={16}/></button></div>{showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuthenticated={user => { setAuthUser(user); setShowAuth(false) }} />}</main>
  return <div className="app-shell">
    <aside className="sidebar">
      <Logo />
      <div className="farm-switcher"><div className="avatar">{firstName[0]}</div><div><strong>{profile?.farm_name || 'My farm'}</strong><small>{profile?.location.village || 'Set up your farm'}</small></div><ChevronRight size={16}/></div>
      <nav>{nav.map(item => <button className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)} key={item.id}><item.icon size={19}/><span>{t(language, item.key)}</span></button>)}</nav>
      <div className="sidebar-bottom"><button onClick={() => setShowOnboarding(true)} className="outline-button"><Plus size={17}/> Add field</button><small className="privacy"><ShieldCheck size={14}/> Your data stays yours</small></div>
    </aside>
    <main>
      <header className="topbar"><button className="mobile-menu" aria-label="Open menu"><Menu size={22}/></button><div className="breadcrumb"><span>{t(language, 'overview')}</span><span className="dot">·</span><span className="muted">{profile?.location.village || 'Set up farm location'}</span></div><div className="top-actions"><button className="icon-button" aria-label="Notifications"><Bell size={19}/><i/></button><button className="profile-button" onClick={() => authUser ? firebaseAuth.signOut() : setShowAuth(true)}><div className="avatar small">{authUser?.email[0]?.toUpperCase() || firstName[0]}</div><span className="auth-label">{authUser?.email || 'Sign in'}</span><ChevronRight size={15}/></button></div></header>
      <div className="page">
        {notice && <div className="demo-banner"><span><span className="status-dot"/> {notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}
        {page === 'overview' && <Overview dashboard={dashboard} advice={advice} farmAnalysis={farmAnalysis} analysisLoading={analysisLoading} language={language} greetingName={firstName} onDiagnose={() => setDiagnosis(true)} onAsk={() => setAssistant(true)} onOnboard={() => setShowOnboarding(true)} onAnalyze={() => runAnalysis()} />}
        {page === 'fields' && <Fields dashboard={dashboard} language={language} onDiagnose={() => setDiagnosis(true)} onOnboard={() => setShowOnboarding(true)} />}
        {page === 'advice' && <Advice advice={advice} language={language} />}
        {page === 'permissions' && <Permissions language={language} />}
      </div>
    </main>
    <div className="mobile-nav">{nav.slice(0, 4).map(item => <button className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)} key={item.id}><item.icon size={18}/><span>{t(language, item.key)}</span></button>)}</div>
    {showOnboarding && <Onboarding profile={profile} authName={authUser.displayName} language={language} onClose={() => setShowOnboarding(false)} onSaved={async p => { setShowOnboarding(false); await runAnalysis(false); setDashboard(d => d ? { ...d, profile: p } : d) }} />}
    {diagnosis && <DiagnosisModal crop={profile?.crops[0]} language={language} onClose={() => setDiagnosis(false)} />}
    {assistant && <Assistant crop={profile?.crops[0]} language={language} onClose={() => setAssistant(false)} />}
    {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuthenticated={user => { setAuthUser(user); setShowAuth(false) }} />}
  </div>
}

function Logo() { return <div className="logo"><span className="logo-mark"><Sprout size={20}/></span><span>agri<strong>ai</strong></span></div> }
function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) { return <div className="section-header">{<div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>}{action}</div> }
function Overview({ dashboard, advice, farmAnalysis, analysisLoading, language, greetingName, onDiagnose, onAsk, onOnboard, onAnalyze }: { dashboard?: Dashboard; advice?: Advisory; farmAnalysis?: { answer: string; source: string }; analysisLoading: boolean; language: string; greetingName: string; onDiagnose: () => void; onAsk: () => void; onOnboard: () => void; onAnalyze: () => void }) {
  const d = dashboard
  const farm = d?.profile
  const hasCrops = !!farm?.crops.length
  const cropSummary = hasCrops ? farm!.crops.join(' · ') : `${farm?.livestock?.length || 0} ${t(language, 'livestockGroups').toLowerCase()}`
  const field = farm?.fields?.[0]
  return <><div className="welcome"><div><span className="eyebrow">{t(language, 'farmLocation').toUpperCase()} · {farm?.location.state || 'LOCATION NOT SET'}</span><h1>Good morning, {greetingName} <span>👋</span></h1><p>{new Date().toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' })} · {t(language, 'farmAdvice')}</p></div><div className="welcome-actions"><button className="secondary-button" disabled={analysisLoading} onClick={onAnalyze}><Sprout size={17}/> {analysisLoading ? 'Analyzing…' : t(language, 'runAnalysis')}</button>{hasCrops && <button className="primary-button" onClick={onDiagnose}><Camera size={17}/> {t(language, 'diagnoseCrop')}</button>}</div></div>
    <div className="quick-stats"><Stat icon={<MapPin/>} label={t(language, 'farmLocation')} value={farm?.location.village || '—'} note={farm?.location.state || ''} /><Stat icon={<Sprout/>} label={hasCrops ? t(language, 'activeCrops') : t(language, 'livestockGroups')} value={String(hasCrops ? farm?.crops.length || 0 : farm?.livestock?.reduce((sum, group) => sum + group.count, 0) || 0)} note={cropSummary} /><Stat icon={<Gauge/>} label={hasCrops ? 'NDVI' : t(language, 'fieldHealth')} value={hasCrops && d?.satellite.ndvi != null ? d.satellite.ndvi.toFixed(2) : '—'} note={hasCrops ? (d?.satellite.source?.startsWith('copernicus') ? 'Sentinel-2 near farm pin' : 'Demo estimate') : 'Crop field data not set'} tone="green" /></div>
    <SectionHeader eyebrow="FIELD PULSE" title={t(language, 'currentConditions')} action={<button className="text-button" onClick={onAsk}>{t(language, 'askAI')} <ArrowRight size={15}/></button>} />
    <div className="insights-grid"><Weather d={d} language={language}/>{hasCrops && <Soil d={d} language={language} />}{hasCrops && <Health d={d} language={language} />}</div>
    {farmAnalysis && <div className={`farm-analysis-result ${farmAnalysis.source === 'gemini' ? '' : 'unavailable'}`}><div><Bot size={18}/><strong>Farm analysis</strong><small>{farmAnalysis.source === 'gemini' ? 'Gemini' : 'Gemini unavailable'}</small></div><p>{farmAnalysis.answer}</p></div>}
    <div className="content-grid"><section><SectionHeader eyebrow="RECOMMENDED FOR YOU" title={t(language, 'todaysActions')} />{advice?.items.slice(0, 2).map((item, i) => <ActionCard key={item.title} item={item} index={i}/>)}</section><section><SectionHeader eyebrow={t(language, 'yourFields').toUpperCase()} title={field?.name || t(language, 'fields')} action={<button className="text-button" onClick={onOnboard}>Manage <ArrowRight size={15}/></button>} /><div className="field-card"><div className="field-map"><div className="map-grid"/><span className="map-pin"><MapPin size={19}/></span><span className="field-tag">{field ? `${field.name} · ${field.area_acres} ac` : 'No field recorded'}</span></div><div className="field-details"><div><strong>{field?.name || t(language, 'livestockGroups')}</strong><span className="healthy"><span className="status-dot"/> {farm?.farm_type || 'crops'}</span></div><small>{field ? `${field.crop}${field.growth_stage ? ` · ${field.growth_stage}` : ''}` : (farm?.livestock || []).map(a => `${a.count} ${a.species}`).join(' · ')}</small><div className="field-meta"><span>Moisture <b>{hasCrops && d?.soil.moisture_percent != null ? `${Math.round(d.soil.moisture_percent)}%` : '—'}</b></span><span>NDVI <b>{hasCrops && d?.satellite.ndvi != null ? d.satellite.ndvi.toFixed(2) : '—'}</b></span></div></div></div></section></div>
  </>
}
function Stat({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note: string; tone?: string }) { return <div className="stat-card"><span className={`stat-icon ${tone || ''}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><span className="muted">{note}</span></div></div> }
function Weather({ d, language }: { d?: Dashboard; language: string }) {
  const weather = d?.weather
  const available = !!weather && weather.source !== 'unavailable' && weather.source !== 'location-required'
  return <div className="pulse-card weather-card"><div className="card-top"><div><span className="eyebrow">{t(language, 'weather').toUpperCase()} · {(weather?.source || 'unavailable').toUpperCase()}</span><h3>{available ? weather!.temperature_c : '—'}{available && <small>°C</small>}</h3><p>{available ? t(language, 'currentConditions') : weather?.source === 'location-required' ? 'Add your farm location to see local conditions.' : 'Live weather is temporarily unavailable.'}</p></div><CloudSun className="weather-icon"/></div><div className="weather-row"><span><Droplets size={15}/> {available ? `${weather!.humidity_percent}%` : '—'}</span><span><Wind size={15}/> {available ? `${weather!.wind_kph} km/h` : '—'}</span></div><div className="rain-note"><span className="status-dot yellow"/> {t(language, 'rainChance')} · {available ? `${Math.round(weather!.rainfall_probability * 100)}%` : '—'}</div></div>
}
function Soil({ d, language }: { d?: Dashboard; language: string }) {
  const moisture = d?.soil.moisture_percent
  const source = d?.soil.source || 'unavailable'
  const note = source.includes('open-meteo') ? 'Modelled surface moisture; not a field sensor reading.' : source.includes('mock') ? 'Demo fallback value; no field sensor reading.' : 'Soil moisture unavailable.'
  return <div className="pulse-card"><div className="card-top"><div><span className="eyebrow">{t(language, 'soilMoisture').toUpperCase()} · {source}</span><h3>{moisture != null ? Math.round(moisture) : '—'}{moisture != null && <small>%</small>}</h3><p><span className="status-dot yellow"/> {source.includes('mock') ? 'Demo value' : source.includes('open-meteo') ? 'Weather-model estimate' : 'Unavailable'}</p></div><Droplets className="card-art blue"/></div><div className="meter"><span style={{ width: `${moisture ?? 0}%` }}/></div><div className="mini-note">{note}</div></div>
}
function Health({ d, language }: { d?: Dashboard; language: string }) {
  const ndvi = d?.satellite.ndvi
  const source = d?.satellite.source || 'unavailable'
  const health = d?.satellite.crop_health
  const healthLabel = ndvi == null || !health ? 'Unavailable' : `${health[0].toUpperCase()}${health.slice(1)}`
  return <div className="pulse-card"><div className="card-top"><div><span className="eyebrow">{t(language, 'fieldHealth').toUpperCase()} · {source}</span><h3>{healthLabel}</h3><p><span className="status-dot green"/> {source.startsWith('copernicus') ? 'Satellite NDVI proxy' : 'Demo estimate'}</p></div><Leaf className="card-art green"/></div><div className="meter"><span style={{ width: `${ndvi == null ? 0 : Math.max(0, ndvi) * 100}%` }}/></div><div className="mini-note">{ndvi == null ? 'No satellite measurement available.' : `NDVI ${ndvi.toFixed(2)} near the farm pin; not a parcel-level diagnosis.`}</div></div>
}
function ActionCard({ item, index }: { item: Advisory['items'][number]; index: number }) { return <div className="action-card"><div className={`action-number n${index}`}>{index === 0 ? <Droplets size={18}/> : <Leaf size={18}/>}</div><div><div className="action-title"><strong>{item.title}</strong><span className={`priority ${item.priority}`}>{item.priority}</span></div><p>{item.action}</p><small>{item.reason}</small></div><ChevronRight className="action-arrow" size={18}/></div> }
function Fields({ dashboard, language, onDiagnose, onOnboard }: { dashboard?: Dashboard; language: string; onDiagnose: () => void; onOnboard: () => void }) {
  const profile = dashboard?.profile
  const hasCrops = !!profile?.crops.length
  return <><div className="welcome"><div><span className="eyebrow">{t(language, 'fields').toUpperCase()}</span><h1>{t(language, 'fields')}</h1><p>{profile?.farm_name || profile?.farm_type}</p></div><button className="primary-button" onClick={onOnboard}><Plus size={17}/> {t(language, 'fieldName')}</button></div><div className="fields-grid"><div className="large-field field-card"><div className="field-map"><div className="map-grid"/><span className="map-pin"><MapPin size={19}/></span><span className="field-tag">{profile?.fields?.[0]?.name || '—'} · {profile?.fields?.[0]?.area_acres || 0} acres</span></div><div className="field-details"><div><strong>{profile?.fields?.[0]?.name || t(language, 'livestockGroups')}</strong><span className="healthy"><span className="status-dot"/> {profile?.farm_type}</span></div><small>{profile?.fields?.map(field => `${field.crop} · ${field.name}`).join(' | ') || 'No crop fields recorded'}</small>{hasCrops && <div className="field-meta"><span>{t(language, 'soilMoisture')} <b>{dashboard?.soil.moisture_percent != null ? `${Math.round(dashboard.soil.moisture_percent)}%` : '—'}</b></span><span>NDVI <b>{dashboard?.satellite.ndvi != null ? dashboard.satellite.ndvi.toFixed(2) : '—'}</b></span></div>}</div></div><div className="field-summary"><h3>{t(language, 'livestockGroups')}</h3>{(profile?.livestock || []).map((group, index) => <p key={`${group.species}-${index}`} className="animal-summary"><strong>{group.count} {group.species}</strong>{group.breed ? ` · ${group.breed}` : ''}{group.purpose ? ` · ${group.purpose}` : ''}</p>)}{!profile?.livestock?.length && <p>No animal groups recorded.</p>}{hasCrops && <button onClick={onDiagnose}><Camera size={18}/> {t(language, 'diagnoseCrop')} <ChevronRight size={16}/></button>}<button onClick={onOnboard}><Plus size={18}/> Manage farm <ChevronRight size={16}/></button></div></div></>
}
function Advice({ advice, language }: { advice?: Advisory; language: string }) { return <><div className="welcome"><div><span className="eyebrow">DECISION SUPPORT</span><h1>{t(language, 'farmAdvice')}</h1><p>{advice?.summary}</p></div><div className="advice-badge"><Bot size={18}/> Powered by AgriAI</div></div><div className="advice-list">{advice?.items.map((item, i) => <ActionCard key={item.title} item={item} index={i}/>)}</div></> }
function Permissions({ language }: { language: string }) { const [state, setState] = useState({ location: false, camera: false, notifications: false }); const items = [{ key: 'location' as const, icon: MapPin, title: t(language, 'farmLocation'), text: t(language, 'locationAccess') }, { key: 'camera' as const, icon: Camera, title: t(language, 'diagnoseCrop'), text: t(language, 'cameraAccess') }, { key: 'notifications' as const, icon: Bell, title: t(language, 'permissions'), text: t(language, 'notificationAccess') }]; return <><div className="welcome"><div><span className="eyebrow">{t(language, 'permissions').toUpperCase()}</span><h1>{t(language, 'permissionsTitle')}</h1><p>{t(language, 'permissionsHelp')}</p></div><ShieldCheck className="hero-shield"/></div><div className="permission-card">{items.map(item => <div className="permission-row" key={item.key}><span className="permission-icon"><item.icon size={20}/></span><div><strong>{item.title}</strong><p>{item.text}</p></div><button className={`toggle ${state[item.key] ? 'on' : ''}`} onClick={() => setState(s => ({ ...s, [item.key]: !s[item.key] }))} aria-label={`Toggle ${item.title}`}><span/></button></div>)}<div className="privacy-box"><ShieldCheck size={18}/><span><strong>{t(language, 'privacyNotice')}</strong><br/><small>{t(language, 'privacyNotice')}</small></span></div></div></> }

function Onboarding({ profile, authName, language: uiLanguage, onClose, onSaved }: { profile?: Profile | null; authName?: string; language: string; onClose: () => void; onSaved: (p: Profile) => void }) {
  const [form, setForm] = useState({ farmer_name: authName || profile?.farmer_name || '', farm_name: profile?.farm_name || '', farm_type: profile?.farm_type || 'crops', field_name: profile?.fields?.[0]?.name || 'Main field', village: profile?.location.village || '', state: profile?.location.state || '', latitude: String(profile?.location.latitude ?? ''), longitude: String(profile?.location.longitude ?? ''), area: String(profile?.land_area_acres || ''), crop: profile?.crops[0] || 'Groundnut', variety: profile?.crop_variety || '', sowing_date: profile?.sowing_date || '', growth_stage: profile?.growth_stage || '', previous_crop: profile?.previous_crop || '', language: profile?.preferred_language || 'en', soil_type: profile?.soil_type || '', irrigation: profile?.irrigation || 'Rain-fed' })
  useEffect(() => { if (authName) setForm(current => ({ ...current, farmer_name: authName })) }, [authName])
  const [animals, setAnimals] = useState((profile?.livestock || []).map(group => ({ species: group.species, count: String(group.count), breed: group.breed || '', purpose: group.purpose || '' })))
  const [locationMessage, setLocationMessage] = useState('Set your farm location: search your village/town or use this device’s location. No default location is set.')
  const [searchingLocation, setSearchingLocation] = useState(false)
  const [locationResults, setLocationResults] = useState<{ name: string; admin1: string; country: string; latitude: number; longitude: number }[]>([])
  const [locationInput, setLocationInput] = useState(profile?.location.village || '')
  const [locationSelected, setLocationSelected] = useState(!!profile?.location.latitude && !!profile?.location.longitude)
  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }))
  useEffect(() => {
    const query = locationInput.trim()
    if (locationSelected || query.length < 2) { setLocationResults([]); setSearchingLocation(false); return }
    const controller = new AbortController()
    let active = true
    const timer = window.setTimeout(async () => {
      setSearchingLocation(true)
      try {
        const result = await api.geocode(query, controller.signal)
        if (!active) return
        setLocationResults(result.results)
        setLocationMessage(result.results.length ? `${result.results.length} matching places. Choose your farm location.` : result.unavailable ? 'Place search is unavailable. Check your internet connection or enter coordinates manually.' : t(uiLanguage, 'noPlaceFound'))
      } catch {
        if (active) { setLocationResults([]); setLocationMessage('Place search is currently unavailable. Try device location or enter coordinates manually.') }
      } finally { if (active) setSearchingLocation(false) }
    }, 350)
    return () => { active = false; controller.abort(); window.clearTimeout(timer) }
  }, [locationInput, locationSelected, uiLanguage])
  const useDeviceLocation = () => {
    if (!navigator.geolocation) { setLocationMessage(t(uiLanguage, 'noLocation')); return }
    navigator.geolocation.getCurrentPosition(position => {
      setLocationResults([]); setLocationInput(''); setLocationSelected(true); setForm(current => ({ ...current, village: '', state: '', latitude: String(position.coords.latitude), longitude: String(position.coords.longitude) })); setLocationMessage('Device coordinates added. Add your village/town and state if you want them shown on the dashboard.')
    }, () => setLocationMessage('Could not access device location. Allow location access in your browser, use HTTPS/localhost, or search your village.'), { timeout: 10000 })
  }
  const selectLocation = (place: typeof locationResults[number]) => {
    setLocationInput(place.name); setLocationSelected(true)
    setForm(current => ({ ...current, village: place.name, latitude: String(place.latitude), longitude: String(place.longitude), state: place.admin1 || place.country || current.state }))
    setLocationResults([])
    setLocationMessage(`Farm pin set to ${place.name}${place.admin1 ? `, ${place.admin1}` : ''}.`)
  }
  const submit = async (e: React.FormEvent) => { e.preventDefault(); const lat = Number(form.latitude); const lon = Number(form.longitude); if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { setLocationMessage(t(uiLanguage, 'invalidCoordinates')); return }
    const hasCrops = form.farm_type !== 'livestock'; const groups = animals.map(group => ({ species: group.species as 'cattle'|'buffalo'|'goat'|'sheep'|'poultry'|'pig'|'other', count: Number(group.count), breed: group.breed || undefined, purpose: group.purpose || undefined })).filter(group => group.count > 0)
    if (form.farm_type !== 'crops' && groups.length === 0) { setLocationMessage(t(uiLanguage, 'animalRequired')); return }
    const acres = hasCrops ? Number(form.area) : 0
    const field = hasCrops ? [{ name: form.field_name, area_acres: acres, crop: form.crop, crop_variety: form.variety || undefined, sowing_date: form.sowing_date || undefined, growth_stage: form.growth_stage || undefined, irrigation: form.irrigation, soil_type: form.soil_type || undefined }] : []
    const p: Profile = { farmer_name: form.farmer_name, farm_name: form.farm_name, farm_type: form.farm_type as 'crops'|'livestock'|'mixed', location: { latitude: lat, longitude: lon, village: form.village, state: form.state }, land_area_acres: acres, crops: hasCrops ? [form.crop] : [], fields: field, livestock: groups, crop_variety: form.variety || undefined, sowing_date: form.sowing_date || undefined, growth_stage: form.growth_stage || undefined, previous_crop: form.previous_crop || undefined, preferred_language: form.language, soil_type: form.soil_type || undefined, irrigation: form.irrigation }
    const saved = await api.onboarding(p); if (saved.saved) onSaved(p)
  }
  return <div className="modal-backdrop"><div className="modal onboarding"><div className="modal-heading"><div><span className="eyebrow">YOUR FARM PROFILE</span><h2>{t(uiLanguage, "farmSetup")}</h2><p>{t(uiLanguage, "farmHelp")}</p></div><button onClick={onClose} className="close-button"><X size={19}/></button></div><form onSubmit={submit}>
    <div className="form-grid"><label>{t(uiLanguage, "farmerName")}<input required value={form.farmer_name} onChange={e => update('farmer_name', e.target.value)} placeholder="Your account name"/></label><label>{t(uiLanguage, "farmName")}<input value={form.farm_name} onChange={e => update('farm_name', e.target.value)} placeholder="e.g. Green Valley Farm"/></label><label>{t(uiLanguage, "farmType")}<select value={form.farm_type} onChange={e => update('farm_type', e.target.value)}><option value="crops">{t(uiLanguage, "crops")}</option><option value="livestock">{t(uiLanguage, "livestock")}</option><option value="mixed">{t(uiLanguage, "mixed")}</option></select></label><label>{t(uiLanguage, "preferredLanguage")}<select value={form.language} onChange={e => update('language', e.target.value)}>{languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>{form.farm_type !== 'livestock' && <><label>{t(uiLanguage, "fieldName")}<input value={form.field_name} onChange={e => update('field_name', e.target.value)} placeholder="Main field"/></label><label>{t(uiLanguage, "cropArea")}<input type="number" min="0.1" step="0.1" required value={form.area} onChange={e => update('area', e.target.value)} placeholder="2"/></label><label>{t(uiLanguage, "mainCrop")}<select value={form.crop} onChange={e => update('crop', e.target.value)}><option>Groundnut</option><option>Cotton</option><option>Soybean</option><option>Wheat</option><option>Rice</option><option>Vegetables</option></select></label><label>{t(uiLanguage, "variety")}<input value={form.variety} onChange={e => update('variety', e.target.value)} placeholder="Optional"/></label><label>{t(uiLanguage, "sowingDate")}<input type="date" value={form.sowing_date} onChange={e => update('sowing_date', e.target.value)}/></label><label>{t(uiLanguage, "growthStage")}<input value={form.growth_stage} onChange={e => update('growth_stage', e.target.value)} placeholder="e.g. flowering"/></label><label>{t(uiLanguage, "previousCrop")}<input value={form.previous_crop} onChange={e => update('previous_crop', e.target.value)} placeholder="Optional"/></label><label>{t(uiLanguage, "soilKnown")}<input value={form.soil_type} onChange={e => update('soil_type', e.target.value)} placeholder="Optional"/></label><label>{t(uiLanguage, "irrigation")}<select value={form.irrigation} onChange={e => update('irrigation', e.target.value)}><option>Rain-fed</option><option>Drip</option><option>Sprinkler</option><option>Canal</option><option>Other</option></select></label></>}</div>
    <section className="farm-location"><div className="farm-location-heading"><MapPin size={18}/><div><strong>Farm location</strong><small>Search your village or town and select the right result.</small></div></div><div className="location-search-row"><input aria-label="Search village or town" role="combobox" aria-autocomplete="list" aria-expanded={locationResults.length > 0} aria-controls="farm-location-results" value={locationInput} onChange={e => { const value = e.target.value; setLocationInput(value); setLocationSelected(false); setForm(current => ({ ...current, village: value, state: '', latitude: '', longitude: '' })); setLocationResults([]) }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (locationResults[0]) selectLocation(locationResults[0]) } }} placeholder="Start typing a village, town or PIN code"/><button type="button" className="secondary-button" onClick={useDeviceLocation}>{t(uiLanguage, "deviceLocation")}</button>{searchingLocation && <small className="location-loading" role="status">Searching places…</small>}</div>{locationResults.length > 0 && <div id="farm-location-results" className="place-results" role="listbox" aria-label="Matching places">{locationResults.map((place, index) => <button type="button" role="option" aria-selected="false" className="place-option" key={`${place.latitude}-${place.longitude}-${index}`} onClick={() => selectLocation(place)}><MapPin size={16}/><span><strong>{place.name}</strong><small>{[place.admin1, place.country].filter(Boolean).join(', ')}</small></span><ChevronRight size={16}/></button>)}</div>}{form.latitude && form.longitude && <div className="selected-location"><Check size={16}/><span><strong>{form.village || 'Location pin selected'}</strong><small>{form.state || 'State not set'} · {Number(form.latitude).toFixed(4)}, {Number(form.longitude).toFixed(4)}</small></span></div>}<label className="state-field">State / union territory<input value={form.state} onChange={e => update('state', e.target.value)} placeholder="Filled from place search; edit if needed"/></label><details className="manual-location"><summary>Enter coordinates manually</summary><div className="form-grid"><label>{t(uiLanguage, "latitude")}<input type="number" step="any" value={form.latitude} onChange={e => update('latitude', e.target.value)} placeholder="Latitude"/></label><label>{t(uiLanguage, "longitude")}<input type="number" step="any" value={form.longitude} onChange={e => update('longitude', e.target.value)} placeholder="Longitude"/></label></div></details><p className="location-message" role="status">{locationMessage}</p></section>
    {form.farm_type !== 'crops' && <div className="animal-editor"><div className="animal-editor-title"><strong>{t(uiLanguage, "animalsHere")}</strong><button type="button" className="secondary-button" onClick={() => setAnimals(current => [...current, { species: 'cattle', count: '1', breed: '', purpose: '' }])}>{t(uiLanguage, "addGroup")}</button></div>{animals.length === 0 && <small>Add an animal group to continue.</small>}{animals.map((group, index) => <div className="animal-row" key={index}><select aria-label="Animal type" value={group.species} onChange={e => setAnimals(current => current.map((item, i) => i === index ? { ...item, species: e.target.value as typeof item.species } : item))}><option value="cattle">Cattle</option><option value="buffalo">Buffalo</option><option value="goat">Goats</option><option value="sheep">Sheep</option><option value="poultry">Poultry</option><option value="pig">Pigs</option><option value="other">Other</option></select><input aria-label="Animal count" type="number" min="1" value={group.count} onChange={e => setAnimals(current => current.map((item, i) => i === index ? { ...item, count: e.target.value } : item))} placeholder={t(uiLanguage, "animalCount")}/><input aria-label="Breed, optional" value={group.breed} onChange={e => setAnimals(current => current.map((item, i) => i === index ? { ...item, breed: e.target.value } : item))} placeholder={t(uiLanguage, "breedOptional")}/><select aria-label="Animal purpose" value={group.purpose} onChange={e => setAnimals(current => current.map((item, i) => i === index ? { ...item, purpose: e.target.value as typeof item.purpose } : item))}><option value="dairy">Dairy</option><option value="meat">Meat</option><option value="eggs">Eggs</option><option value="breeding">Breeding</option><option value="working">Work</option><option value="other">Other</option></select><button type="button" className="text-button" aria-label="Remove animal group" onClick={() => setAnimals(current => current.filter((_, i) => i !== index))}>Remove</button></div>)}</div>}
    <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>{t(uiLanguage, "cancel")}</button><button className="primary-button" type="submit">{t(uiLanguage, "saveFarm")} <ArrowRight size={16}/></button></div></form></div></div>
}
function DiagnosisModal({ crop, language, onClose }: { crop?: string; language: string; onClose: () => void }) {
  const [file, setFile] = useState<File>()
  const [symptoms, setSymptoms] = useState('')
  const [result, setResult] = useState<Diagnosis>()
  const [loading, setLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setFileError('')
    try {
      let image_url: string | undefined
      if (file) image_url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read selected image'))
        reader.readAsDataURL(file)
      })
      setResult(await api.diagnose(symptoms.trim(), crop, image_url))
    } catch {
      setResult({ diagnosis: 'Could not reach the AgriAI backend. Start the backend container and try again.', confidence: null, severity: 'low', actions: [], source: 'unavailable' })
    } finally { setLoading(false) }
  }
  return <div className="modal-backdrop"><div className="modal diagnosis-modal"><div className="modal-heading"><div><span className="eyebrow">{t(language, 'diagnosisTitle').toUpperCase()}</span><h2>{t(language, 'diagnosisTitle')}</h2><p>{t(language, 'diagnosisHelp')}</p></div><button onClick={onClose} className="close-button"><X size={19}/></button></div>{result ? <div className="diagnosis-result"><div className="result-icon"><Leaf size={27}/></div><div className="result-title"><span className={`priority ${result.source === 'unavailable' ? 'medium' : result.severity}`}>{result.source === 'unavailable' ? 'Unavailable' : `${result.severity} attention`}</span><h3>{result.diagnosis}</h3><p>{result.confidence != null ? `${Math.round(result.confidence * 100)}% confidence · ` : ''}{result.source === 'gemini-vision' ? 'Gemini image analysis' : result.source}</p></div>{result.actions.length > 0 && <><h4>{t(language, 'nextSteps')}</h4><ul>{result.actions.map(a => <li key={a}><Check size={16}/>{a}</li>)}</ul></>}<button className="secondary-button full" onClick={() => setResult(undefined)}>{t(language, 'checkAgain')}</button></div> : <form onSubmit={submit}><label className="upload-box"><Upload size={25}/><strong>{file?.name || t(language, 'uploadPhoto')}</strong><small>PNG or JPG · optional · 4 MB max</small><input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={e => { const selected = e.target.files?.[0]; if (selected && selected.size > 4 * 1024 * 1024) { e.target.value = ''; setFile(undefined); setFileError('Image must be 4 MB or smaller.'); return } setFileError(''); setFile(selected) }}/></label>{fileError && <p className="auth-error">{fileError}</p>}<label>{t(language, 'describeSymptoms')}<textarea required={!file} value={symptoms} onChange={e => setSymptoms(e.target.value)} placeholder="e.g. Yellow spots on the lower leaves..." rows={3}/></label><div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>{t(language, 'cancel')}</button><button className="primary-button" type="submit" disabled={loading}><Bot size={16}/>{loading ? 'Analyzing with Gemini…' : 'Analyze with Gemini'}</button></div></form>}</div></div>
}
function Assistant({ crop, language, onClose }: { crop?: string; language: string; onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<{ answer: string; source: string }>()
  const [loading, setLoading] = useState(false)
  const ask = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!question.trim() || loading) return
    setLoading(true)
    try { setAnswer(await api.ask(question.trim(), crop)) }
    catch { setAnswer({ answer: 'Could not reach the AgriAI backend. Start the backend container and try again.', source: 'unavailable' }) }
    finally { setLoading(false) }
  }
  return <div className="assistant-panel"><div className="assistant-head"><div><span className="assistant-avatar"><Bot size={20}/></span><div><strong>{t(language, 'askAI')}</strong><small>{t(language, 'preferredLanguage')}</small></div></div><button onClick={onClose}><X size={19}/></button></div><div className="assistant-body"><div className="bot-message"><span className="assistant-avatar tiny"><Bot size={15}/></span><p>{t(language, 'assistantGreeting')}</p></div>{answer && <div className="user-message">{answer.answer}<small className="answer-source">{answer.source === 'unavailable' ? 'AI unavailable' : `Answered by ${answer.source}`}</small></div>}<div className="suggestions"><button onClick={() => setQuestion('Should I irrigate today?')}>Should I irrigate today?</button><button onClick={() => setQuestion('How can I improve my soil?')}>Improve my soil</button></div></div><form className="assistant-input" onSubmit={ask}><input value={question} onChange={e => setQuestion(e.target.value)} placeholder={loading ? 'Waiting for Gemini…' : t(language, 'questionPlaceholder')} /><button aria-label="Send question" disabled={loading}><ArrowRight size={17}/></button></form></div>
}

export default App
