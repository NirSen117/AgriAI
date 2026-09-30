import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, updateProfile, type User } from 'firebase/auth'

export type AuthUser = {
  email: string
  uid: string
  displayName?: string
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

const configured = Object.values(firebaseConfig).slice(0, 6).every(Boolean)
const auth = configured
  ? getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig))
  : undefined

function toAuthUser(user: User): AuthUser {
  return { email: user.email || '', uid: user.uid, displayName: user.displayName || undefined }
}

export const firebaseAuth = {
  configured,
  currentUser: (): AuthUser | undefined => auth?.currentUser ? toAuthUser(auth.currentUser) : undefined,
  getIdToken: async (): Promise<string | undefined> => auth?.currentUser ? auth.currentUser.getIdToken() : undefined,
  subscribe: (callback: (user: AuthUser | undefined) => void) => {
    if (!auth) { callback(undefined); return () => undefined }
    return onAuthStateChanged(auth, user => callback(user ? toAuthUser(user) : undefined))
  },
  signIn: async (email: string, password: string) => {
    if (!auth) throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* values to frontend/.env.local.')
    const result = await signInWithEmailAndPassword(auth, email, password)
    return toAuthUser(result.user)
  },
  signUp: async (email: string, password: string, displayName: string) => {
    if (!auth) throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* values to frontend/.env.local.')
    const result = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(result.user, { displayName: displayName.trim() })
    return toAuthUser(result.user)
  },
  setDisplayName: async (displayName: string) => {
    if (!auth?.currentUser) throw new Error('Sign in before saving your name.')
    await updateProfile(auth.currentUser, { displayName: displayName.trim() })
    return toAuthUser(auth.currentUser)
  },
  signInWithGoogle: async () => {
    if (!auth) throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* values to frontend/.env.local.')
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    // Redirect is more reliable than a popup on mobile browsers.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 650px)').matches) {
      await signInWithRedirect(auth, provider)
      return undefined
    }
    const result = await signInWithPopup(auth, provider)
    return toAuthUser(result.user)
  },
  signOut: () => auth ? signOut(auth) : Promise.resolve(),
}
