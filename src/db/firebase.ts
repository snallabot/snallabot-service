import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync } from "node:fs";

function setupFirebase() {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    initializeApp({ projectId: "dev" })
  }
  // production, use firebase with SA credentials passed from environment or a file
  else if (process.env.SERVICE_ACCOUNT_FILE) {
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
    throw new Error("Firestore emulator is not running!")
  }
  return getFirestore()
}
const db = setupFirebase()
export default db
