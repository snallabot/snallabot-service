import { SnallabotEvent, StoredEvent, EventNotifier } from "./events_db"
import { DefensiveStats, KickingStats, MaddenGame, PassingStats, Player, PuntingStats, ReceivingStats, RushingStats, Standing, Team, TeamStats } from "../export/madden_league_types"
import { TeamAssignments } from "../discord/settings_db"
import { maddenDBRequestsCounter } from "../debug/metrics"

export enum PlayerStatType {
  DEFENSE,
  KICKING,
  PUNTING,
  RECEIVING,
  RUSHING,
  PASSING
}

export type PlayerStats = {
  [PlayerStatType.DEFENSE]?: DefensiveStats[],
  [PlayerStatType.KICKING]?: KickingStats[],
  [PlayerStatType.PUNTING]?: PuntingStats[],
  [PlayerStatType.RECEIVING]?: ReceivingStats[],
  [PlayerStatType.RUSHING]?: RushingStats[],
  [PlayerStatType.PASSING]?: PassingStats[]
}

export type GameStats = {
  teamStats: TeamStats[],
  playerStats: PlayerStats
}

export enum MaddenEvents {
  MADDEN_TEAM = "MADDEN_TEAM",
  MADDEN_STANDING = "MADDEN_STANDING",
  MADDEN_SCHEDULE = "MADDEN_SCHEDULE",
  MADDEN_PUNTING_STAT = "MADDEN_PUNTING_STAT",
  MADDEN_TEAM_STAT = "MADDEN_TEAM_STAT",
  MADDEN_PASSING_STAT = "MADDEN_PASSING_STAT",
  MADDEN_KICKING_STAT = "MADDEN_KICKING_STAT",
  MADDEN_RUSHING_STAT = "MADDEN_RUSHING_STAT",
  MADDEN_DEFENSIVE_STAT = "MADDEN_DEFENSIVE_STAT",
  MADDEN_RECEIVING_STAT = "MADDEN_RECEIVING_STAT",
  MADDEN_PLAYER = "MADDEN_PLAYER"
}

export type PlayerStatEvents = MaddenEvents.MADDEN_PASSING_STAT | MaddenEvents.MADDEN_RUSHING_STAT | MaddenEvents.MADDEN_DEFENSIVE_STAT | MaddenEvents.MADDEN_KICKING_STAT | MaddenEvents.MADDEN_RECEIVING_STAT | MaddenEvents.MADDEN_PUNTING_STAT
export type PlayerStatTypes = PassingStats | RushingStats | DefensiveStats | KickingStats | ReceivingStats | PuntingStats

export type PlayerListQuery = { teamId?: number, position?: string, rookie?: boolean, retired?: boolean }

export type IndividualStatus = { lastExported: Date }
export type ExportStatus = {
  [MaddenEvents.MADDEN_TEAM]?: IndividualStatus,
  [MaddenEvents.MADDEN_STANDING]?: IndividualStatus
  weeklyStatus: {
    [key: string]: {
      [MaddenEvents.MADDEN_SCHEDULE]?: IndividualStatus,
      [MaddenEvents.MADDEN_PUNTING_STAT]?: IndividualStatus,
      [MaddenEvents.MADDEN_TEAM_STAT]?: IndividualStatus,
      [MaddenEvents.MADDEN_PASSING_STAT]?: IndividualStatus,
      [MaddenEvents.MADDEN_KICKING_STAT]?: IndividualStatus,
      [MaddenEvents.MADDEN_RUSHING_STAT]?: IndividualStatus,
      [MaddenEvents.MADDEN_DEFENSIVE_STAT]?: IndividualStatus,
      [MaddenEvents.MADDEN_RECEIVING_STAT]?: IndividualStatus,
    }
  },
  rosterStatus: {
    [key: string]: {
      [MaddenEvents.MADDEN_PLAYER]?: IndividualStatus
    }
  }
}

export type LeagueDoc = {
  blazeId: string,
  exportStatus?: ExportStatus
}

export function idWeeklyEvents(e: { seasonIndex: number, weekIndex: number }, id: number) {
  return `season${e.seasonIndex}-week${e.weekIndex}-${id}`
}

export type SeasonWeek = { seasonIndex: number, weekIndex: number }

export function parseExportStatusWeekKey(weekKey: string): SeasonWeek {
  // Use regex to extract season and week numbers
  const match = weekKey.match(/^season(\d+)_week(\d+)$/);

  if (!match) {
    throw new Error('Invalid week key format');
  }

  return {
    seasonIndex: parseInt(match[1], 10),
    weekIndex: parseInt(match[2], 10)
  }
}

