import { FormEvent, useState } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { AuthUser, firebaseAuth } from './firebaseAuth'

export function AuthModal({ onClose, onAuthenticated }: { onClose: () => void; onAuthenticated: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [farmerName, setFarmerName] = useState('')
  const [showEmailForm, setShowEmailForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (farmerName.trim().length < 2) { setError('Please enter your name.'); return }
    setSubmitting(true)
    try {
      let user: AuthUser
      if (mode === 'sign-in') {
        await firebaseAuth.signIn(email, password)
        user = await firebaseAuth.setDisplayName(farmerName)
      } else {
        user = await firebaseAuth.signUp(email, password, farmerName)
      }
      onAuthenticated(user)
    } catch (reason) {
      setError(authenticationError(reason))
    } finally {
      setSubmitting(false)
    }
  }

  const googleSignIn = async () => {
    setError('')
    setSubmitting(true)
    try {
      const user = await firebaseAuth.signInWithGoogle()
      if (user) onAuthenticated(user)
    } catch (reason) {
      setError(authenticationError(reason))
      setSubmitting(false)
    }
  }

  const isChoiceScreen = mode === 'sign-in' && !showEmailForm
  return <div className="modal-backdrop"><div className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <div className="modal-heading"><div>
      <span className="eyebrow">FARMER ACCOUNT</span>
      <h2 id="auth-title">{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</h2>
      <p>Save your farm profile and access it securely.</p>
    </div><button onClick={onClose} className="close-button" aria-label="Close sign in"><X size={19}/></button></div>

    {isChoiceScreen ? <div className="auth-options">
      <button className="google-button" onClick={googleSignIn} disabled={submitting}>
        <GoogleMark /> {submitting ? 'Please wait…' : 'Continue with Google'}
      </button>
      <div className="auth-divider"><span>or</span></div>
      <button className="secondary-button email-option" onClick={() => { setShowEmailForm(true); setError('') }}>Continue with email <ArrowRight size={16}/></button>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-switch" onClick={() => { setMode('sign-up'); setShowEmailForm(true); setError('') }}>New to AgriAI? Create an account</button>
    </div> : <>
      <form onSubmit={submit} className="auth-form">
        <label>Your name<input type="text" value={farmerName} onChange={event => setFarmerName(event.target.value)} autoComplete="name" minLength={2} maxLength={80} required /></label>
        <label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={6} required /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="primary-button" disabled={submitting}>{submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in with email' : 'Create account'} <ArrowRight size={16}/></button>
      </form>
      <button className="auth-switch" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setShowEmailForm(true); setError('') }}>{mode === 'sign-in' ? 'New to AgriAI? Create an account' : 'Already have an account? Sign in'}</button>
      {mode === 'sign-in' && <button className="auth-back" onClick={() => { setShowEmailForm(false); setError('') }}><ArrowLeft size={14}/> All sign-in options</button>}
    </>}
  </div></div>
}

function authenticationError(reason: unknown): string {
  const code = typeof reason === 'object' && reason && 'code' in reason ? String(reason.code) : ''
  if (code === 'auth/operation-not-allowed') return 'This sign-in method is not enabled in Firebase Authentication yet.'
  if (code === 'auth/unauthorized-domain') return 'This website domain is not authorized in Firebase Authentication.'
  if (code === 'auth/popup-blocked') return 'The Google sign-in popup was blocked. Allow popups and try again.'
  if (code === 'auth/popup-closed-by-user') return 'Google sign-in was closed before it finished.'
  if (code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') return 'That email or password is incorrect.'
  if (reason instanceof Error) return reason.message
  return 'Authentication failed. Please try again.'
}

function GoogleMark() {
  return <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.65 5.93c4.46-4.12 7.12-10.18 7.12-17.58Z"/><path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.13.76-4.59l-7.98-6.2A23.95 23.95 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19Z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.9-5.87l-7.65-5.93c-2.13 1.43-4.86 2.28-8.25 2.28-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/></svg>
}
