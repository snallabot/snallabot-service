import { SnallabotEvent } from "./../db/events_db"
import MaddenDB from "../db/madden_db"
import NodeCache from "node-cache"
import { Storage } from "@google-cloud/storage";
import { readFileSync } from "fs"
import { DefensiveExport, KickingExport, PassingExport, PuntingExport, ReceivingExport, RosterExport, RushingExport, SchedulesExport, StandingExport, TeamExport, TeamStatsExport } from "./madden_league_types";
import { Stage } from "../dashboard/ea_client";

export enum ExportResult {
  SUCCESS = 0,
  FAILURE = 1
}
export interface MaddenExportDestination {
  leagueTeams(platform: string, leagueId: string, data: TeamExport): Promise<ExportResult>,
  standings(platform: string, leagueId: string, data: StandingExport): Promise<ExportResult>,
  schedules(platform: string, leagueId: string, week: number, stage: Stage, data: SchedulesExport): Promise<ExportResult>,
  punting(platform: string, leagueId: string, week: number, stage: Stage, data: PuntingExport): Promise<ExportResult>,
  teamStats(platform: string, leagueId: string, week: number, stage: Stage, data: TeamStatsExport): Promise<ExportResult>,
  passing(platform: string, leagueId: string, week: number, stage: Stage, data: PassingExport): Promise<ExportResult>,
  kicking(platform: string, leagueId: string, week: number, stage: Stage, data: KickingExport): Promise<ExportResult>,
  rushing(platform: string, leagueId: string, week: number, stage: Stage, data: RushingExport): Promise<ExportResult>,
  defense(platform: string, leagueId: string, week: number, stage: Stage, data: DefensiveExport): Promise<ExportResult>,
  receiving(platform: string, leagueId: string, week: number, stage: Stage, data: ReceivingExport): Promise<ExportResult>,
  freeagents(platform: string, leagueId: string, data: RosterExport): Promise<ExportResult>,
  teamRoster(platform: string, leagueId: string, teamId: string, data: RosterExport): Promise<ExportResult>
}

export function MaddenUrlDestination(baseUrl: string): MaddenExportDestination {
  const url = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
  async function exportWeeklyData<T>(platform: string, leagueId: string, week: number, stage: Stage, data: T, ending: string) {
    const res = await fetch(`${url}/${platform}/${leagueId}/week/${stage}/${week}/${ending}`, {
      method: "POST",
      body: JSON.stringify(data),
      headers: {
        "Content-Type": "application/json",
      }
    })
    return res.ok ? ExportResult.SUCCESS : ExportResult.FAILURE
  }
  return {
    leagueTeams: async function(platform: string, leagueId: string, data: TeamExport): Promise<ExportResult> {
      const res = await fetch(`${url}/${platform}/${leagueId}/leagueteams`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        }
      })
      return res.ok ? ExportResult.SUCCESS : ExportResult.FAILURE
    },
    standings: async function(platform: string, leagueId: string, data: StandingExport): Promise<ExportResult> {
      const res = await fetch(`${url}/${platform}/${leagueId}/standings`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        }
      })
      return res.ok ? ExportResult.SUCCESS : ExportResult.FAILURE
    },
    schedules: async function(platform: string, leagueId: string, week: number, stage: Stage, data: SchedulesExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "schedules")
    },
    punting: async function(platform: string, leagueId: string, week: number, stage: Stage, data: PuntingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "punting")
    },
    teamStats: async function(platform: string, leagueId: string, week: number, stage: Stage, data: TeamStatsExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "teamstats")
    },
    passing: async function(platform: string, leagueId: string, week: number, stage: Stage, data: PassingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "passing")
    },
    kicking: async function(platform: string, leagueId: string, week: number, stage: Stage, data: KickingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "kicking")
    },
    rushing: async function(platform: string, leagueId: string, week: number, stage: Stage, data: RushingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "rushing")
    },
    defense: async function(platform: string, leagueId: string, week: number, stage: Stage, data: DefensiveExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "defense")
    },
    receiving: async function(platform: string, leagueId: string, week: number, stage: Stage, data: ReceivingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "receiving")
    },
    freeagents: async function(platform: string, leagueId: string, data: RosterExport) {
      const res = await fetch(`${url}/${platform}/${leagueId}/freeagents/roster`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        }
      })
      return res.ok ? ExportResult.SUCCESS : ExportResult.FAILURE
    },
    teamRoster: async function(platform: string, leagueId: string, teamId: string, data: RosterExport) {
      const res = await fetch(`${url}/${platform}/${leagueId}/team/${teamId}/roster`, {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        }
      })
      return res.ok ? ExportResult.SUCCESS : ExportResult.FAILURE
    }
  }
}