export type SmallPlayerIndex = {
  rosterId: string,
  firstName: string,
  lastName: string,
  teamId: string,
  yearsPro: number,
  playerBestOvr: number,
  position: string,
  birthYear: number,
  birthMonth: number,
  birthDay: number,
  presentationId: number
}

export type PlayerListIndex = {
  [key: string]: SmallPlayerIndex
}

export interface MaddenDB {
  appendEvents<Event>(event: SnallabotEvent<Event>[], idFn: (event: Event) => string): Promise<void>,
  on<Event>(event_type: string, notifier: EventNotifier<Event>): void,
  getLatestTeams(leagueId: string): Promise<TeamList>,
  getLatestWeekSchedule(leagueId: string, week: number): Promise<MaddenGame[]>,
  getLatestSchedule(leagueId: string): Promise<MaddenGame[]>,
  getPlayoffSchedule(leagueId: string): Promise<MaddenGame[]>,
  getAllWeeks(leagueId: string): Promise<SeasonWeek[]>,
  getWeekScheduleForSeason(leagueId: string, week: number, season: number): Promise<MaddenGame[]>
  getGameForSchedule(leagueId: string, scheduleId: number, week: number, season: number): Promise<MaddenGame>,
  getStandingForTeam(leagueId: string, teamId: number): Promise<Standing>,
  getLatestStandings(leagueId: string): Promise<Standing[]>,
  getLatestPlayers(leagueId: string): Promise<SmallPlayerIndex[]>,
  getPlayer(leagueId: string, rosterId: string): Promise<Player>,
  getPlayerStats(leagueId: string, player: Player): Promise<PlayerStats>,
  getGamesForSchedule(leagueId: string, scheduleIds: Iterable<{ id: number, week: number, season: number }>): Promise<MaddenGame[]>,
  getPlayers(leagueId: string, query: PlayerListQuery, limit: number, startAfter?: Player, endBefore?: Player): Promise<Player[]>,
  updateLeagueExportStatus(leagueId: string, eventType: MaddenEvents): Promise<void>,
  updateWeeklyExportStatus(leagueId: string, eventType: MaddenEvents, week: number, season: number): Promise<void>,
  updateRosterExportStatus(leagueId: string, eventType: MaddenEvents.MADDEN_PLAYER, teamId: string): Promise<void>,
  getTeamStatsForGame(leagueId: string, teamId: string, week: number, season: number): Promise<TeamStats>,
  getExportStatus(leagueId: string): Promise<ExportStatus | undefined>,
  getStatsForGame(leagueId: string, season: number, week: number, scheduleId: number): Promise<GameStats>,
  getTeamSchedule(leagueId: string, season?: number): Promise<MaddenGame[]>,
  getStatsForWeek<T extends PlayerStatTypes>(leagueId: string, statType: PlayerStatEvents, week?: number, season?: number): Promise<{ seasonIndex: number, weekIndex: number, stats: T[] }>,
  getStatsForSeason<T extends PlayerStatTypes>(leagueId: string, statType: PlayerStatEvents, season?: number): Promise<T[]>
}

export interface TeamList {
  getTeamForId(id: number): Team,
  getLatestTeams(): Team[],
  getLatestTeamAssignments(assignments: TeamAssignments): TeamAssignments
}

export function createTeamList(teams: StoredEvent<Team>[]): TeamList {
  const latestTeamMap = new Map<number, Team>()
  const latestTeams: Team[] = []
  Object.entries(Object.groupBy(teams, t => t.divName)).forEach(divisionTeams => {
    const [_, divTeams] = divisionTeams
    if (!divTeams) {
      return
    }
    const matchingTeams = Object.values(Object.groupBy(divTeams, t => `${t.cityName}#${t.abbrName}`)).filter((t): t is StoredEvent<Team>[] => !!t)
    const unMatched = matchingTeams.filter(t => t && t.length === 1).flat()
    const matched = matchingTeams.filter(t => t && t.length !== 1)
    matched.forEach(matchedTeams => {
      const latestTeam = matchedTeams.reduce((latest, team) => (team.timestamp > latest.timestamp ? team : latest))
      latestTeams.push(latestTeam)
      matchedTeams.forEach(team => latestTeamMap.set(team.teamId, latestTeam))
    })
    // checking if matched teams is 4 gets rid of dupes, but we have no way of knowing what the unmatched team matches with, losing their stats
    // TODO (snallapa): revist this
    if (unMatched.length > 0) {
      // if there are just two teams left unmatched, and only one spot left, then they must be a match
      if (unMatched.length === 2 && matched.length === 3) {
        // lets just assume the unmatched are normal teams
        const [team1, team2] = unMatched
        const latestTeam = team1.timestamp > team2.timestamp ? team1 : team2
        latestTeams.push(latestTeam)
        latestTeamMap.set(team1.teamId, latestTeam)
        latestTeamMap.set(team2.teamId, latestTeam)
      } else {
        // lets just assume the unmatched are normal teams
        unMatched.forEach(unmatched => {
          latestTeams.push(unmatched)
          latestTeamMap.set(unmatched.teamId, unmatched)
        })
      }
    }
  })
  return {
    getTeamForId: function(id: number): Team {
      const team = latestTeamMap.get(id)
      if (team) {
        return team
      }
      throw new Error("Team not found for id " + id)
    },
    getLatestTeams: function(): Team[] { return latestTeams },
    getLatestTeamAssignments: function(assignments: TeamAssignments): TeamAssignments {
      return Object.fromEntries(Object.entries(assignments).map(entry => {
        const [teamId, assignment] = entry
        try {
          const latestTeam = this.getTeamForId(Number(teamId))
          return [latestTeam.teamId + "", assignment]
        } catch (e) {
          return []
        }
      }).filter(e => e.length !== 0))
    }
  }
}

