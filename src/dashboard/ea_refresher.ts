import db from "../db/firebase"
import NodeCache from "node-cache"
import { storedTokenClient } from "./ea_client"
import { Stage } from "./ea_constants"

const changeCache = new NodeCache()
const hash: (a: any) => string = require("object-hash")

interface LatestLeagues {
  getLatestLeagues(): string[]
}

function getLatestLeagues(): LatestLeagues {
  let leagues: string[] = []
  db.collection("league_data").onSnapshot(querySnapshot => {
    leagues = querySnapshot.docs.map(d => d.id)
  })
  return {
    getLatestLeagues() {
      return leagues
    }
  }
}

async function checkLeague(leagueId: string) {
  const client = await storedTokenClient(Number(leagueId))
  const leagueData = await client.getLeagueInfo(Number(leagueId))
  const leagueHash = {
    currentWeek: leagueData.careerHubInfo.seasonInfo.seasonWeek,
    currentGames: leagueData.gameScheduleHubInfo.leagueSchedule.map(game => game.seasonGameInfo.result),
  }
  const newHash = hash(leagueHash)
  if (newHash !== changeCache.get(leagueId)) {
    console.log(`Detected change in ${leagueId}`)
    await fetch(`https://snallabot.me/dashboard/league/${leagueId}/export`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          exportOption: {
            stage: Stage.UNKNOWN,
            week: 100,
          }
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
  const latestLeagues = getLatestLeagues()

  while (true) {
    const leagues = latestLeagues.getLatestLeagues()
    for (const leagueId of leagues) {
      // avoid any overloading of EA
      await sleep(2000)
      await checkLeague(leagueId)
    }
    console.log("Check complete, sleeping for 5 minutes...\n")
    await sleep(5 * 60 * 1000)
  }
}

runLeagueChecks()