export const SnallabotExportDestination: MaddenExportDestination = {
  leagueTeams: async function(platform: string, leagueId: string, data: TeamExport): Promise<ExportResult> {
    const events = data.leagueTeamInfoList.map(team => (
      { key: leagueId, platform: platform, event_type: "MADDEN_TEAM", ...team }
    ))
    await sendEvents(leagueId, "leagueteams", events, e => e.teamId)
    return ExportResult.SUCCESS
  },
  standings: async function(platform: string, leagueId: string, data: StandingExport): Promise<ExportResult> {
    const events = data.teamStandingInfoList.map(standing => ({ key: leagueId, platform: platform, event_type: "MADDEN_STANDING", ...standing }))
    await sendEvents(leagueId, "standings", events, e => e.teamId)
    return ExportResult.SUCCESS
  },
  schedules: async function(platform: string, leagueId: string, week: number, stage: Stage, data: SchedulesExport): Promise<ExportResult> {
    const events = data.gameScheduleInfoList.map(game => ({ key: leagueId, platform: platform, event_type: "MADDEN_SCHEDULE", ...game }))
    await sendEvents(leagueId, `schedules${stage}-${week}`, events, e => e.scheduleId)
    return ExportResult.SUCCESS
  },
  punting: async function(platform: string, leagueId: string, week: number, stage: Stage, data: PuntingExport): Promise<ExportResult> {
    const events = data.playerPuntingStatInfoList.map(stat => ({ key: leagueId, platform: platform, event_type: "MADDEN_PUNTING_STAT", ...stat }))
    await sendEvents(leagueId, `punting${stage}-${week}`, events, e => e.statId)
    return ExportResult.SUCCESS
  },
  teamStats: async function(platform: string, leagueId: string, week: number, stage: Stage, data: TeamStatsExport): Promise<ExportResult> {
    const events = data.teamStatInfoList.map(stat => ({ key: leagueId, platform: platform, event_type: "MADDEN_TEAM_STAT", ...stat }))
    await sendEvents(leagueId, `teamstats${stage}-${week}`, events, e => e.statId)
    return ExportResult.SUCCESS
  },
  passing: async function(platform: string, leagueId: string, week: number, stage: Stage, data: PassingExport): Promise<ExportResult> {
    const events = data.playerPassingStatInfoList.map(stat => ({ key: leagueId, platform: platform, event_type: "MADDEN_PASSING_STAT", ...stat }))
    await sendEvents(leagueId, `passing${stage}-${week}`, events, e => e.statId)
    return ExportResult.SUCCESS
  },
  kicking: async function(platform: string, leagueId: string, week: number, stage: Stage, data: KickingExport): Promise<ExportResult> {
    const events = data.playerKickingStatInfoList.map(stat => ({ key: leagueId, platform: platform, event_type: "MADDEN_KICKING_STAT", ...stat }))
    await sendEvents(leagueId, `kicking${stage}-${week}`, events, e => e.statId)
    return ExportResult.SUCCESS
  },
  rushing: async function(platform: string, leagueId: string, week: number, stage: Stage, data: RushingExport): Promise<ExportResult> {
    const events = data.playerRushingStatInfoList.map(stat => ({ key: leagueId, platform: platform, event_type: "MADDEN_RUSHING_STAT", ...stat }))
    await sendEvents(leagueId, `rushing${stage}-${week}`, events, e => e.statId)
    return ExportResult.SUCCESS
  },
  defense: async function(platform: string, leagueId: string, week: number, stage: Stage, data: DefensiveExport): Promise<ExportResult> {
    const events = data.playerDefensiveStatInfoList.map(stat => ({ key: leagueId, platform: platform, event_type: "MADDEN_DEFENSIVE_STAT", ...stat }))
    await sendEvents(leagueId, `defense${stage}-${week}`, events, e => e.statId)

    return ExportResult.SUCCESS
  },
  receiving: async function(platform: string, leagueId: string, week: number, stage: Stage, data: ReceivingExport): Promise<ExportResult> {
    const events = data.playerReceivingStatInfoList.map(stat => ({ key: leagueId, platform: platform, event_type: "MADDEN_RECEIVING_STAT", ...stat }))
    await sendEvents(leagueId, `receiving${stage}-${week}`, events, e => e.statId)
    return ExportResult.SUCCESS
  },
  freeagents: async function(platform: string, leagueId: string, data: RosterExport): Promise<ExportResult> {
    const events = data.rosterInfoList.map(player => ({ key: leagueId, platform: platform, event_type: "MADDEN_PLAYER", ...player }))
    await sendEvents(leagueId, `rosterfreeagents`, events, e => e.rosterId)
    return ExportResult.SUCCESS
  },
  teamRoster: async function(platform: string, leagueId: string, teamId: string, data: RosterExport): Promise<ExportResult> {
    const events = data.rosterInfoList.map(player => ({ key: leagueId, platform: platform, event_type: "MADDEN_PLAYER", team: teamId, ...player }))
    await sendEvents(leagueId, `roster${teamId}`, events, e => e.rosterId)
    return ExportResult.SUCCESS
  }
}

