import { Timestamp } from "firebase-admin/firestore"
import db from "./firebase"
import { MaddenEvents, ExportStatus, LeagueDoc } from "./madden_shared"

// League metadata / exportStatus stays on Firestore regardless of where the game-data
// (teams/standings/schedule/stats/players) lives - shared by both madden_db.ts (Firestore)
// and madden_postgres.ts (Postgres) so this isn't duplicated in a file that's supposed to
// be about game-data storage.

function convertDate(firebaseObject: any) {
  if (!firebaseObject) return null;

  for (const [key, value] of Object.entries(firebaseObject)) {

    // covert items inside array
    if (value && Array.isArray(value))
      firebaseObject[key] = value.map(item => convertDate(item));

    // convert inner objects
    if (value && typeof value === 'object') {
      firebaseObject[key] = convertDate(value);
    }

    // convert simple properties
    if (value && value.hasOwnProperty('_seconds'))
      firebaseObject[key] = (value as Timestamp).toDate();
  }
  return firebaseObject;
}

export async function updateLeagueExportStatus(leagueId: string, eventType: MaddenEvents) {
  await db.collection("madden_data26").doc(leagueId).set({
    exportStatus: {
      [eventType]: { lastExported: new Date() }
    }
  }, { merge: true })
}

export async function updateWeeklyExportStatus(leagueId: string, eventType: MaddenEvents, weekIndex: number, season: number) {
  const weekKey = `season${String(season).padStart(2, '0')}_week${String(weekIndex).padStart(2, '0')}`
  await db.collection("madden_data26").doc(leagueId).set({
    exportStatus: {
      weeklyStatus: {
        [weekKey]: {
          [eventType]: { lastExported: new Date() }
        }
      }
    }
  }, { merge: true })
}

export async function updateRosterExportStatus(leagueId: string, eventType: MaddenEvents.MADDEN_PLAYER, teamId: string) {
  await db.collection("madden_data26").doc(leagueId).set({
    exportStatus: {
      rosterStatus: {
        [teamId]: {
          [eventType]: { lastExported: new Date() }
        }
      }
    }
  }, { merge: true })
}

export async function getExportStatus(leagueId: string): Promise<ExportStatus | undefined> {
  const doc = await db.collection("madden_data26").doc(leagueId).get()
  if (doc.exists) {
    const leagueDoc = convertDate(doc.data()) as LeagueDoc
    return leagueDoc.exportStatus
  }
  return undefined
}
