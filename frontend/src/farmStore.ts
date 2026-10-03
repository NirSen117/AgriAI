import { doc, getDoc, getFirestore, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { getApp } from 'firebase/app'
import type { Profile } from './api'

const farmDocument = (uid: string) => doc(getFirestore(getApp()), 'users', uid, 'farm', 'profile')

export async function loadFarmProfile(uid: string): Promise<Profile | null> {
  const snapshot = await getDoc(farmDocument(uid))
  const profile = snapshot.data()?.profile
  return profile && typeof profile === 'object' ? profile as Profile : null
}

/** Keep the first existing profile as the shared profile when migrating old device/backend data. */
export async function saveFarmProfileIfMissing(uid: string, candidate: Profile): Promise<Profile> {
  const reference = farmDocument(uid)
  return runTransaction(getFirestore(getApp()), async transaction => {
    const snapshot = await transaction.get(reference)
    const existing = snapshot.data()?.profile
    if (existing && typeof existing === 'object') return existing as Profile
    transaction.set(reference, { profile: candidate, updatedAt: serverTimestamp() })
    return candidate
  })
}

export async function saveFarmProfile(uid: string, profile: Profile): Promise<void> {
  await setDoc(farmDocument(uid), { profile, updatedAt: serverTimestamp() })
}
