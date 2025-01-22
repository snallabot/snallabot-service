import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync } from "node:fs";

function setupFirebase() {
  // production, use firebase with SA credentials passed from environment or a file
  if (process.env.SERVICE_ACCOUNT_FILE) {
    const serviceAccount = JSON.parse(readFileSync(process.env.SERVICE_ACCOUNT_FILE, 'utf8'))
    initializeApp({
      credential: cert(serviceAccount)
    })
  } else if (process.env.SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT)
    initializeApp({
      credential: cert(serviceAccount)
    })
  }
  // dev, use firebase emulator
  else {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error("Firestore emulator is not running!")
    }
    initializeApp({ projectId: "dev" })
  }
  return getFirestore()
}
const db = setupFirebase()
export default db
