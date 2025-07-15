import db from "../db/firebase"
import NodeCache from "node-cache"
import { storedTokenClient } from "./ea_client"
import { DEPLOYMENT_URL } from "../config"

const changeCache = new NodeCache()
const hash: (a: any) => string = require("object-hash")

interface LatestLeagues {
  getLatestLeagues(): string[]
}

async function getLatestLeagues(): Promise<LatestLeagues> {

  const collection = db.collection("league_data")
  const docs = await collection.get()
  let leagues = docs.docs.map(d => d.id)
  collection.onSnapshot(querySnapshot => {
    console.log("Leagues being updated")
    leagues = querySnapshot.docs.map(d => d.id)
  })
  return {
    getLatestLeagues() {
      return leagues
    }
  }
}

async function checkLeague(leagueId: string) {
  console.log(`Checking league ${leagueId}`)
  const client = await storedTokenClient(Number(leagueId))
  const leagueData = await client.getLeagueInfo(Number(leagueId))
  const leagueHash = {
    currentWeek: leagueData.careerHubInfo.seasonInfo.seasonWeek,
    currentGames: leagueData.gameScheduleHubInfo.leagueSchedule.map(game => game.seasonGameInfo.result),
  }
  const newHash = hash(leagueHash)
  if (newHash !== changeCache.get(leagueId)) {
    console.log(`Detected change in ${leagueId}`)
    await fetch(`https://${DEPLOYMENT_URL}/dashboard/league/${leagueId}/export`,
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

async function runLeagueChecks() {
  const latestLeagues = await getLatestLeagues()

  while (true) {
    const leagues = latestLeagues.getLatestLeagues()
    for (const leagueId of leagues) {
      // avoid any overloading of EA
      await sleep(5000)
      try {
        await checkLeague(leagueId)
      } catch (e) {
        console.error(`Error checking league ${leagueId}: ${e}`)
      }
    }
    console.log("Check complete, sleeping for 5 minutes...\n")
    await fetch("https://hc-ping.com/82b9220a-02cf-4ca1-9385-3c8b9463cff3")
    await sleep(5 * 60 * 1000)
  }
}

runLeagueChecks()
