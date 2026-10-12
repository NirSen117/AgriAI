import { collection, doc, getDoc, getDocs, getFirestore, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { getApp } from 'firebase/app'
import type { Profile } from './api'

export type FarmEntry = { id: string; profile: Profile }
export type FarmCollection = { farms: FarmEntry[]; activeFarmId?: string }

const db = () => getFirestore(getApp())
const legacyFarmDocument = (uid: string) => doc(db(), 'users', uid, 'farm', 'profile')
const selectionDocument = (uid: string) => doc(db(), 'users', uid, 'farm', 'selection')
const farmsCollection = (uid: string) => collection(db(), 'users', uid, 'farms')
const farmDocument = (uid: string, id: string) => doc(db(), 'users', uid, 'farms', id)
const makeFarmId = (): string => globalThis.crypto?.randomUUID?.() || `farm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

/** Load all account farms, migrating the original single-profile document on first use. */
export async function loadFarmProfiles(uid: string): Promise<FarmCollection> {
  const [farmsSnapshot, legacySnapshot, selectionSnapshot] = await Promise.all([
    getDocs(farmsCollection(uid)), getDoc(legacyFarmDocument(uid)), getDoc(selectionDocument(uid)),
  ])
  let farms: FarmEntry[] = farmsSnapshot.docs.flatMap(snapshot => {
    const profile = snapshot.data()?.profile
    return profile && typeof profile === 'object' ? [{ id: snapshot.id, profile: profile as Profile }] : []
  })
  if (!farms.length) {
    const legacy = legacySnapshot.data()?.profile
    if (legacy && typeof legacy === 'object') {
      const profile = legacy as Profile
      await setDoc(farmDocument(uid, 'primary'), { profile, updatedAt: serverTimestamp() })
      farms = [{ id: 'primary', profile }]
    }
  }
  let activeFarmId = selectionSnapshot.data()?.activeFarmId
  if (!farms.some(farm => farm.id === activeFarmId)) activeFarmId = farms[0]?.id
  if (activeFarmId && selectionSnapshot.data()?.activeFarmId !== activeFarmId) {
    await setDoc(selectionDocument(uid), { activeFarmId, updatedAt: serverTimestamp() })
  }
  return { farms, activeFarmId }
}

/** Write the currently selected profile to the legacy document for backend compatibility. */
async function mirrorActiveFarm(uid: string, id: string, profile: Profile): Promise<void> {
  await Promise.all([
    setDoc(farmDocument(uid, id), { profile, updatedAt: serverTimestamp() }),
    setDoc(selectionDocument(uid), { activeFarmId: id, updatedAt: serverTimestamp() }),
    setDoc(legacyFarmDocument(uid), { profile, updatedAt: serverTimestamp() }),
  ])
}

export async function activateFarm(uid: string, id: string): Promise<Profile> {
  const farm = (await getDoc(farmDocument(uid, id))).data()?.profile
  if (!farm || typeof farm !== 'object') throw new Error('This farm could not be found in your account.')
  await Promise.all([
    setDoc(selectionDocument(uid), { activeFarmId: id, updatedAt: serverTimestamp() }),
    setDoc(legacyFarmDocument(uid), { profile: farm, updatedAt: serverTimestamp() }),
  ])
  return farm as Profile
}

export async function loadFarmProfile(uid: string): Promise<Profile | null> {
  const collection = await loadFarmProfiles(uid)
  return collection.farms.find(farm => farm.id === collection.activeFarmId)?.profile || null
}

/** Preserve first-profile migration behavior if the backend already has a profile. */
export async function saveFarmProfileIfMissing(uid: string, candidate: Profile): Promise<Profile> {
  const existing = await loadFarmProfiles(uid)
  if (existing.farms.length) return existing.farms.find(farm => farm.id === existing.activeFarmId)?.profile || existing.farms[0].profile
  const reference = farmDocument(uid, 'primary')
  const profile = await runTransaction(db(), async transaction => {
    const snapshot = await transaction.get(reference)
    const stored = snapshot.data()?.profile
    if (stored && typeof stored === 'object') return stored as Profile
    transaction.set(reference, { profile: candidate, updatedAt: serverTimestamp() })
    return candidate
  })
  await mirrorActiveFarm(uid, 'primary', profile)
  return profile
}

export async function saveFarmProfile(uid: string, profile: Profile, id = makeFarmId()): Promise<string> {
  await mirrorActiveFarm(uid, id, profile)
  return id
}