export function deduplicateSchedule(games: StoredEvent<MaddenGame>[], teams: TeamList): StoredEvent<MaddenGame>[] {
  const gameMap = new Map<string, StoredEvent<MaddenGame>>();

  try {
    for (const game of games.filter(game => game.awayTeamId !== 0 && game.homeTeamId !== 0)) {
      // Map team IDs to their latest versions
      const latestHomeTeam = teams.getTeamForId(game.homeTeamId);
      const latestAwayTeam = teams.getTeamForId(game.awayTeamId);

      // Create a unique key for this matchup using the latest team IDs
      // Sort the team IDs to ensure consistent ordering (so home vs away doesn't matter for deduplication)
      const teamIds = [latestHomeTeam.teamId, latestAwayTeam.teamId].sort((a, b) => a - b);
      const gameKey = `${game.seasonIndex}-${game.weekIndex}-${teamIds[0]}-${teamIds[1]}`;

      const existingGame = gameMap.get(gameKey);

      if (!existingGame) {
        // First occurrence of this game
        gameMap.set(gameKey, game);
      } else {
        // Duplicate found - keep the one with the later timestamp
        if (game.timestamp > existingGame.timestamp) {
          gameMap.set(gameKey, game);
        }
        // If existing game has later timestamp, we keep it (do nothing)
      }
    }
    return Array.from(gameMap.values());
  } catch (e) {
    console.error(e)
    return []
  }
}

export function findLatestScheduleId(scheduleId: number, games: StoredEvent<MaddenGame>[], teams: TeamList): StoredEvent<MaddenGame> {
  // First, find the game with the given schedule ID
  const filteredGames = games.filter(game => game.awayTeamId !== 0 && game.homeTeamId !== 0)
  const originalGame = filteredGames.find(game => game.scheduleId === scheduleId);

  if (!originalGame) {
    throw new Error(`No game found with schedule ID: ${scheduleId}`);
  }

  // Map the original game's team IDs to their latest versions
  const latestHomeTeam = teams.getTeamForId(originalGame.homeTeamId);
  const latestAwayTeam = teams.getTeamForId(originalGame.awayTeamId);

  // Create the game key using latest team IDs (sorted for consistency)
  const teamIds = [latestHomeTeam.teamId, latestAwayTeam.teamId].sort((a, b) => a - b);
  const gameKey = `${originalGame.seasonIndex}-${originalGame.weekIndex}-${teamIds[0]}-${teamIds[1]}`;

  // Find all games that match this same matchup (same teams, week, season)
  const matchingGames = filteredGames.filter(game => {
    const gameLatestHomeTeam = teams.getTeamForId(game.homeTeamId);
    const gameLatestAwayTeam = teams.getTeamForId(game.awayTeamId);
    const gameTeamIds = [gameLatestHomeTeam.teamId, gameLatestAwayTeam.teamId].sort((a, b) => a - b);
    const gameGameKey = `${game.seasonIndex}-${game.weekIndex}-${gameTeamIds[0]}-${gameTeamIds[1]}`;

    return gameGameKey === gameKey;
  });

  // Return the game with the latest timestamp
  return matchingGames.reduce((latest, current) =>
    current.timestamp > latest.timestamp ? current : latest
  )
}

export function createPlayerKey(player: { presentationId: number, birthYear: number, birthMonth: number, birthDay: number }) {
  return `${player.presentationId}-${player.birthYear}-${player.birthMonth}-${player.birthDay}`
}

export function withMetrics<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)

      if (typeof value === "function") {
        return (...args: unknown[]) => {
          maddenDBRequestsCounter.inc({ method: String(prop) })
          return value.apply(target, args)
        }
      }

      return value
    }
  })
}
