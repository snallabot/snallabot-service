import db from "../db/firebase"
import { storedTokenClient } from "./ea_client"
import { leaguesCheckedCount, leaguesErroredCount, leagueCheckCycleDuration, pushMetrics, leagueCheckLastCompleted } from "../debug/metrics_push"


async function getLatestLeagues(): Promise<string[]> {
  const collection = db.collection("league_connection").where("blazeId", "!=", null)
  const docs = await collection.get()
  return docs.docs.map(d => d.id)
}

async function checkLeague(leagueId: string) {
  console.log(`Checking league ${leagueId}`)
  const client = await storedTokenClient(Number(leagueId))
  await client.getLeagueInfo(Number(leagueId))
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const SLEEP_MIN = 60

async function runLeagueChecks() {
  while (true) {
    const cycleStart = Date.now()
    const leagues = await getLatestLeagues()
    let errorCount = 0

    for (const leagueId of leagues) {
      // avoid any overloading of EA
      await sleep(12000)
      try {
        await checkLeague(leagueId)
      } catch (e) {
        errorCount++
        console.error(`Error checking league ${leagueId}: ${e}`)
      }
    }

    const cycleDuration = (Date.now() - cycleStart) / 1000
    leaguesCheckedCount.set(leagues.length)
    leaguesErroredCount.set(errorCount)
    leagueCheckCycleDuration.set(cycleDuration)
    leagueCheckLastCompleted.set(Math.floor(Date.now() / 1000))
    await pushMetrics('league_check', 'snallabot-service')

    console.log(`Check complete, sleeping for ${SLEEP_MIN} minutes...\n`)
    await sleep(SLEEP_MIN * 5 * 1000)
  }
}

runLeagueChecks()
