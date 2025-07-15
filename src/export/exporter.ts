import { SnallabotEvent } from "./../db/events_db"
import MaddenDB from "../db/madden_db"
import MaddenHash, { createTwoLayer, findDifferences } from "../db/madden_hash_storage"
import { DefensiveExport, KickingExport, PassingExport, PuntingExport, ReceivingExport, RosterExport, RushingExport, SchedulesExport, StandingExport, TeamExport, TeamStatsExport } from "./madden_league_types";
import { Stage } from "../dashboard/ea_client";
import { DEPLOYMENT_URL } from "../config";

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
  const url = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length - 1) : baseUrl
  async function exportWeeklyData<T>(platform: string, leagueId: string, week: number, stage: Stage, data: T, ending: string) {
    const stagePrefix = stage === Stage.SEASON ? "reg" : "pre"
    const res = await fetch(`${url}/${platform}/${leagueId}/week/${stagePrefix}/${week}/${ending}`, {
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

export function createDestination(url: string) {
  if (url.includes(DEPLOYMENT_URL)) {
    return SnallabotExportDestination
  } else {
    return MaddenUrlDestination(url)
  }
}
const hash: (a: any) => string = require("object-hash")
export async function sendEvents<T>(league: string, request_type: string, events: Array<SnallabotEvent<T>>, identifier: (e: T) => number): Promise<void> {
  if (events.length == 0) {
    return
  }
  const eventType = events.map(e => e.event_type).pop()
  if (!eventType) {
    throw new Error("No Event Type found for " + request_type)
  }
  const oldTree = await MaddenHash.readTree(league, request_type, eventType)
  const hashToEvent = new Map(events.map(e => [hash(e), e]))
  const newNodes = events.sort(e => identifier(e)).map(e => ({ hash: hash(e), children: [] }))

  const newTree = createTwoLayer(newNodes)
  const hashDifferences = findDifferences(newTree, oldTree)
  if (hashDifferences.length > 0) {
    // if (hashDifferences.length > 0) {
    // console.log(newNodes)
    // }
    const finalEvents = hashDifferences.map(h => hashToEvent.get(h)).filter(e => e) as SnallabotEvent<T>[]
    await MaddenDB.appendEvents(finalEvents, (e: T) => `${identifier(e)}`)
    await MaddenHash.writeTree(league, request_type, eventType, newTree)
  }
  // else {
  //     console.debug("skipped writing!")
  // }
}
