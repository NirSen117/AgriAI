import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Bell, Bot, Camera, Check, ChevronLeft, ChevronRight, CloudSun, Droplets, Gauge, Home, Leaf, LogOut, MapPin, Menu, Mic, MicOff, Moon, Plus, ShieldCheck, Sprout, Sun, Thermometer, Upload, UserRound, Wind, X } from 'lucide-react'
import { api, Advisory, Dashboard, Diagnosis, Interoperability, Location, Profile } from './api'
import { AuthModal } from './AuthModal'
import { AuthUser, firebaseAuth } from './firebaseAuth'
import { DiagnosisHistoryEntry, loadDiagnosisHistory, saveDiagnosisHistory } from './diagnosisHistory'
import { languages, t } from './i18n'

type Page = 'overview' | 'fields' | 'advice' | 'network' | 'permissions'
type SpeechRecognitionLike = {
  lang: string; interimResults: boolean; continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void; stop: () => void; abort: () => void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike
const speechLocales: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN', ta: 'ta-IN', te: 'te-IN', bn: 'bn-IN', mr: 'mr-IN' }
const nav = [{ id: 'overview' as Page, key: 'overview' as const, icon: Home }, { id: 'fields' as Page, key: 'fields' as const, icon: Sprout }, { id: 'advice' as Page, key: 'advice' as const, icon: Leaf }, { id: 'network' as Page, label: 'Data network', icon: Gauge }, { id: 'permissions' as Page, key: 'permissions' as const, icon: ShieldCheck }]
type FarmAlert = { id: string; title: string; detail: string; severity: 'high' | 'medium' }
const getFarmAlerts = (dashboard?: Dashboard): FarmAlert[] => {
  if (!dashboard) return []
  const alerts: FarmAlert[] = []
  const rain = dashboard.weather.rainfall_probability
  if (dashboard.weather.source === 'open-meteo' && rain >= 0.7) alerts.push({ id: 'rain', title: 'Rain likely today', detail: `${Math.round(rain * 100)}% chance. Plan field work and check drainage.`, severity: 'medium' })
  if (dashboard.weather.source === 'open-meteo' && dashboard.weather.temperature_c >= 40) alerts.push({ id: 'heat', title: 'High temperature', detail: `Current reading is ${Math.round(dashboard.weather.temperature_c)}°C. Check crops and livestock for heat stress.`, severity: 'high' })
  if (dashboard.weather.source === 'open-meteo' && dashboard.weather.wind_kph >= 45) alerts.push({ id: 'wind', title: 'Strong wind conditions', detail: `${Math.round(dashboard.weather.wind_kph)} km/h. Secure lightweight equipment and avoid spraying.`, severity: 'medium' })
  const moisture = dashboard.soil.moisture_percent
  if (dashboard.soil.source.includes('open-meteo') && moisture != null && moisture <= 25) alerts.push({ id: 'moisture', title: 'Soil may be dry', detail: `Modelled surface moisture is ${Math.round(moisture)}%. Check the root zone before irrigating.`, severity: 'high' })
  return alerts
}
const dataNotice = (dashboard: Dashboard) => {
  const weather = dashboard.weather.source === 'open-meteo' ? 'Live weather' : dashboard.weather.source === 'mock-weather' ? 'Demo weather (mock mode)' : dashboard.weather.source === 'location-required' ? 'Set your farm location to get local weather' : 'Weather unavailable right now'
  const soil = dashboard.soil.source.includes('open-meteo') ? 'modelled soil moisture' : 'demo soil values'
  const field = dashboard.satellite.source.startsWith('isro-bhuvan') ? 'Bhuvan AOI land-cover available (historical layer)' : dashboard.satellite.source === 'mock-satellite' ? 'demo field-health estimate' : 'satellite field-health unavailable'
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
  const [uiLanguage, setUiLanguage] = useState(() => localStorage.getItem('agriai-ui-language') || '')
  const [darkTheme, setDarkTheme] = useState(() => localStorage.getItem('agriai-theme') === 'dark')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('agriai-sidebar-collapsed') === 'true')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() => typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported')
  useEffect(() => {
    return firebaseAuth.subscribe(user => { setAuthUser(user); setAuthReady(true) })
  }, [])
  useEffect(() => {
    if (!authUser) { setDashboard(undefined); setAdvice(undefined); return }
    Promise.all([api.dashboard(), api.advisory()]).then(([nextDashboard, nextAdvice]) => {
      setDashboard(nextDashboard); setAdvice(nextAdvice)
      setNotice(`${dataNotice(nextDashboard)}${nextDashboard.profile_sync === 'unavailable' ? ' · Farm data sync is unavailable; enable Firestore to sync devices' : ''}`)
      if (!nextDashboard.profile) setShowOnboarding(true)
    })
  }, [authUser?.uid])
  useEffect(() => {
    const satelliteMessage = dashboard?.satellite.availability_message || ''
    const waitingForSatellite = satelliteMessage.includes('refresh automatically')
    const retryingSatellite = satelliteMessage.includes('retry automatically')
    if (!authUser || !dashboard?.profile || (!waitingForSatellite && !retryingSatellite)) return
    const timer = window.setInterval(() => {
      void api.dashboard().then(nextDashboard => {
        setDashboard(nextDashboard)
        setNotice(current => {
          if (!current) return current
          const parts = current.split(' · ')
          if (parts.length < 3) return current
          const analysisStatus = parts.slice(3)
          return `${dataNotice(nextDashboard)}${analysisStatus.length ? ` · ${analysisStatus.join(' · ')}` : ''}`
        })
      }).catch(() => undefined)
    }, waitingForSatellite ? 12000 : 40000)
    return () => window.clearInterval(timer)
  }, [authUser?.uid, dashboard?.profile?.location.latitude, dashboard?.profile?.location.longitude,
    dashboard?.satellite.source, dashboard?.satellite.availability_message])
  useEffect(() => {
    document.documentElement.dataset.theme = darkTheme ? 'dark' : 'light'
    localStorage.setItem('agriai-theme', darkTheme ? 'dark' : 'light')
  }, [darkTheme])
  useEffect(() => {
    const savedProfile = dashboard?.profile
    if (!savedProfile) return
    if (!uiLanguage) {
      setUiLanguage(savedProfile.preferred_language || 'en')
      return
    }
    if (savedProfile.preferred_language !== uiLanguage) {
      const updated = { ...savedProfile, preferred_language: uiLanguage }
      void api.onboarding(updated).then(async () => {
        setDashboard(current => current ? { ...current, profile: updated } : current)
        setAdvice(await api.advisory())
      })
    }
  }, [dashboard?.profile?.preferred_language, uiLanguage])
  const changeLanguage = (next: string) => {
    setUiLanguage(next)
    localStorage.setItem('agriai-ui-language', next)
  }
  const alerts = getFarmAlerts(dashboard)
  const currentNavItem = nav.find(item => item.id === page)
  const requestNotifications = async () => {
    if (!('Notification' in window)) { setNotificationPermission('unsupported'); return }
    try { setNotificationPermission(await Notification.requestPermission()) } catch { setNotificationPermission(Notification.permission) }
  }
  useEffect(() => {
    if (notificationPermission !== 'granted') return
    for (const alert of alerts) {
      const key = `agriai-alert-${alert.id}-${new Date().toISOString().slice(0, 10)}`
      if (sessionStorage.getItem(key)) continue
      try { new Notification(alert.title, { body: alert.detail, tag: key }); sessionStorage.setItem(key, 'sent') } catch { /* Keep the in-app alert visible if OS notifications are unavailable. */ }
    }
  }, [notificationPermission, dashboard])
  const runAnalysis = async (includeGemini = true) => {
    setAnalysisLoading(true)
    if (includeGemini) setFarmAnalysis(undefined)
    setNotice(includeGemini ? 'Refreshing farm data and asking Gemini…' : 'Refreshing farm data…')
    try {
      const [nextDashboard, nextAdvice] = await Promise.all([api.dashboard(), api.advisory()])
      setDashboard(nextDashboard); setAdvice(nextAdvice)
      if (includeGemini && nextDashboard.profile) {
        const result = await api.ask('Analyze my farm using the current data. Clearly distinguish live measurements from estimates, state what data is missing, and give three short prioritized actions for my crop and farm. Do not invent measurements.', nextDashboard.profile.crops[0], uiLanguage || nextDashboard.profile.preferred_language || 'en')
        setFarmAnalysis(result)
        const analysisLabel = result.source === 'gemini' || result.source === 'gemini-fallback' || result.source === 'vertex-ai'
          ? 'Live AI farm analysis ready'
          : result.source === 'mock-fallback' || result.source === 'mock'
            ? 'Demo AI fallback analysis ready'
            : 'AI analysis unavailable'
        setNotice(`${dataNotice(nextDashboard)} · ${analysisLabel}`)
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
  const language = uiLanguage || profile?.preferred_language || 'en'
  const firstName = authUser?.displayName?.trim().split(/\s+/)[0] || profile?.farmer_name?.split(' ')[0] || 'Farmer'
  if (!authReady) return <main className="auth-gate"><div className="auth-gate-card"><Logo/><p>Checking your sign-in…</p></div></main>
  if (!authUser) return <main className="auth-gate"><div className="auth-gate-card"><Logo/><span className="eyebrow">FARMER ACCOUNT</span><h1>Sign in to AgriAI</h1><p>Log in or create an account to see your farm dashboard and personalized advice.</p><label className="login-language">Choose your language<select value={language} onChange={event => changeLanguage(event.target.value)}>{languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><button className="primary-button" onClick={() => setShowAuth(true)}>Sign in or create an account <ArrowRight size={16}/></button></div>{showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuthenticated={user => { setAuthUser(user); setShowAuth(false) }} />}</main>
  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${mobileNavOpen ? 'mobile-nav-open' : ''}`}>
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand"><Logo/><button className="sidebar-collapse" onClick={() => { const next = !sidebarCollapsed; setSidebarCollapsed(next); localStorage.setItem('agriai-sidebar-collapsed', String(next)) }} aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}>{sidebarCollapsed ? <ChevronRight size={17}/> : <ChevronLeft size={17}/>}</button></div>
      <div className="farm-switcher"><div className="avatar">{firstName[0]}</div><div><strong>{profile?.farm_name || 'My farm'}</strong><small>{profile?.location.village || 'Set up your farm'}</small></div><ChevronRight size={16}/></div>
      <nav aria-label="Main navigation">{nav.map(item => <button title={item.key ? t(language, item.key) : item.label} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setMobileNavOpen(false) }} key={item.id}><item.icon size={19}/><span>{item.key ? t(language, item.key) : item.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><button title="Manage farm and fields" aria-label="Manage farm and fields" onClick={() => setShowOnboarding(true)} className="outline-button"><Plus size={17}/> Add field</button><small className="privacy"><ShieldCheck size={14}/> Your data stays yours</small></div>
    </aside>
    <main>
      <header className="topbar"><button className="mobile-menu" aria-label="Open menu" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(value => !value)}><Menu size={22}/></button><div className="breadcrumb"><span>{currentNavItem?.key ? t(language, currentNavItem.key) : currentNavItem?.label || t(language, 'overview')}</span><span className="dot">·</span><span className="muted">{profile?.location.village || 'Set up farm location'}</span></div><div className="top-actions"><label className="language-control" aria-label="Dashboard language"><span>Language</span><select value={language} onChange={event => changeLanguage(event.target.value)}>{languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><button className="icon-button theme-toggle" aria-label={darkTheme ? 'Switch to light theme' : 'Switch to dark theme'} title={darkTheme ? 'Light theme' : 'Dark theme'} onClick={() => setDarkTheme(value => !value)}>{darkTheme ? <Sun size={19}/> : <Moon size={19}/>}</button><div className="notification-anchor"><button className="icon-button" aria-label={`Notifications, ${alerts.length} alerts`} aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(value => !value)}><Bell size={19}/>{alerts.length > 0 && <i/>}</button>{notificationsOpen && <div className="notification-popover" role="dialog" aria-label="Farm notifications"><div className="notification-heading"><strong>Farm alerts</strong><button onClick={() => setNotificationsOpen(false)} aria-label="Close notifications"><X size={16}/></button></div>{alerts.length ? <div className="notification-list">{alerts.map(alert => <article className={`notification-item ${alert.severity}`} key={alert.id}><span className="notification-dot"/><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></article>)}</div> : <p className="notifications-empty">You’re all caught up. New weather and farm alerts will appear here.</p>}<div className="notification-footer">{notificationPermission === 'granted' ? <span className="permission-enabled"><Check size={14}/> Browser alerts enabled while dashboard is open</span> : notificationPermission === 'denied' ? <span>Browser alerts are blocked. Allow them in your browser’s site settings.</span> : notificationPermission === 'unsupported' ? <span>This browser does not support desktop alerts.</span> : <button className="enable-notifications" onClick={() => void requestNotifications()}>Enable browser notifications</button>}</div></div>}</div><div className="profile-button" title={authUser?.email || 'AgriAI account'}><div className="avatar small">{authUser?.email[0]?.toUpperCase() || firstName[0]}</div><span className="auth-label">{authUser?.email || 'Signed in'}</span></div>{authUser ? <button className="logout-button" onClick={() => void firebaseAuth.signOut()} aria-label="Log out of AgriAI"><LogOut size={15}/><span>Log out</span></button> : <button className="logout-button" onClick={() => setShowAuth(true)}>Sign in</button>}</div></header>
      <div className="page">
        {notice && <div className="demo-banner"><span><span className="status-dot"/> {notice}</span><button onClick={() => setNotice('')}><X size={15}/></button></div>}
        {page === 'overview' && <Overview dashboard={dashboard} advice={advice} farmAnalysis={farmAnalysis} analysisLoading={analysisLoading} language={language} greetingName={firstName} onDiagnose={() => setDiagnosis(true)} onOnboard={() => setShowOnboarding(true)} onAnalyze={() => runAnalysis()} />}
        {page === 'fields' && <Fields dashboard={dashboard} language={language} onDiagnose={() => setDiagnosis(true)} onOnboard={() => setShowOnboarding(true)} />}
        {page === 'advice' && <Advice advice={advice} language={language} />}
        {page === 'network' && <DataNetwork userId={authUser.uid} />}
        {page === 'permissions' && <Permissions language={language} notificationPermission={notificationPermission} onRequestNotifications={() => void requestNotifications()} />}
      </div>
    </main>
    {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}/>}
    <div className="mobile-nav">{nav.slice(0, 4).map(item => <button className={page === item.id ? 'active' : ''} onClick={() => setPage(item.id)} key={item.id}><item.icon size={18}/><span>{item.key ? t(language, item.key) : item.label}</span></button>)}</div>
    {showOnboarding && <Onboarding profile={profile} authName={authUser.displayName} language={language} onClose={() => setShowOnboarding(false)} onSaved={async (p, synced) => { setShowOnboarding(false); await runAnalysis(false); setDashboard(d => d ? { ...d, profile: p, profile_sync: synced ? 'synced' : 'unavailable' } : d); if (!synced) setNotice(current => `${current} · Farm profile saved here but device sync needs Firestore`) }} />}
    {diagnosis && <DiagnosisModal crop={profile?.crops[0]} language={language} onClose={() => setDiagnosis(false)} />}
    {assistant && <Assistant crop={profile?.crops[0]} language={language} onClose={() => setAssistant(false)} />}
    {!assistant && <button className="assistant-launcher" onClick={() => setAssistant(true)} aria-label="Ask AgriAI"><span className="launcher-icon"><Bot size={22}/></span><span>{t(language, 'askAI')}</span></button>}
    {showAuth && <AuthModal onClose={() => setShowAuth(false)} onAuthenticated={user => { setAuthUser(user); setShowAuth(false) }} />}
  </div>
}

function Logo() { return <div className="logo"><span className="logo-mark"><Sprout size={20}/></span><span>agri<strong>ai</strong></span></div> }
function DataNetwork({ userId }: { userId: string }) {
  const [network, setNetwork] = useState<Interoperability>()
  useEffect(() => {
    api.interoperability().then(setNetwork).catch(() => undefined)
  }, [userId])
  return <section className="network-page">
    <SectionHeader eyebrow="DIGITAL PUBLIC GOOD" title="Data network" />
    <p className="muted">State-specific agricultural records are normalized before they reach the shared intelligence layer.</p>
    <div className="network-flow"><strong>Karnataka</strong><span>→</span><strong>Maharashtra</strong><span>→</span><strong>Tamil Nadu</strong><span>→</span><strong>Common Agriculture Schema</strong><span>→</span><strong>Localized advisory</strong></div>
    <div className="network-grid">{network?.sources.map(source => <article className="network-card" key={source.state}><span className="status-dot green"/><strong>{source.name}</strong><small>{source.state} · {source.categories.join(' · ')}</small><small>Demo adapter · normalized</small></article>)}</div>
    <div className="network-summary"><strong>{network?.normalized_count || 0}</strong><span>records normalized into {network?.schema || 'AgricultureRecord/v1'}</span><small>Data quality: {network?.data_quality || 'loading'}</small></div>
  </section>
}
function SectionHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: React.ReactNode }) { return <div className="section-header">{<div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>}{action}</div> }
function Overview({ dashboard, advice, farmAnalysis, analysisLoading, language, greetingName, onDiagnose, onOnboard, onAnalyze }: { dashboard?: Dashboard; advice?: Advisory; farmAnalysis?: { answer: string; source: string }; analysisLoading: boolean; language: string; greetingName: string; onDiagnose: () => void; onOnboard: () => void; onAnalyze: () => void }) {
  const d = dashboard
  const farm = d?.profile
  const hasCrops = !!farm?.crops.length
  const cropSummary = hasCrops ? farm!.crops.join(' · ') : `${farm?.livestock?.length || 0} ${t(language, 'livestockGroups').toLowerCase()}`
  const field = farm?.fields?.[0]
  const livestockCount = farm?.livestock?.reduce((sum, group) => sum + group.count, 0) || 0
  const satelliteLabel = d?.satellite.source === 'isro-bhuvan-wms' ? 'ISRO LULC map'
    : d?.satellite.source === 'isro-bhuvan-lulc-250k' ? 'ISRO land cover (250K)'
      : d?.satellite.ndvi != null ? 'NDVI' : 'Satellite'
  const satelliteValue = d?.satellite.source === 'isro-bhuvan-wms' ? 'View map'
    : d?.satellite.source === 'isro-bhuvan-lulc-250k' ? (d.satellite.land_cover?.[0]?.label || '—')
      : d?.satellite.ndvi != null ? d.satellite.ndvi.toFixed(2) : '—'
  const satelliteNote = d?.satellite.source === 'isro-bhuvan-wms' ? 'Historical imagery, not crop health'
    : d?.satellite.source === 'isro-bhuvan-lulc-250k' ? `${d.satellite.land_cover?.[0]?.share_percent ?? 0}% of mapped area · historical context`
      : d?.satellite.source === 'mock-satellite' ? 'Demo estimate'
        : d?.satellite.ndvi != null ? 'NDVI near farm pin' : 'No live satellite data'
  return <><div className="welcome"><div><span className="eyebrow">{t(language, 'farmLocation').toUpperCase()} · {farm?.location.state || 'LOCATION NOT SET'}</span><h1>Good morning, {greetingName} <span>👋</span></h1><p>{new Date().toLocaleDateString(language, { weekday: 'long', day: 'numeric', month: 'long' })} · {t(language, 'farmAdvice')}</p></div><div className="welcome-actions"><button className="secondary-button" disabled={analysisLoading} onClick={onAnalyze}><Sprout size={17}/> {analysisLoading ? 'Analyzing…' : t(language, 'runAnalysis')}</button>{hasCrops && <button className="primary-button" onClick={onDiagnose}><Camera size={17}/> {t(language, 'diagnoseCrop')}</button>}</div></div>
    <div className="quick-stats">
      <Stat icon={<MapPin/>} label={t(language, 'farmLocation')} value={farm?.location.village || '—'} note={farm?.location.state || ''} />
      <Stat icon={<Sprout/>} label={hasCrops ? t(language, 'activeCrops') : t(language, 'livestockGroups')} value={String(hasCrops ? farm?.crops.length || 0 : livestockCount)} note={cropSummary} />
      <Stat icon={<Gauge/>} label={hasCrops ? satelliteLabel : t(language, 'livestockGroups')} value={hasCrops ? satelliteValue : String(livestockCount)} note={hasCrops ? satelliteNote : 'Animals registered on this farm'} tone="green" />
    </div>
    <SectionHeader eyebrow="FIELD PULSE" title={t(language, 'currentConditions')} />
    <div className="insights-grid"><Weather d={d} language={language}/>{hasCrops && <Soil d={d} language={language} />}{hasCrops && <Health d={d} language={language} />}</div>
    {farmAnalysis && <div className={`farm-analysis-result ${farmAnalysis.source === 'unavailable' ? 'unavailable' : ''}`}><div><Bot size={18}/><strong>Farm analysis</strong><small>{farmAnalysis.source === 'gemini' || farmAnalysis.source === 'gemini-fallback' || farmAnalysis.source === 'vertex-ai' ? 'Live AI' : farmAnalysis.source === 'mock-fallback' || farmAnalysis.source === 'mock' ? 'Demo fallback' : 'Unavailable'}</small></div><div className="farm-analysis-copy"><AssistantText text={farmAnalysis.answer}/></div></div>}
    <div className="content-grid"><section><SectionHeader eyebrow="RECOMMENDED FOR YOU" title={t(language, 'todaysActions')} />{advice?.items.slice(0, 2).map((item, i) => <ActionCard key={item.title} item={item} index={i}/>)}</section><section><SectionHeader eyebrow={t(language, 'yourFields').toUpperCase()} title={field?.name || t(language, 'fields')} action={<button className="text-button" onClick={onOnboard}>Manage <ArrowRight size={15}/></button>} /><div className="field-card"><FarmMap location={farm?.location} label={field ? `${field.name} · ${field.area_acres} ac` : 'No field recorded'} /><div className="field-details"><div><strong>{field?.name || t(language, 'livestockGroups')}</strong><span className="healthy"><span className="status-dot"/> {farm?.farm_type || 'crops'}</span></div><small>{field ? `${field.crop}${field.growth_stage ? ` · ${field.growth_stage}` : ''}` : (farm?.livestock || []).map(a => `${a.count} ${a.species}`).join(' · ')}</small><div className="field-meta"><span>Moisture <b>{hasCrops && d?.soil.moisture_percent != null ? `${Math.round(d.soil.moisture_percent)}%` : '—'}</b></span><span>{d?.satellite.source === 'isro-bhuvan-wms' ? 'ISRO WMS' : d?.satellite.source === 'isro-bhuvan-lulc-250k' ? 'ISRO LULC 250K' : d?.satellite.ndvi != null ? 'NDVI' : 'Satellite'} <b>{d?.satellite.source === 'isro-bhuvan-wms' ? 'Map layer' : d?.satellite.source === 'isro-bhuvan-lulc-250k' ? `${d.satellite.land_cover?.[0]?.share_percent ?? 0}%` : hasCrops && d?.satellite.ndvi != null ? d.satellite.ndvi.toFixed(2) : '—'}</b></span></div></div></div></section></div>
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
  const bhuvanWms = source === 'isro-bhuvan-wms'
  const bhuvanStats = source === 'isro-bhuvan-lulc-250k'
  const bhuvan = bhuvanWms || bhuvanStats
  const cover = d?.satellite.land_cover || []
  const healthLabel = bhuvanWms ? 'Map layer' : bhuvanStats ? 'Land-cover context' : ndvi == null || !health || health === 'unavailable' ? 'Unavailable' : `${health[0].toUpperCase()}${health.slice(1)}`
  return <div className="pulse-card"><div className="card-top"><div><span className="eyebrow">{bhuvan ? 'ISRO LAND COVER' : t(language, 'fieldHealth').toUpperCase()} · {source}</span><h3>{healthLabel}</h3><p><span className={`status-dot ${source === 'unavailable' ? 'yellow' : 'green'}`}/> {bhuvanWms ? 'Bhuvan WMS · reference imagery' : bhuvanStats ? 'Bhuvan LULC 250K · AOI statistics' : source === 'mock-satellite' ? 'Demo estimate' : 'No live satellite data'}</p></div><Leaf className="card-art green"/></div>{bhuvanWms ? <div className="mini-note">Bhuvan’s historical land-cover layer is available on the field map. It is not live crop health or NDVI.</div> : bhuvanStats && cover.length > 0 ? <div className="lulc-classes">{cover.slice(0, 3).map(item => <div key={item.code}><span>{item.label}</span><strong>{item.share_percent}%</strong></div>)}</div> : <div className="meter"><span style={{ width: `${ndvi == null ? 0 : Math.max(0, ndvi) * 100}%` }}/></div>}{!bhuvanWms && <div className="mini-note">{bhuvanStats ? 'Historical Bhuvan 250K regional land-cover mix around the farm pin. It is not live crop health, NDVI, or a surveyed field boundary.' : source === 'unavailable' ? d?.satellite.availability_message || 'Bhuvan LULC statistics are unavailable. Check the daily API token and farm location.' : ndvi == null ? 'No live satellite field-health data is configured.' : `NDVI ${ndvi.toFixed(2)} near the farm pin; not a parcel-level diagnosis.`}</div>}</div>
}
function ActionCard({ item, index }: { item: Advisory['items'][number]; index: number }) { return <div className="action-card"><div className={`action-number n${index}`}>{index === 0 ? <Droplets size={18}/> : <Leaf size={18}/>}</div><div><div className="action-title"><strong>{item.title}</strong><span className={`priority ${item.priority}`}>{item.priority}</span></div><p>{item.action}</p><small>{item.reason}</small></div><ChevronRight className="action-arrow" size={18}/></div> }
function FarmMap({ location, label }: { location?: Location; label: string }) {
  const hasCoordinates = !!location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
  const stateCodes: Record<string, string> = {
    andhrapradesh: 'AP', arunachalpradesh: 'AR', assam: 'AS', bihar: 'BR', chhattisgarh: 'CG',
    goa: 'GA', gujarat: 'GJ', haryana: 'HR', himachalpradesh: 'HP', jharkhand: 'JH',
    karnataka: 'KA', kerala: 'KL', madhyapradesh: 'MP', maharashtra: 'MH', manipur: 'MN',
    meghalaya: 'ML', mizoram: 'MZ', nagaland: 'NL', odisha: 'OR', orissa: 'OR', punjab: 'PB',
    rajasthan: 'RJ', sikkim: 'SK', tamilnadu: 'TN', telangana: 'TS', tripura: 'TR',
    uttarpradesh: 'UP', uttarakhand: 'UK', uttaranchal: 'UK', westbengal: 'WB',
    andamanandnicobarislands: 'AN', chandigarh: 'CH', dadraandnagarhavelianddamananddiu: 'DD',
    delhi: 'DL', nctofdelhi: 'DL', jammuandkashmir: 'JK', ladakh: 'LA', lakshadweep: 'LD',
    puducherry: 'PY', pondicherry: 'PY',
  }
  const normalizedState = (location?.state || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '')
  const stateCode = stateCodes[normalizedState] || Object.entries(stateCodes).find(([name]) => normalizedState.endsWith(name))?.[1]
  const [mapLayer, setMapLayer] = useState<'street' | 'lulc'>('street')
  const [wmsFailed, setWmsFailed] = useState(false)
  const streetMapUrl = hasCoordinates ? (() => {
    const latitude = location!.latitude
    const longitude = location!.longitude
    const longitudePadding = 0.006 / Math.max(Math.abs(Math.cos(latitude * Math.PI / 180)), 0.15)
    const params = new URLSearchParams({
      bbox: `${longitude - longitudePadding},${latitude - 0.006},${longitude + longitudePadding},${latitude + 0.006}`,
      layer: 'mapnik',
      marker: `${latitude},${longitude}`,
    })
    return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`
  })() : undefined
  const wmsUrl = hasCoordinates && stateCode ? (() => {
    const latitude = location!.latitude
    const longitude = location!.longitude
    const latitudePadding = 0.003
    const longitudePadding = latitudePadding * 3 / Math.max(Math.abs(Math.cos(latitude * Math.PI / 180)), 0.15)
    const params = new URLSearchParams({
      SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap',
      LAYERS: `lulc:${stateCode}_LULC50K_1516`, STYLES: 'lulc:LULC50K_1516_NEW',
      SRS: 'EPSG:4326',
      BBOX: `${longitude - longitudePadding},${latitude - latitudePadding},${longitude + longitudePadding},${latitude + latitudePadding}`,
      WIDTH: '900', HEIGHT: '300', FORMAT: 'image/png', TRANSPARENT: 'FALSE',
    })
    return `https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms?${params.toString()}`
  })() : undefined
  useEffect(() => { setWmsFailed(false) }, [wmsUrl])
  const showLulc = mapLayer === 'lulc' && !!wmsUrl && !wmsFailed
  return <div className={`field-map ${hasCoordinates ? 'has-live-map' : 'map-no-location'}`}>
    {hasCoordinates && <div className="map-layer-switch" aria-label="Map layer">
      <button type="button" className={!showLulc ? 'selected' : ''} onClick={() => setMapLayer('street')}>Street</button>
      <button type="button" className={showLulc ? 'selected' : ''} disabled={!wmsUrl} onClick={() => setMapLayer('lulc')}>ISRO LULC</button>
    </div>}
    {showLulc ? <><img className="bhuvan-wms-image" src={wmsUrl} alt={`Bhuvan historical land-cover map near ${label}`} onError={() => setWmsFailed(true)}/><span className="wms-center-pin" aria-hidden="true"><MapPin size={24}/></span><span className="map-attribution">ISRO/NRSC · Historical LULC 50K · 2015–16</span></> : streetMapUrl ? <iframe className="farm-map-frame" title={`Street map showing ${label}`} src={streetMapUrl} loading="lazy" referrerPolicy="no-referrer" /> : <div className="map-empty"><MapPin size={22}/><span>Set the farm location to show its map</span></div>}
    {mapLayer === 'lulc' && !stateCode && hasCoordinates && <span className="map-hint">Set the farm state to load its ISRO layer</span>}
    {wmsFailed && mapLayer === 'lulc' && <span className="map-hint">Bhuvan map unavailable; showing street map</span>}
    <span className="field-tag">{label}</span>
  </div>
}
function Fields({ dashboard, language, onDiagnose, onOnboard }: { dashboard?: Dashboard; language: string; onDiagnose: () => void; onOnboard: () => void }) {
  const profile = dashboard?.profile
  const hasCrops = !!profile?.crops.length
  return <><div className="welcome"><div><span className="eyebrow">{t(language, 'fields').toUpperCase()}</span><h1>{t(language, 'fields')}</h1><p>{profile?.farm_name || profile?.farm_type}</p></div><button className="primary-button" onClick={onOnboard}><Plus size={17}/> {t(language, 'fieldName')}</button></div><div className="fields-grid"><div className="large-field field-card"><FarmMap location={profile?.location} label={`${profile?.fields?.[0]?.name || 'Main field'} · ${profile?.fields?.[0]?.area_acres || profile?.land_area_acres || 0} acres`} /><div className="field-details"><div><strong>{profile?.fields?.[0]?.name || t(language, 'livestockGroups')}</strong><span className="healthy"><span className="status-dot"/> {profile?.farm_type}</span></div><small>{profile?.fields?.map(field => `${field.crop} · ${field.name}`).join(' | ') || 'No crop fields recorded'}</small>{hasCrops && <div className="field-meta"><span>{t(language, 'soilMoisture')} <b>{dashboard?.soil.moisture_percent != null ? `${Math.round(dashboard.soil.moisture_percent)}%` : '—'}</b></span><span>{dashboard?.satellite.source === 'isro-bhuvan-wms' ? 'ISRO WMS' : dashboard?.satellite.source === 'isro-bhuvan-lulc-250k' ? 'ISRO LULC 250K' : dashboard?.satellite.ndvi != null ? 'NDVI' : 'Satellite'} <b>{dashboard?.satellite.source === 'isro-bhuvan-wms' ? 'Map layer' : dashboard?.satellite.source === 'isro-bhuvan-lulc-250k' ? `${dashboard.satellite.land_cover?.[0]?.share_percent ?? 0}%` : dashboard?.satellite.ndvi != null ? dashboard.satellite.ndvi.toFixed(2) : '—'}</b></span></div>}</div></div><div className="field-summary"><h3>{t(language, 'livestockGroups')}</h3>{(profile?.livestock || []).map((group, index) => <p key={`${group.species}-${index}`} className="animal-summary"><strong>{group.count} {group.species}</strong>{group.breed ? ` · ${group.breed}` : ''}{group.purpose ? ` · ${group.purpose}` : ''}</p>)}{!profile?.livestock?.length && <p>No animal groups recorded.</p>}{hasCrops && <button onClick={onDiagnose}><Camera size={18}/> {t(language, 'diagnoseCrop')} <ChevronRight size={16}/></button>}<button onClick={onOnboard}><Plus size={18}/> Manage farm <ChevronRight size={16}/></button></div></div></>
}
function Advice({ advice, language }: { advice?: Advisory; language: string }) { return <><div className="welcome"><div><span className="eyebrow">DECISION SUPPORT</span><h1>{t(language, 'farmAdvice')}</h1><p>{advice?.summary}</p></div><div className="advice-badge"><Bot size={18}/> Powered by AgriAI</div></div><div className="advice-list">{advice?.items.map((item, i) => <ActionCard key={item.title} item={item} index={i}/>)}</div></> }
function Permissions({ language, notificationPermission, onRequestNotifications }: { language: string; notificationPermission: NotificationPermission | 'unsupported'; onRequestNotifications: () => void }) { const state = { location: false, camera: false, notifications: notificationPermission === 'granted' }; const items = [{ key: 'location' as const, icon: MapPin, title: t(language, 'farmLocation'), text: t(language, 'locationAccess') }, { key: 'camera' as const, icon: Camera, title: t(language, 'diagnoseCrop'), text: t(language, 'cameraAccess') }, { key: 'notifications' as const, icon: Bell, title: t(language, 'permissions'), text: notificationPermission === 'denied' ? 'Browser notifications are blocked. Change this site’s permission in your browser settings.' : notificationPermission === 'unsupported' ? 'This browser does not support desktop notifications.' : t(language, 'notificationAccess') }]; return <><div className="welcome"><div><span className="eyebrow">{t(language, 'permissions').toUpperCase()}</span><h1>{t(language, 'permissionsTitle')}</h1><p>{t(language, 'permissionsHelp')}</p></div><ShieldCheck className="hero-shield"/></div><div className="permission-card">{items.map(item => <div className="permission-row" key={item.key}><span className="permission-icon"><item.icon size={20}/></span><div><strong>{item.title}</strong><p>{item.text}</p></div>{item.key === 'notifications' ? <button className={`toggle ${state.notifications ? 'on' : ''}`} disabled={notificationPermission === 'denied' || notificationPermission === 'unsupported'} onClick={onRequestNotifications} aria-label={state.notifications ? 'Browser notifications enabled' : 'Enable browser notifications'}><span/></button> : <span className="permission-status">{item.key === 'camera' ? 'Used only when you choose a crop photo' : 'Not requested'}</span>}</div>)}<div className="privacy-box"><ShieldCheck size={18}/><span><strong>{t(language, 'privacyNotice')}</strong><br/><small>{t(language, 'privacyNotice')}</small></span></div></div></> }

function Onboarding({ profile, authName, language: uiLanguage, onClose, onSaved }: { profile?: Profile | null; authName?: string; language: string; onClose: () => void; onSaved: (p: Profile, synced: boolean) => void }) {
  const [form, setForm] = useState({ farmer_name: authName || profile?.farmer_name || '', farm_name: profile?.farm_name || '', farm_type: profile?.farm_type || 'crops', field_name: profile?.fields?.[0]?.name || 'Main field', village: profile?.location.village || '', state: profile?.location.state || '', latitude: String(profile?.location.latitude ?? ''), longitude: String(profile?.location.longitude ?? ''), area: String(profile?.land_area_acres || ''), crop: profile?.crops[0] || 'Groundnut', variety: profile?.crop_variety || '', sowing_date: profile?.sowing_date || '', growth_stage: profile?.growth_stage || '', previous_crop: profile?.previous_crop || '', language: uiLanguage || profile?.preferred_language || 'en', soil_type: profile?.soil_type || '', irrigation: profile?.irrigation || 'Rain-fed' })
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
    const saved = await api.onboarding(p); if (saved.saved) onSaved(p, saved.synced)
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
  const [history, setHistory] = useState<DiagnosisHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [fileError, setFileError] = useState('')
  const [historyUnavailable, setHistoryUnavailable] = useState(false)
  const [historySaving, setHistorySaving] = useState(false)
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    void loadDiagnosisHistory().then(setHistory).catch(() => setHistoryUnavailable(true))
  }, [])
  const chooseFile = (selected?: File) => {
    if (!selected) return
    const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)
    const isPdf = selected.type === 'application/pdf' || selected.name.toLowerCase().endsWith('.pdf')
    if (!isImage && !isPdf) { setFileError('Choose a PNG, JPG, WebP photo, or PDF.'); return }
    if (selected.size > 4 * 1024 * 1024) { setFileError('The photo or PDF must be 4 MB or smaller.'); return }
    setFileError(''); setFile(selected); setResult(undefined)
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setFileError('')
    try {
      let attachment: string | undefined
      if (file) attachment = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read the selected file.'))
        reader.readAsDataURL(file)
      })
      const isPdf = file?.type === 'application/pdf' || file?.name.toLowerCase().endsWith('.pdf')
      const diagnosis = await api.diagnose(symptoms.trim(), crop, isPdf ? undefined : attachment, isPdf ? attachment : undefined, language)
      setResult(diagnosis)
      if (diagnosis.source !== 'unavailable') {
        setHistorySaving(true)
        try {
          await saveDiagnosisHistory({ crop, symptoms: symptoms.trim(), diagnosis })
          setHistory(await loadDiagnosisHistory())
          setHistoryUnavailable(false)
        } catch { setHistoryUnavailable(true) }
        finally { setHistorySaving(false) }
      }
    } catch (error) {
      setResult({ diagnosis: error instanceof Error ? error.message : 'Crop diagnosis failed. Please try again.', confidence: null, severity: 'low', actions: [], source: 'unavailable' })
    } finally { setLoading(false) }
  }
  return <div className="modal-backdrop"><div className="modal diagnosis-modal">
    <div className="modal-heading"><div><span className="eyebrow">{t(language, 'diagnosisTitle').toUpperCase()}</span><h2>{t(language, 'diagnosisTitle')}</h2><p>{t(language, 'diagnosisHelp')}</p></div><button onClick={onClose} className="close-button"><X size={19}/></button></div>
    {result ? <div className="diagnosis-result"><div className="result-icon"><Leaf size={27}/></div><div className="result-title"><span className={`priority ${result.source === 'unavailable' ? 'medium' : result.severity}`}>{result.source === 'unavailable' ? 'Unavailable' : `${result.severity} attention`}</span><h3>{result.diagnosis}</h3><p>{result.confidence != null ? `${Math.round(result.confidence * 100)}% confidence · ` : ''}{result.source === 'gemini-vision' ? 'Gemini image analysis' : result.source}</p>{historySaving && <small>{t(language, 'historySaving')}</small>}</div>{result.actions.length > 0 && <><h4>{t(language, 'nextSteps')}</h4><ul>{result.actions.map(a => <li key={a}><Check size={16}/>{a}</li>)}</ul></>}<button className="secondary-button full" onClick={() => { setResult(undefined); setFile(undefined); setSymptoms('') }}>{t(language, 'checkAgain')}</button></div> : <form onSubmit={submit}>
      <div className="upload-box"><div className="upload-icon"><Camera size={24}/></div><strong>{file?.name || t(language, 'uploadPhoto')}</strong><small>{t(language, 'attachmentHelp')}</small><div className="upload-actions"><button type="button" className="secondary-button" onClick={() => cameraInput.current?.click()}><Camera size={15}/>{t(language, 'takePhoto')}</button><button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={15}/>{t(language, 'uploadAttachment')}</button></div><input ref={cameraInput} type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={e => chooseFile(e.target.files?.[0])}/><input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" onChange={e => chooseFile(e.target.files?.[0])}/></div>
      {fileError && <p className="auth-error">{fileError}</p>}
      <label>{t(language, 'describeSymptoms')}<div className="voice-textarea-row"><textarea required={!file} value={symptoms} onChange={e => setSymptoms(e.target.value)} placeholder="e.g. Yellow spots on the lower leaves..." rows={3}/><VoiceInputButton language={language} onTranscript={value => setSymptoms(current => `${current.trim()}${current.trim() ? ' ' : ''}${value}`)}/></div></label>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={onClose}>{t(language, 'cancel')}</button><button className="primary-button" type="submit" disabled={loading}><Bot size={16}/>{loading ? t(language, 'diagnosisLoading') : t(language, 'analyzeCrop')}</button></div>
      {historyUnavailable && <p className="history-notice" role="status">{t(language, 'historyUnavailable')}</p>}
    </form>}
    <section className="diagnosis-history"><h3>{t(language, 'historyTitle')}</h3>{history.length ? <div className="diagnosis-history-list">{history.map(entry => <article key={entry.id}><div><strong>{entry.crop || crop || 'Crop'}</strong><span>{entry.createdAt.toLocaleString()}</span></div><p>{entry.diagnosis}</p><small>{Math.round((entry.confidence || 0) * 100)}% · {entry.severity}</small></article>)}</div> : <p>{historyUnavailable ? t(language, 'historyUnavailable') : t(language, 'historyEmpty')}</p>}</section>
  </div></div>
}
function VoiceInputButton({ language, onTranscript }: { language: string; onTranscript: (transcript: string) => void }) {
  const [listening, setListening] = useState(false)
  const [message, setMessage] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  useEffect(() => () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.onerror = null
      recognitionRef.current.onresult = null
      recognitionRef.current.abort()
      recognitionRef.current = null
    }
  }, [])
  const toggle = () => {
    if (listening) { recognitionRef.current?.stop(); setListening(false); return }
    if (!window.isSecureContext) { setMessage('Voice input needs HTTPS (localhost is supported).'); return }
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!Recognition) { setMessage('Voice input is unavailable in this browser. Try Chrome or enter text.'); return }
    const recognition = new Recognition()
    recognition.lang = speechLocales[language] || 'en-IN'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = event => {
      const transcript = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ').trim()
      if (transcript) { onTranscript(transcript); setMessage('') }
    }
    recognition.onerror = event => {
      const errors: Record<string, string> = {
        'not-allowed': 'Allow microphone access in your browser to dictate.',
        'service-not-allowed': 'Speech recognition is blocked by this browser.',
        'language-not-supported': 'This browser does not support recognition for the selected language.',
        'no-speech': 'No speech was detected. Tap the mic and try again.',
        network: 'Speech recognition needs an internet connection.',
      }
      setMessage(errors[event.error] || 'Voice input stopped. Please try again.')
      setListening(false)
    }
    recognition.onend = () => { setListening(false); recognitionRef.current = null }
    recognitionRef.current = recognition
    setMessage('')
    try { recognition.start(); setListening(true) }
    catch { recognitionRef.current = null; setListening(false); setMessage('Could not start the microphone. Please try again.') }
  }
  return <span className={`voice-control ${listening ? 'listening' : ''}`}>
    <button type="button" className="voice-button" onClick={toggle} aria-label={listening ? 'Stop voice input' : `Dictate in ${languages.find(item => item.code === language)?.label || 'selected language'}`} aria-pressed={listening} title={listening ? 'Stop listening' : 'Speak your text'}>{listening ? <MicOff size={18}/> : <Mic size={18}/>}</button>
    {(message || listening) && <span className="voice-status" role="status">{message || `Listening in ${speechLocales[language] || 'en-IN'}…`}</span>}
  </span>
}

