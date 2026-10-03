import { collection, getDocs, getFirestore, limit, orderBy, query, serverTimestamp, addDoc, type Timestamp } from 'firebase/firestore'
import { getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import type { Diagnosis } from './api'

export type DiagnosisHistoryEntry = Diagnosis & {
  id: string
  crop?: string
  symptoms?: string
  createdAt: Date
}

function userCollection() {
  const user = getAuth(getApp()).currentUser
  if (!user) throw new Error('Sign in to save and view crop-check history.')
  return collection(getFirestore(getApp()), 'users', user.uid, 'diagnosisHistory')
}

export async function saveDiagnosisHistory(input: {
  crop?: string
  symptoms?: string
  diagnosis: Diagnosis
}): Promise<void> {
  const { diagnosis, crop, symptoms } = input
  await addDoc(userCollection(), {
    crop: crop || '',
    symptoms: (symptoms || '').slice(0, 2000),
    diagnosis: diagnosis.diagnosis.slice(0, 1500),
    confidence: diagnosis.confidence ?? null,
    severity: diagnosis.severity,
    actions: diagnosis.actions.slice(0, 8).map(action => action.slice(0, 300)),
    source: diagnosis.source.slice(0, 80),
    createdAt: serverTimestamp(),
  })
}

export async function loadDiagnosisHistory(): Promise<DiagnosisHistoryEntry[]> {
  const records = await getDocs(query(userCollection(), orderBy('createdAt', 'desc'), limit(20)))
  return records.docs.map(record => {
    const data = record.data()
    const timestamp = data.createdAt as Timestamp | undefined
    return {
      id: record.id,
      crop: typeof data.crop === 'string' ? data.crop : undefined,
      symptoms: typeof data.symptoms === 'string' ? data.symptoms : undefined,
      diagnosis: typeof data.diagnosis === 'string' ? data.diagnosis : 'Saved crop check',
      confidence: typeof data.confidence === 'number' ? data.confidence : null,
      severity: data.severity === 'high' || data.severity === 'medium' ? data.severity : 'low',
      actions: Array.isArray(data.actions) ? data.actions.filter((action): action is string => typeof action === 'string') : [],
      source: typeof data.source === 'string' ? data.source : 'unknown',
      createdAt: timestamp?.toDate() || new Date(),
    }
  })
}
