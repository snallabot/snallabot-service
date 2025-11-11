import { SnallabotEvent } from "./../db/events_db"
import MaddenDB, { MaddenEvents, idWeeklyEvents } from "../db/madden_db"
import MaddenHash, { createTwoLayer, findDifferences } from "../db/madden_hash_storage"
import { DefensiveExport, KickingExport, PassingExport, PuntingExport, ReceivingExport, RosterExport, RushingExport, SchedulesExport, StandingExport, TeamExport, TeamStatsExport } from "./madden_league_types";
import { ExtraData, Stage } from "../dashboard/ea_client";
import { DEPLOYMENT_URL } from "../config";
import FileHandler, { defaultSerializer } from "../file_handlers"

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
  teamRoster(platform: string, leagueId: string, teamId: string, data: RosterExport): Promise<ExportResult>,
  extra(platform: string, leagueId: string, data: ExtraData): Promise<ExportResult>
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
    },
    extra: async function(platform: string, leagueId: string, data: ExtraData) {
      const res = await fetch(`${url}/${platform}/${leagueId}/extra`, {
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
      { key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_TEAM, ...team }
    ))
    await sendEvents(leagueId, "leagueteams", events, e => e.teamId)
    await MaddenDB.updateLeagueExportStatus(leagueId, MaddenEvents.MADDEN_TEAM)
    return ExportResult.SUCCESS
  },
  standings: async function(platform: string, leagueId: string, data: StandingExport): Promise<ExportResult> {
    const events = data.teamStandingInfoList.map(standing => ({ key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_STANDING, ...standing }))
    await sendEvents(leagueId, "standings", events, e => e.teamId)
    await MaddenDB.updateLeagueExportStatus(leagueId, MaddenEvents.MADDEN_STANDING)
    return ExportResult.SUCCESS
  },
  schedules: async function(platform: string, leagueId: string, week: number, stage: Stage, data: SchedulesExport): Promise<ExportResult> {
    const events = data.gameScheduleInfoList.map(game => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_SCHEDULE, ...game
    }))
    await sendEvents(leagueId, `schedules${stage}-${week}`, events, e => idWeeklyEvents(e, e.scheduleId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_SCHEDULE, week, season)
    }
    return ExportResult.SUCCESS
  },
  punting: async function(platform: string, leagueId: string, week: number, stage: Stage, data: PuntingExport): Promise<ExportResult> {
    const events = data.playerPuntingStatInfoList.map(stat => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_PUNTING_STAT, ...stat
    }))
    await sendEvents(leagueId, `punting${stage}-${week}`, events, e => idWeeklyEvents(e, e.statId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_PUNTING_STAT, week, season)
    }
    return ExportResult.SUCCESS
  },
  teamStats: async function(platform: string, leagueId: string, week: number, stage: Stage, data: TeamStatsExport): Promise<ExportResult> {
    const events = data.teamStatInfoList.map(stat => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_TEAM_STAT, ...stat
    }))
    await sendEvents(leagueId, `teamstats${stage}-${week}`, events, e => idWeeklyEvents(e, e.statId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_TEAM_STAT, week, season)
    }
    return ExportResult.SUCCESS
  },
  passing: async function(platform: string, leagueId: string, week: number, stage: Stage, data: PassingExport): Promise<ExportResult> {
    const events = data.playerPassingStatInfoList.map(stat => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_PASSING_STAT, ...stat
    }))
    await sendEvents(leagueId, `passing${stage}-${week}`, events, e => idWeeklyEvents(e, e.statId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_PASSING_STAT, week, season)
    }
    return ExportResult.SUCCESS
  },
  kicking: async function(platform: string, leagueId: string, week: number, stage: Stage, data: KickingExport): Promise<ExportResult> {
    const events = data.playerKickingStatInfoList.map(stat => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_KICKING_STAT, ...stat
    }))
    await sendEvents(leagueId, `kicking${stage}-${week}`, events, e => idWeeklyEvents(e, e.statId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_KICKING_STAT, week, season)
    }
    return ExportResult.SUCCESS
  },
  rushing: async function(platform: string, leagueId: string, week: number, stage: Stage, data: RushingExport): Promise<ExportResult> {
    const events = data.playerRushingStatInfoList.map(stat => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_RUSHING_STAT, ...stat
    }))
    await sendEvents(leagueId, `rushing${stage}-${week}`, events, e => idWeeklyEvents(e, e.statId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_RUSHING_STAT, week, season)
    }
    return ExportResult.SUCCESS
  },
  defense: async function(platform: string, leagueId: string, week: number, stage: Stage, data: DefensiveExport): Promise<ExportResult> {
    const events = data.playerDefensiveStatInfoList.map(stat => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_DEFENSIVE_STAT, ...stat
    }))
    await sendEvents(leagueId, `defense${stage}-${week}`, events, e => idWeeklyEvents(e, e.statId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_DEFENSIVE_STAT, week, season)
    }
    return ExportResult.SUCCESS
  },
  receiving: async function(platform: string, leagueId: string, week: number, stage: Stage, data: ReceivingExport): Promise<ExportResult> {
    const events = data.playerReceivingStatInfoList.map(stat => ({
      key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_RECEIVING_STAT, ...stat
    }))
    await sendEvents(leagueId, `receiving${stage}-${week}`, events, e => idWeeklyEvents(e, e.statId))
    if (events.length > 0) {
      const season = Math.max(...events.map(e => e.seasonIndex))
      await MaddenDB.updateWeeklyExportStatus(leagueId, MaddenEvents.MADDEN_RECEIVING_STAT, week, season)
    }
    return ExportResult.SUCCESS
  },
  freeagents: async function(platform: string, leagueId: string, data: RosterExport): Promise<ExportResult> {
    const events = data.rosterInfoList.map(player => ({ key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_PLAYER, ...player }))
    await sendEvents(leagueId, `rosterfreeagents`, events, e => e.rosterId)
    await MaddenDB.updateRosterExportStatus(leagueId, MaddenEvents.MADDEN_PLAYER, "0")
    return ExportResult.SUCCESS
  },
  teamRoster: async function(platform: string, leagueId: string, teamId: string, data: RosterExport): Promise<ExportResult> {
    const events = data.rosterInfoList.map(player => ({ key: leagueId, platform: platform, event_type: MaddenEvents.MADDEN_PLAYER, team: teamId, ...player }))
    await sendEvents(leagueId, `roster${teamId}`, events, e => e.rosterId, e => {
      // analysis shows that these fields change the most, and arent honestly that useful. this should cut down on the data we write
      const { experiencePoints, legacyScore, confRating, productionGrade, teamSchemeOvr, intangibleGrade, ...rest } = e
      return hash(rest)
    })
    await MaddenDB.updateRosterExportStatus(leagueId, MaddenEvents.MADDEN_PLAYER, teamId)
    return ExportResult.SUCCESS
  },
  extra: async function(platform: string, leagueId: string, data: ExtraData) {
    // don't care
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
const OPTIMIZE_WRITES = process.env.USE_WRITE_HASHES === "true"
export async function sendEvents<T>(league: string, request_type: string, events: Array<SnallabotEvent<T>>, identifier: (e: T) => number | string, hasher: (a: T) => string = hash): Promise<void> {
  if (events.length == 0) {
    return
  }
  if (OPTIMIZE_WRITES) {
    const eventType = events.map(e => e.event_type).pop()
    if (!eventType) {
      throw new Error("No Event Type found for " + request_type)
    }
    const oldTree = await MaddenHash.readTree(league, request_type, eventType)
    const hashToEvent = new Map(events.map(e => [hasher(e), e]))
    const newNodes = events.sort((e, e2) => `${identifier(e)}`.localeCompare(`${identifier(e2)}`)).map(e => ({ hash: hasher(e), children: [] }))

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
  } else {
    await MaddenDB.appendEvents(events, (e: T) => `${identifier(e)}`)
  }
}

// used to write Madden data to files 
const FileExportDestination: MaddenExportDestination = {
  async leagueTeams(platform: string, leagueId: string, data: TeamExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_leagueTeams.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async standings(platform: string, leagueId: string, data: StandingExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_standings.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async schedules(platform: string, leagueId: string, week: number, stage: Stage, data: SchedulesExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_schedules.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async punting(platform: string, leagueId: string, week: number, stage: Stage, data: PuntingExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_punting.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async teamStats(platform: string, leagueId: string, week: number, stage: Stage, data: TeamStatsExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_teamStats.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async passing(platform: string, leagueId: string, week: number, stage: Stage, data: PassingExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_passing.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async kicking(platform: string, leagueId: string, week: number, stage: Stage, data: KickingExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_kicking.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async rushing(platform: string, leagueId: string, week: number, stage: Stage, data: RushingExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_rushing.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async defense(platform: string, leagueId: string, week: number, stage: Stage, data: DefensiveExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_defense.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async receiving(platform: string, leagueId: string, week: number, stage: Stage, data: ReceivingExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_week${week}_${stage}_receiving.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async freeagents(platform: string, leagueId: string, data: RosterExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_freeagents.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },

  async teamRoster(platform: string, leagueId: string, teamId: string, data: RosterExport): Promise<ExportResult> {
    const path = `${platform}_${leagueId}_${teamId}_teamRoster.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  },
  extra: async function(platform: string, leagueId: string, data: ExtraData) {
    const path = `${platform}_${leagueId}_extraData.json`;
    await FileHandler.writeFile(data, path, defaultSerializer());
    return ExportResult.SUCCESS;
  }
};