function Assistant({ crop, language, onClose }: { crop?: string; language: string; onClose: () => void }) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<{ question: string; answer?: string; source?: string }[]>([])
  const [loading, setLoading] = useState(false)
  const conversationEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { conversationEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, loading])
  const sendQuestion = async (value: string) => {
    if (!value.trim() || loading) return
    const submittedQuestion = value.trim()
    const messageIndex = messages.length
    setQuestion('')
    setMessages(current => [...current, { question: submittedQuestion }])
    setLoading(true)
    try {
      const result = await api.ask(submittedQuestion, crop, language)
      setMessages(current => current.map((message, index) => index === messageIndex ? { ...message, answer: result.answer, source: result.source } : message))
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'AgriAI could not answer this request. Please try again.'
      setMessages(current => current.map((message, index) => index === messageIndex ? { ...message, answer: detail, source: 'unavailable' } : message))
    }
    finally { setLoading(false) }
  }
  const ask = (e: React.FormEvent) => { e.preventDefault(); void sendQuestion(question) }
  return <div className="assistant-panel"><div className="assistant-head"><div><span className="assistant-avatar"><Bot size={20}/></span><div><strong>{t(language, 'askAI')}</strong><small>{t(language, 'preferredLanguage')}</small></div></div><button onClick={onClose}><X size={19}/></button></div><div className="assistant-body"><div className="bot-message"><span className="assistant-avatar tiny"><Bot size={15}/></span><p>{t(language, 'assistantGreeting')}</p></div>{messages.map((message, index) => <div className="conversation-turn" key={`${index}-${message.question}`}><div className="question-bubble">{message.question}</div>{message.answer ? <div className="answer-row"><span className="assistant-avatar tiny"><Bot size={15}/></span><div className="assistant-reply"><AssistantText text={message.answer}/>    <small className="answer-source">{message.source === 'unavailable' ? 'AI unavailable' : message.source === 'mock-fallback' || message.source === 'mock' ? 'Demo fallback advice' : message.source === 'gemini-fallback' ? 'Answered by Gemini API fallback' : `Answered by ${message.source}`}</small></div></div> : <div className="answer-row"><span className="assistant-avatar tiny"><Bot size={15}/></span><div className="assistant-reply pending-reply">{t(language, 'thinking')}</div></div>}</div>)}{messages.length === 0 && <div className="suggestions"><button type="button" disabled={loading} onClick={() => void sendQuestion(t(language, 'irrigationQuestion'))}>{t(language, 'irrigationQuestion')}</button><button type="button" disabled={loading} onClick={() => void sendQuestion(t(language, 'improveSoilQuestion'))}>{t(language, 'improveSoilQuestion')}</button></div>}<div ref={conversationEnd}/></div><form className="assistant-input" onSubmit={ask}><input value={question} onChange={e => setQuestion(e.target.value)} placeholder={loading ? t(language, 'thinking') : t(language, 'questionPlaceholder')} /><VoiceInputButton language={language} onTranscript={value => setQuestion(current => `${current.trim()}${current.trim() ? ' ' : ''}${value}`)}/><button aria-label="Send question" disabled={loading || !question.trim()}><ArrowRight size={17}/></button></form></div>
}