const SNALLABOT = "snallabot.me"
export const SNALLABOT_EXPORT = `https://${SNALLABOT}`

export function createDestination(url: string) {
  if (url.includes("snallabot.me")) {
    return SnallabotExportDestination
  } else {
    return MaddenUrlDestination(url)
  }
}

let serviceAccount;
if (process.env.SERVICE_ACCOUNT_FILE) {
  serviceAccount = JSON.parse(readFileSync(process.env.SERVICE_ACCOUNT_FILE, 'utf8'))
} else if (process.env.SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT)
} else {
  throw new Error("no SA")
}

const storage = new Storage({
  projectId: "snallabot",
  credentials: serviceAccount
})

const bucket = storage.bucket("league_hashes")
function filePath(leagueId: string, event_type: string, request_type: string) {
  return `${leagueId}/${event_type}/${request_type}.json`
}

const hash: (a: any) => string = require("object-hash")

const treeCache = new NodeCache({ maxKeys: 100000 })
const CACHE_TTL = 3600 * 48 // 2 days in seconds
export function getMaddenCacheStats() {
  return treeCache.getStats()
}

type Node = {
  hash: string,
  children: Array<Node>
}

type MerkleTree = {
  headNode: Node
}

function flatten(tree: MerkleTree): Array<Node> {
  return tree.headNode.children.concat(tree.headNode.children.flatMap(n => flatten({ headNode: n })))
}

function findDifferences(incoming: MerkleTree, old: MerkleTree): Array<string> {
  if (incoming.headNode.hash === old.headNode.hash) {
    return []
  } else {
    const oldHashes = Object.fromEntries(old.headNode.children.map(h => [h.hash, h]))
    return incoming.headNode.children.flatMap(c => {
      if (oldHashes[c.hash]) {
        return []
      }
      return [c.hash].concat(flatten({ headNode: c }).map(n => n.hash))
    })
  }
}

function createTwoLayer(nodes: Array<Node>): MerkleTree {
  const topHash = hash(nodes.map(c => c.hash))
  return { headNode: { hash: topHash, children: nodes } }
}

function createCacheKey(league: string, request_type: string): string {
  return `${league}|${request_type}`
}

async function retrieveTree(league: string, request_type: string, event_type: string): Promise<MerkleTree> {
  const cachedTree = treeCache.get(createCacheKey(league, request_type)) as MerkleTree
  if (cachedTree) {
    return cachedTree
  } else {
    try {
      const data = await bucket.file(filePath(league, event_type, request_type)).download()
      const tree = JSON.parse(data.toString()) as MerkleTree
      try {
        treeCache.set(createCacheKey(league, request_type), tree, CACHE_TTL)
      } catch (e) {
      }
      return tree
    } catch (e) {
      return { headNode: { children: [], hash: hash("") } }
    }
  }
}


async function writeTree(league: string, request_type: string, event_type: string, tree: MerkleTree): Promise<void> {
  try {
    treeCache.set(createCacheKey(league, request_type), tree, CACHE_TTL)
  } catch (e) {
  }
  try {
    await bucket.file(filePath(league, event_type, request_type)).save(JSON.stringify(tree), { contentType: "application/json" })
  } catch (e) {
    console.error(e)
  }
}


export async function sendEvents<T>(league: string, request_type: string, events: Array<SnallabotEvent<T>>, identifier: (e: T) => number): Promise<void> {
  if (events.length == 0) {
    return
  }
  const eventType = events.map(e => e.event_type).pop()
  if (!eventType) {
    throw new Error("No Event Type found for " + request_type)
  }
  const oldTree = await retrieveTree(league, request_type, eventType)
  const hashToEvent = new Map(events.map(e => [hash(e), e]))
  const newNodes = events.sort(e => identifier(e)).map(e => ({ hash: hash(e), children: [] }))

  const newTree = createTwoLayer(newNodes)
  const hashDifferences = findDifferences(newTree, oldTree)
  if (hashDifferences.length > 0) {
    await writeTree(league, request_type, eventType, newTree)
    // if (hashDifferences.length > 0) {
    // console.log(newNodes)
    // }
    const finalEvents = hashDifferences.map(h => hashToEvent.get(h)).filter(e => e) as SnallabotEvent<T>[]
    await MaddenDB.appendEvents(finalEvents, (e: T) => `${identifier(e)}`)
  }
  // else {
  //     console.debug("skipped writing!")
  // }
}
