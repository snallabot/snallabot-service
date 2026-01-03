import db from "../db/firebase"
import NodeCache from "node-cache"
import { storedTokenClient } from "./ea_client"
import { DEPLOYMENT_URL } from "../config"

const changeCache = new NodeCache()
const hash: (a: any) => string = require("object-hash")

async function getLatestLeagues(): Promise<string[]> {
  const collection = db.collection("madden_data26").where("blazeId", "!=", null)
  const docs = await collection.get()
  return docs.docs.map(d => d.id)
}

async function checkLeague(leagueId: string) {
  console.log(`Checking league ${leagueId}`)
  const client = await storedTokenClient(Number(leagueId))
  const leagueData = await client.getLeagueInfo(Number(leagueId))
  const leagueHash = {
    currentWeek: leagueData.careerHubInfo.seasonInfo.seasonWeek,
    currentGamesPlayed: leagueData.gameScheduleHubInfo.leagueSchedule.filter(game => game.seasonGameInfo.isGamePlayed).length,
  }
  const newHash = hash(leagueHash)
  if (newHash !== changeCache.get(leagueId)) {
    console.log(`Detected change in ${leagueId}`)
    await fetch(`${DEPLOYMENT_URL}/dashboard/league/${leagueId}/export`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          exportOption: "Current Week"
        })
      }
    )
    changeCache.set(leagueId, newHash)
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const SLEEP_MIN = 60
async function runLeagueChecks() {
  while (true) {
    const leagues = await getLatestLeagues()
    for (const leagueId of leagues) {
      // avoid any overloading of EA
      await sleep(5000)
      try {
        await checkLeague(leagueId)
      } catch (e) {
        console.error(`Error checking league ${leagueId}: ${e}`)
      }
    }
    console.log(`Check complete, sleeping for ${SLEEP_MIN} minutes...\n`)
    await fetch("https://hc-ping.com/82b9220a-02cf-4ca1-9385-3c8b9463cff3")
    await sleep(SLEEP_MIN * 60 * 1000)
  }
}

runLeagueChecks()
