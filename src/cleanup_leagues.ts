import db from "./db/firebase"
import LeagueSettingsDB from "./discord/settings_db"

async function getStaleDocuments() {
  const collectionRef = db.collection('madden_data26')

  // Calculate the date 30 days ago
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Get all documents
  const snapshot = await collectionRef.get()

  const stale = await Promise.all(snapshot.docs.map(async doc => {
    // Use Firestore metadata timestamps
    const updateTime = doc.updateTime.toDate()
    if (updateTime < thirtyDaysAgo) {
      const leagueId = doc.id
      const settings = await LeagueSettingsDB.getLeagueSettingsForLeagueId(leagueId)
      if (settings.length === 0) {
        return [leagueId, true]
      }
    }
    return [doc.id, false]
  }
  ))

  const staleLeagues = stale.filter(e => e[1]).map(e => e[0])

  console.log(`Found ${staleLeagues.length} documents not modified in 30 days`)
  console.log(staleLeagues)
}

getStaleDocuments()
