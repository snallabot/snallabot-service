import { DefensiveExport, KickingExport, PassingExport, PuntingExport, ReceivingExport, RosterExport, RushingExport, SchedulesExport, StandingExport, TeamExport, TeamStatsExport } from "./madden_league_types";

export enum ExportResult {
  SUCCESS = 0,
  FAILURE = 1
}
export interface MaddenExportDestination {
  leagueTeams(platform: string, leagueId: string, data: TeamExport): Promise<ExportResult>,
  standings(platform: string, leagueId: string, data: StandingExport): Promise<ExportResult>,
  schedules(platform: string, leagueId: string, week: string, stage: string, data: SchedulesExport): Promise<ExportResult>,
  punting(platform: string, leagueId: string, week: string, stage: string, data: PuntingExport): Promise<ExportResult>,
  teamStats(platform: string, leagueId: string, week: string, stage: string, data: TeamStatsExport): Promise<ExportResult>,
  passing(platform: string, leagueId: string, week: string, stage: string, data: PassingExport): Promise<ExportResult>,
  kicking(platform: string, leagueId: string, week: string, stage: string, data: KickingExport): Promise<ExportResult>,
  rushing(platform: string, leagueId: string, week: string, stage: string, data: RushingExport): Promise<ExportResult>,
  defense(platform: string, leagueId: string, week: string, stage: string, data: DefensiveExport): Promise<ExportResult>,
  receiving(platform: string, leagueId: string, week: string, stage: string, data: ReceivingExport): Promise<ExportResult>,
  freeagents(platform: string, leagueId: string, data: RosterExport): Promise<ExportResult>,
  teamRoster(platform: string, leagueId: string, teamId: string, data: RosterExport): Promise<ExportResult>
}

export function MaddenUrlDestination(baseUrl: string): MaddenExportDestination {
  const url = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/"
  async function exportWeeklyData<T>(platform: string, leagueId: string, week: string, stage: string, data: T, ending: string) {
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
    schedules: async function(platform: string, leagueId: string, week: string, stage: string, data: SchedulesExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "schedules")
    },
    punting: async function(platform: string, leagueId: string, week: string, stage: string, data: PuntingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "punting")
    },
    teamStats: async function(platform: string, leagueId: string, week: string, stage: string, data: TeamStatsExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "teamstats")
    },
    passing: async function(platform: string, leagueId: string, week: string, stage: string, data: PassingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "passing")
    },
    kicking: async function(platform: string, leagueId: string, week: string, stage: string, data: KickingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "kicking")
    },
    rushing: async function(platform: string, leagueId: string, week: string, stage: string, data: RushingExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "rushing")
    },
    defense: async function(platform: string, leagueId: string, week: string, stage: string, data: DefensiveExport): Promise<ExportResult> {
      return await exportWeeklyData(platform, leagueId, week, stage, data, "defense")
    },
    receiving: async function(platform: string, leagueId: string, week: string, stage: string, data: ReceivingExport): Promise<ExportResult> {
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