function AssistantText({ text }: { text: string }) {
  const normalized = text.replace(/\r/g, '').replace(/\s+\*\s+(?=[A-Z][^*\n]{1,80}:)/g, '\n- ')
  const lines = normalized.split('\n')
  const renderInline = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.replace(/\*\*/g, ''),
  )
  const blocks: React.ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | undefined
  const flushList = () => {
    if (!list) return
    const List = list.ordered ? 'ol' : 'ul'
    blocks.push(<List key={`list-${blocks.length}`}>{list.items.map((item, index) => <li key={index}>{renderInline(item)}</li>)}</List>)
    list = undefined
  }

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) { flushList(); return }
    const heading = line.match(/^#{1,3}\s+(.+)$/)
    const ordered = line.match(/^\d+[.)]\s+(.+)$/)
    const unordered = line.match(/^[-*•]\s+(.+)$/)
    if (ordered || unordered) {
      const isOrdered = !!ordered
      if (!list || list.ordered !== isOrdered) { flushList(); list = { ordered: isOrdered, items: [] } }
      list.items.push((ordered || unordered)![1])
      return
    }
    flushList()
    if (heading) blocks.push(<h4 key={`heading-${index}`}>{renderInline(heading[1])}</h4>)
    else blocks.push(<p key={`paragraph-${index}`}>{renderInline(line.replace(/^\*\*(.+?)\*\*\s*/, '**$1** '))}</p>)
  })
  flushList()
  return <div className="assistant-text">{blocks}</div>
}

export default App
