import { randomUUID } from "crypto"
import { Timestamp } from "firebase-admin/firestore"
import db from "./firebase"
import EventDB, { EventNotifier, SnallabotEvent, StoredEvent, notifiers } from "./events_db"
import { DefensiveStats, GameResult, KickingStats, MADDEN_SEASON, MaddenGame, POSITION_GROUP, PassingStats, Player, PuntingStats, ReceivingStats, RushingStats, Standing, Team, TeamStats, dLinePositions, dbPositions, oLinePositions } from "../export/madden_league_types"
import { TeamAssignments } from "../discord/settings_db"
import NodeCache from "node-cache"
import { CachedUpdatingView, View } from "./view"

// getting Teams is a high request rate, by caching we can avoid calling the data when it hasnt changed
const teamCache = new NodeCache()

type HistoryUpdate<ValueType> = { oldValue: ValueType, newValue: ValueType }
type History = { [key: string]: HistoryUpdate<any>, }
type StoredHistory = { timestamp: Date } & History

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

export type PlayerListQuery = { teamId?: number, position?: string, rookie?: boolean }
type IndividualStatus = { lastExported: Date }
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

export type SeasonWeek = { seasonIndex: number, weekIndex: number }
type SmallPlayerIndex = {
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
interface MaddenDB {
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
  getTeamSchedule(leagueId: string, season?: number): Promise<MaddenGame[]>
}

function convertDate(firebaseObject: any) {
  if (!firebaseObject) return null;

  for (const [key, value] of Object.entries(firebaseObject)) {

    // covert items inside array
    if (value && Array.isArray(value))
      firebaseObject[key] = value.map(item => convertDate(item));

    // convert inner objects
    if (value && typeof value === 'object') {
      firebaseObject[key] = convertDate(value);
    }

    // convert simple properties
    if (value && value.hasOwnProperty('_seconds'))
      firebaseObject[key] = (value as Timestamp).toDate();
  }
  return firebaseObject;
}

function createEventHistoryUpdate(newEvent: Record<string, any>, oldEvent: Record<string, any>): History {
  const change: History = {}
  Object.keys(newEvent).forEach(key => {
    const oldValue = oldEvent[key]
    if (typeof oldValue !== 'object') {
      const newValue = newEvent[key]
      if (newValue !== oldValue) {
        change[key] = {} as HistoryUpdate<any>
        oldValue !== undefined && (change[key].oldValue = oldValue)
        newValue !== undefined && (change[key].newValue = newValue)
      }
    }
  })
  return change
}

export interface TeamList {
  getTeamForId(id: number): Team,
  getLatestTeams(): Team[],
  getLatestTeamAssignments(assignments: TeamAssignments): TeamAssignments
}

function createTeamList(teams: StoredEvent<Team>[]): TeamList {
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

function deduplicateStats<T extends { weekIndex: number, seasonIndex: number, timestamp: Date }>(stats: T[]) {
  const statMap = new Map<string, T>();

  for (const stat of stats) {
    const key = `${stat.seasonIndex}-${stat.weekIndex}`;
    const existing = statMap.get(key);

    // If no existing stat for this season/week, or current stat is newer, use it
    if (!existing || stat.timestamp > existing.timestamp) {
      statMap.set(key, stat);
    }
  }

  return Array.from(statMap.values());
}

async function getStats<T extends { rosterId: number, stageIndex: number, weekIndex: number, seasonIndex: number, timestamp: Date }>(leagueId: string, rosterIds: number[], collection: string): Promise<SnallabotEvent<T>[]> {
  const stats = await Promise.all(rosterIds.map(async rosterId => await db.collection("madden_data26").doc(leagueId).collection(collection).where("rosterId", "==", rosterId).get()))
  const playerStats = stats.flatMap(s => s.docs).map(d => convertDate(d.data()) as StoredEvent<T>).filter(d => d.stageIndex > 0)
  return deduplicateStats(playerStats)
}


function reconstructFromHistory<T>(histories: StoredHistory[], og: T) {
  const changes = histories.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const all: StoredEvent<T>[] = []
  let previousVersion = { ...og };
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    const reconstructedSchedule = { ...previousVersion };

    Object.entries(change).forEach(([field, values]) => {
      if (field !== "timestamp") {
        (reconstructedSchedule as any)[field] = (values as HistoryUpdate<any>).oldValue;
      } else {
        (reconstructedSchedule as StoredEvent<T>).timestamp = (values as Date);
      }
    });
    all.push(reconstructedSchedule as StoredEvent<T>);
    previousVersion = { ...reconstructedSchedule };
  }
  return all
}


function deduplicateSchedule(games: StoredEvent<MaddenGame>[], teams: TeamList): StoredEvent<MaddenGame>[] {
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

export function createPlayerKey(player: { presentationId: number, birthYear: number, birthMonth: number, birthDay: number }) {
  return `${player.presentationId}-${player.birthYear}-${player.birthMonth}-${player.birthDay}`
}

function deduplicatePlayers(players: StoredEvent<Player>[]): StoredEvent<Player>[] {
  const playerMap = new Map<string, StoredEvent<Player>>();

  for (const player of players) {
    // Create a unique key using the combination of identifying fields
    const playerKey = `${player.presentationId}-${player.birthYear}-${player.birthMonth}-${player.birthDay}`;
    const existingPlayer = playerMap.get(playerKey);

    if (!existingPlayer) {
      // First occurrence of this player
      playerMap.set(playerKey, player);
    } else {
      // Duplicate found - keep the one with the later timestamp
      if (player.timestamp > existingPlayer.timestamp) {
        playerMap.set(playerKey, player);
      }
      // If existing player has later timestamp, we keep it (do nothing)
    }
  }

  return Array.from(playerMap.values());
}

function findLatestScheduleId(scheduleId: number, games: StoredEvent<MaddenGame>[], teams: TeamList): StoredEvent<MaddenGame> {
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

type PlayerListIndex = {
  [key: string]: SmallPlayerIndex
}

class PlayerListView extends View<PlayerListIndex> {
  constructor() {
    super("player_list")
  }

  async createView(key: string) {
    const playerSnapshot = await db.collection("madden_data26").doc(key).collection(MaddenEvents.MADDEN_PLAYER).select("rosterId", "firstName", "lastName", "teamId", "position", "birthYear", "birthMonth", "birthDay", "presentationId", "timestamp", "yearsPro", "playerBestOvr").get()
    const players = deduplicatePlayers(playerSnapshot.docs.map(doc => {
      return convertDate(doc.data()) as StoredEvent<Player>
    }))
    return Object.fromEntries(players.map(player => {
      return [`${player.presentationId}-${player.birthYear}-${player.birthMonth}-${player.birthDay}`, {
        rosterId: `${player.rosterId}`,
        firstName: player.firstName,
        lastName: player.lastName,
        teamId: `${player.teamId}`,
        yearsPro: player.yearsPro,
        playerBestOvr: player.playerBestOvr,
        position: player.position,
        birthYear: player.birthYear,
        birthMonth: player.birthMonth,
        birthDay: player.birthDay,
        presentationId: player.presentationId
      }]
    }))
  }
}

class CacheablePlayerListView extends CachedUpdatingView<PlayerListIndex> {
  constructor() {
    super(new PlayerListView())
  }

  update(events: { [key: string]: any[] }, currentView: PlayerListIndex) {
    if (events[MaddenEvents.MADDEN_PLAYER]) {
      const playersToUpdate = events[MaddenEvents.MADDEN_PLAYER]
      playersToUpdate.map(player => {
        currentView[`${player.presentationId}-${player.birthYear}-${player.birthMonth}-${player.birthDay}`] = {
          rosterId: `${player.rosterId}`,
          firstName: player.firstName,
          lastName: player.lastName,
          teamId: `${player.teamId}`,
          playerBestOvr: player.playerBestOvr,
          yearsPro: player.yearsPro,
          position: player.position,
          birthYear: player.birthYear,
          birthMonth: player.birthMonth,
          birthDay: player.birthDay,
          presentationId: player.presentationId
        }
      })
    }
    return currentView
  }
}

const playerListIndex = new CacheablePlayerListView()
playerListIndex.listen(MaddenEvents.MADDEN_PLAYER)

type TeamSearch = {
  [key: string]: {
    cityName: string,
    abbrName: string,
    nickName: string,
    displayName: string,
    id: number
  }
}
class TeamSearchIndex extends View<TeamSearch> {
  constructor() {
    super("team_search_index")
  }
  async createView(key: string) {
    const teams = await MaddenDB.getLatestTeams(key)
    return Object.fromEntries(teams.getLatestTeams().map(t => { return [`${t.teamId}`, { cityName: t.cityName, abbrName: t.abbrName, nickName: t.nickName, displayName: t.displayName, id: t.teamId }] }))
  }
}

class CacheableTeamSearchIndex extends CachedUpdatingView<TeamSearch> {
  constructor() {
    super(new TeamSearchIndex())
  }

  update(event: { [key: string]: any[] }, currentView: TeamSearch): TeamSearch {
    if (event[MaddenEvents.MADDEN_TEAM]) {
      const updatedTeams = event[MaddenEvents.MADDEN_TEAM] as SnallabotEvent<Team>[]
      updatedTeams.forEach(t => {
        currentView[t.teamId] = { cityName: t.cityName, abbrName: t.abbrName, nickName: t.nickName, displayName: t.displayName, id: t.teamId }
      })
    }
    return currentView
  }
}

export const teamSearchView = new CacheableTeamSearchIndex()
teamSearchView.listen(MaddenEvents.MADDEN_TEAM)

const MaddenDB: MaddenDB = {
  async appendEvents<Event>(events: SnallabotEvent<Event>[], idFn: (event: Event) => string) {
    const BATCH_SIZE = 500;
    const timestamp = new Date();
    const totalBatches = Math.ceil(events.length / BATCH_SIZE);
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIdx = batchIndex * BATCH_SIZE;
      const endIdx = Math.min((batchIndex + 1) * BATCH_SIZE, events.length);
      const batchEvents = events.slice(startIdx, endIdx);
      const batch = db.batch()
      await Promise.all(batchEvents.map(async event => {
        const eventId = idFn(event)
        const doc = db.collection("madden_data26").doc(event.key).collection(event.event_type).doc(eventId)
        const fetchedDoc = await doc.get()
        if (fetchedDoc.exists) {
          const { timestamp: oldTimestamp, id, ...oldEvent } = fetchedDoc.data() as StoredEvent<Event>
          const change = createEventHistoryUpdate(event, oldEvent)
          if (Object.keys(change).length > 0) {
            const changeId = randomUUID()
            const historyDoc = db.collection("madden_data26").doc(event.key).collection(event.event_type).doc(eventId).collection("history").doc(changeId)
            batch.set(historyDoc, { ...change, timestamp: timestamp })
          }
        }
        batch.set(doc, { ...event, timestamp: timestamp, id: eventId })
      }))
      let retryCount = 0
      while (retryCount < 10) {
        try {
          await batch.commit()
          break
        } catch (e) {
          retryCount = retryCount + 1
          await new Promise((r) => setTimeout(r, 1000))
          console.log("errored, slept and retrying, " + e)
        }
      }
    }
    await Promise.all(Object.entries(Object.groupBy(events, e => e.event_type)).map(async entry => {
      const [eventType, specificTypeEvents] = entry
      if (specificTypeEvents) {
        const eventTypeNotifiers = notifiers[eventType]
        if (eventTypeNotifiers) {
          await Promise.all(eventTypeNotifiers.map(async notifier => {
            try {
              await notifier(specificTypeEvents)
            } catch (e) {
              console.log("could not send event to notifier " + e)
            }
          }))
        }
      }
    }))
  },
  on<Event>(event_type: string, notifier: EventNotifier<Event>) {
    EventDB.on(event_type, notifier)
  },
  getLatestTeams: async function(leagueId: string): Promise<TeamList> {
    const cachedTeamDocs = teamCache.get(leagueId) as Record<string, StoredEvent<Team>>
    if (cachedTeamDocs) {
      return createTeamList(Object.values(cachedTeamDocs))
    } else {
      const teamDocs = await db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_TEAM).get()
      const teams = teamDocs.docs.map(d => convertDate(d.data()) as StoredEvent<Team>)
      teamCache.set(leagueId, Object.fromEntries(teams.map(t => [`${t.teamId}`, t])))
      return createTeamList(teams)
    }
  },
  getLatestWeekSchedule: async function(leagueId: string, week: number) {
    const [weekDocs, teamList] = await Promise.all([db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_SCHEDULE).where("weekIndex", "==", week - 1)
      .where("stageIndex", "==", 1).orderBy("seasonIndex", "desc").get(), this.getLatestTeams(leagueId)])
    const maddenSchedule = weekDocs.docs.map(d => convertDate(d.data()) as StoredEvent<MaddenGame>)
      .filter(game => game.awayTeamId != 0 && game.homeTeamId != 0)
    if (maddenSchedule.length === 0) {
      throw new Error("Missing schedule for week " + week)
    }
    const bySeason = Object.groupBy(maddenSchedule, s => s.seasonIndex)
    const latestSeason = Math.max(...(Object.keys(bySeason).map(i => Number(i))))
    const latestSeasonSchedule = bySeason[latestSeason]
    if (latestSeasonSchedule) {
      return deduplicateSchedule(latestSeasonSchedule, teamList)
    }
    throw new Error("Missing schedule for week " + week)
  },
  getLatestSchedule: async function(leagueId: string) {
    const scheduleCollection = db.collection("madden_data26")
      .doc(leagueId)
      .collection(MaddenEvents.MADDEN_SCHEDULE);
    const teamList = await this.getLatestTeams(leagueId)

    // Query for unplayed games only
    const allGames = await scheduleCollection
      .where("stageIndex", "==", 1)
      .get()

    const games = deduplicateSchedule(allGames.docs.map(d => convertDate(d.data()) as StoredEvent<MaddenGame>), teamList)
    const unplayedGames = games.filter(g => g.status === GameResult.NOT_PLAYED)

    if (unplayedGames.length === 0) {
      // All games have been played - get games from the latest week of the latest season
      const maxSeason = Math.max(...games.map(game => game.seasonIndex));
      const gamesInLatestSeason = games.filter(game => game.seasonIndex === maxSeason);
      const maxWeek = Math.max(...gamesInLatestSeason.map(game => game.weekIndex));
      return deduplicateSchedule(games.filter(game => game.seasonIndex === maxSeason && game.weekIndex === maxWeek), teamList)
    }

    // Find the latest season and week with unplayed games
    const currentSeason = Math.max(...unplayedGames.map(game => game.seasonIndex));
    const gamesInCurrentSeason = unplayedGames.filter(game => game.seasonIndex === currentSeason);
    const currentWeek = Math.min(...gamesInCurrentSeason.map(game => game.weekIndex));

    // Return all games from the current season and week
    const currentWeekGames = await scheduleCollection
      .where("seasonIndex", "==", currentSeason)
      .where("weekIndex", "==", currentWeek)
      .where("stageIndex", "==", 1)
      .get();

    return deduplicateSchedule(currentWeekGames.docs.map(doc => doc.data() as StoredEvent<MaddenGame>), teamList)
  },
  getPlayoffSchedule: async function(leagueId: string) {
    const weeks = await this.getAllWeeks(leagueId)
    const currentSeason = weeks.length === 0 ? 0 : Math.max(...weeks.map(ws => ws.seasonIndex))
    const scheduleRef = db.collection("madden_data26")
      .doc(leagueId)
      .collection(MaddenEvents.MADDEN_SCHEDULE)
      .where("seasonIndex", "==", currentSeason)
    const playoffGames = await Promise.all([scheduleRef
      .where("weekIndex", "==", 18)
      .get(), scheduleRef
        .where("weekIndex", "==", 19)
        .get(),
    scheduleRef
      .where("weekIndex", "==", 20)
      .get(),
    scheduleRef
      .where("weekIndex", "==", 22)
      .get()
    ])
    const teamList = await this.getLatestTeams(leagueId)
    return deduplicateSchedule(playoffGames.flatMap(p => p.docs.map(d => convertDate(d.data()) as StoredEvent<MaddenGame>)), teamList)
  }
  ,
  getWeekScheduleForSeason: async function(leagueId: string, week: number, season: number) {
    const [weekDocs, teamList] = await Promise.all([db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_SCHEDULE).where("weekIndex", "==", week - 1).where("seasonIndex", "==", season)
      .where("stageIndex", "==", 1).get(), this.getLatestTeams(leagueId)])
    const maddenSchedule = deduplicateSchedule(weekDocs.docs.map(d => convertDate(d.data()) as StoredEvent<MaddenGame>), teamList)
      .filter(game => game.awayTeamId != 0 && game.homeTeamId != 0)
    if (maddenSchedule.length !== 0) {
      return maddenSchedule
    }
    throw new Error(`Missing schedule for week ${week} and season ${MADDEN_SEASON + season}`)
  },
  getGameForSchedule: async function(leagueId: string, scheduleId: number, week: number, season: number) {
    const [weekDocs, teamList] = await Promise.all([db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_SCHEDULE).where("weekIndex", "==", week - 1).where("seasonIndex", "==", season)
      .where("stageIndex", "==", 1).get(), this.getLatestTeams(leagueId)])
    return findLatestScheduleId(scheduleId, weekDocs.docs.map(d => convertDate(d.data()) as StoredEvent<MaddenGame>), teamList)
  },
  getAllWeeks: async function(leagueId: string) {
    const schedules = await db.collection("madden_data26")
      .doc(leagueId)
      .collection(MaddenEvents.MADDEN_SCHEDULE)
      .where("stageIndex", "==", 1)
      .select("seasonIndex", "weekIndex")
      .get()
    const games = schedules.docs.map(d => d.data() as { seasonIndex: number, weekIndex: number })
    const distinctWeekSeason = Object.entries(Object.groupBy(games, g => `${g.seasonIndex}_${g.weekIndex}`)).flatMap(e => {
      const [_, gamesInWeek] = e
      return gamesInWeek ? [gamesInWeek[0]] : []
    })
    return distinctWeekSeason

  }
  ,
  getStandingForTeam: async function(leagueId: string, teamId: number) {
    const teamList = await this.getLatestTeams(leagueId)
    const standing = await db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_STANDING).doc(`${teamList.getTeamForId(teamId).teamId}`).get()
    if (!standing.exists) {
      throw new Error("standing not found for id " + teamId)
    }
    return standing.data() as Standing
  },
  getLatestStandings: async function(leagueId: string) {
    const [standingSnapshot, teamList] = await Promise.all([db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_STANDING).get(), this.getLatestTeams(leagueId)])
    const latestTeams = new Set(teamList.getLatestTeams().map(t => t.teamId))
    return standingSnapshot.docs.map(doc => {
      return doc.data() as Standing
    }).filter(s => latestTeams.has(s.teamId))
  },
  getLatestPlayers: async function(leagueId: string) {
    const view = await playerListIndex.createView(leagueId)
    if (view) {
      return Object.values(view)
    }
    return []
  },
  getPlayer: async function(leagueId: string, rosterId: string) {
    const playerDoc = await db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_PLAYER).doc(rosterId).get()
    if (playerDoc.exists) {
      const foundPlayer = convertDate(playerDoc.data()) as Player
      const potentiallyDuplicatePlayers = await db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_PLAYER)
        .where("presentationId", "==", foundPlayer.presentationId)
        .where("birthYear", "==", foundPlayer.birthYear)
        .where("birthMonth", "==", foundPlayer.birthMonth)
        .where("birthDay", "==", foundPlayer.birthDay)
        .get()
      return potentiallyDuplicatePlayers.docs.map(p => convertDate(p.data()) as StoredEvent<Player>).reduce((latest, current) =>
        current.timestamp > latest.timestamp ? current : latest
      )
    }
    throw new Error(`Player ${rosterId} not found in league ${leagueId}`)
  },
  getPlayerStats: async function(leagueId: string, player: Player): Promise<PlayerStats> {
    const potentiallyDuplicatePlayers = await db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_PLAYER)
      .where("presentationId", "==", player.presentationId)
      .where("birthYear", "==", player.birthYear)
      .where("birthMonth", "==", player.birthMonth)
      .where("birthDay", "==", player.birthDay)
      .get()
    const rosterIds = potentiallyDuplicatePlayers.docs.map(d => d.data() as Player).map(p => p.rosterId)
    switch (player.position) {
      case "QB":
        const [passingStats, rushingStats] = await Promise.all([getStats<StoredEvent<PassingStats>>(leagueId, rosterIds, MaddenEvents.MADDEN_PASSING_STAT), getStats<StoredEvent<RushingStats>>(leagueId, rosterIds, MaddenEvents.MADDEN_RUSHING_STAT)])
        return {
          [PlayerStatType.PASSING]: passingStats,
          [PlayerStatType.RUSHING]: rushingStats,
        }
      case "HB":
      case "FB":
      case "WR":
      case "TE":
        const [rushing, receivingStats] = await Promise.all([getStats<StoredEvent<RushingStats>>(leagueId, rosterIds, MaddenEvents.MADDEN_RUSHING_STAT), getStats<StoredEvent<ReceivingStats>>(leagueId, rosterIds, MaddenEvents.MADDEN_RECEIVING_STAT)])
        return {
          [PlayerStatType.RUSHING]: rushing,
          [PlayerStatType.RECEIVING]: receivingStats
        }
      case "K":
        const kickingStats = await getStats<StoredEvent<KickingStats>>(leagueId, rosterIds, MaddenEvents.MADDEN_KICKING_STAT)
        return {
          [PlayerStatType.KICKING]: kickingStats
        }
      case "P":
        const puntingStats = await getStats<StoredEvent<PuntingStats>>(leagueId, rosterIds, MaddenEvents.MADDEN_PUNTING_STAT)
        return {
          [PlayerStatType.PUNTING]: puntingStats
        }
      case "LEDGE":
      case "REDGE":
      case "DT":
      case "SAM":
      case "MIKE":
      case "WILL":
      case "CB":
      case "FS":
      case "SS":
        const defenseStats = await getStats<StoredEvent<DefensiveStats>>(leagueId, rosterIds, MaddenEvents.MADDEN_DEFENSIVE_STAT)
        return {
          [PlayerStatType.DEFENSE]: defenseStats
        }
      default:
        return {}
    }
  },
  getGamesForSchedule: async function(leagueId: string, scheduleIds: { id: number, week: number, season: number }[]) {
    return await Promise.all(scheduleIds.map(s => this.getGameForSchedule(leagueId, s.id, s.week, s.season)))
  },
  getPlayers: async function(leagueId: string, query: PlayerListQuery, limit: number, startAfter?: Player, endBefore?: Player) {
    const playerIndex = await playerListIndex.createView(leagueId)


    // Convert index object to array
    let players = playerIndex ? Object.values(playerIndex) : []

    // Apply filters
    if ((query.teamId && query.teamId !== -1) || query.teamId === 0) {
      const teams = await this.getLatestTeams(leagueId)
      const targetTeamId = query.teamId != 0 ? teams.getTeamForId(query.teamId).teamId : 0;
      players = players.filter(p => p.teamId === `${targetTeamId}`);
    }

    if (query.position) {
      if (POSITION_GROUP.includes(query.position)) {
        if (query.position === "OL") {
          players = players.filter(p => oLinePositions.includes(p.position));
        } else if (query.position === "DL") {
          players = players.filter(p => dLinePositions.includes(p.position));
        } else if (query.position === "DB") {
          players = players.filter(p => dbPositions.includes(p.position));
        }
      } else {
        players = players.filter(p => p.position === query.position);
      }
    }

    if (query.rookie) {
      players = players.filter(p => p.yearsPro === 0);
    }

    players.sort((a, b) => b.playerBestOvr - a.playerBestOvr);
    let resultPlayers;
    if (startAfter) {
      const cursorIndex = players.findIndex(p =>
        p.presentationId === startAfter.presentationId &&
        p.birthYear === startAfter.birthYear &&
        p.birthMonth === startAfter.birthMonth &&
        p.birthDay === startAfter.birthDay
      );

      if (cursorIndex !== -1) {
        resultPlayers = players.slice(cursorIndex + 1, Math.min(cursorIndex + 1 + limit, players.length));
      } else {
        resultPlayers = players.slice(0, limit);
      }
    } else if (endBefore) {
      const cursorIndex = players.findIndex(p =>
        p.presentationId === endBefore.presentationId &&
        p.birthYear === endBefore.birthYear &&
        p.birthMonth === endBefore.birthMonth &&
        p.birthDay === endBefore.birthDay
      );

      if (cursorIndex !== -1) {
        const startIndex = Math.max(0, Math.max(cursorIndex - limit, 0));
        resultPlayers = players.slice(startIndex, cursorIndex);
      } else {
        resultPlayers = players.slice(0, limit);
      }
    } else {
      resultPlayers = players.slice(0, limit);
    }

    // Fetch full player data
    const fullPlayers = await Promise.all(
      resultPlayers.map(p => this.getPlayer(leagueId, p.rosterId))
    );

    return fullPlayers;

  },
  updateLeagueExportStatus: async function(leagueId: string, eventType: MaddenEvents) {
    await db.collection("madden_data26").doc(leagueId).set({
      exportStatus: {
        [eventType]: { lastExported: new Date() }
      }
    }, { merge: true })
  },
  updateWeeklyExportStatus: async function(leagueId: string, eventType: MaddenEvents, weekIndex: number, season: number) {
    const weekKey = `season${String(season).padStart(2, '0')}_week${String(weekIndex).padStart(2, '0')}`
    await db.collection("madden_data26").doc(leagueId).set({
      exportStatus: {
        weeklyStatus: {
          [weekKey]: {
            [eventType]: { lastExported: new Date() }
          }
        }
      }
    }, { merge: true })
  },
  updateRosterExportStatus: async function(leagueId: string, eventType: MaddenEvents.MADDEN_PLAYER, teamId: string) {
    await db.collection("madden_data26").doc(leagueId).set({
      exportStatus: {
        rosterStatus: {
          [teamId]: {
            [eventType]: { lastExported: new Date() }
          }
        }
      }
    }, { merge: true })
  },
  getTeamStatsForGame: async function(leagueId: string, teamId: string, week: number, seasonIndex: number) {
    const teamStats = await db.collection("madden_data26").doc(leagueId).collection(MaddenEvents.MADDEN_TEAM_STAT)
      .where("week", "==", week - 1).where("seasonIndex", "==", seasonIndex).where("teamId", "==", teamId).limit(1).get()
    const data = teamStats.docs?.[0]?.data() as TeamStats
    if (data) {
      return data
    } else {
      throw new Error(`Missing Team Stats for ${MADDEN_SEASON + seasonIndex} Week ${week} for ${teamId}. Try exporting this week again`)
    }
  },
  getExportStatus: async function(leagueId: string) {
    const doc = await db.collection("madden_data26").doc(leagueId).get()
    if (doc.exists) {

      const leagueDoc = convertDate(doc.data()) as LeagueDoc
      return leagueDoc.exportStatus
    }
    return undefined
  },
  getStatsForGame: async function(leagueId: string, season: number, week: number, scheduleId: number) {
    const leagueRef = db.collection("madden_data26").doc(leagueId);
    const weekIndex = week - 1;

    // Query all stat collections in parallel
    const [
      teamStatsSnapshot,
      defensiveStatsSnapshot,
      kickingStatsSnapshot,
      puntingStatsSnapshot,
      receivingStatsSnapshot,
      rushingStatsSnapshot,
      passingStatsSnapshot
    ] = await Promise.all([
      leagueRef.collection(MaddenEvents.MADDEN_TEAM_STAT)
        .where("seasonIndex", "==", season)
        .where("weekIndex", "==", weekIndex)
        .where("scheduleId", "==", scheduleId)
        .get(),
      leagueRef.collection(MaddenEvents.MADDEN_DEFENSIVE_STAT)
        .where("seasonIndex", "==", season)
        .where("weekIndex", "==", weekIndex)
        .where("scheduleId", "==", scheduleId)
        .get(),
      leagueRef.collection(MaddenEvents.MADDEN_KICKING_STAT)
        .where("seasonIndex", "==", season)
        .where("weekIndex", "==", weekIndex)
        .where("scheduleId", "==", scheduleId)
        .get(),
      leagueRef.collection(MaddenEvents.MADDEN_PUNTING_STAT)
        .where("seasonIndex", "==", season)
        .where("weekIndex", "==", weekIndex)
        .where("scheduleId", "==", scheduleId)
        .get(),
      leagueRef.collection(MaddenEvents.MADDEN_RECEIVING_STAT)
        .where("seasonIndex", "==", season)
        .where("weekIndex", "==", weekIndex)
        .where("scheduleId", "==", scheduleId)
        .get(),
      leagueRef.collection(MaddenEvents.MADDEN_RUSHING_STAT)
        .where("seasonIndex", "==", season)
        .where("weekIndex", "==", weekIndex)
        .where("scheduleId", "==", scheduleId)
        .get(),
      leagueRef.collection(MaddenEvents.MADDEN_PASSING_STAT)
        .where("seasonIndex", "==", season)
        .where("weekIndex", "==", weekIndex)
        .where("scheduleId", "==", scheduleId)
        .get()
    ]);

    // Build the response object
    const gameStats: GameStats = {
      teamStats: teamStatsSnapshot.docs.map(doc => doc.data() as TeamStats),
      playerStats: {}
    };

    // Add player stats if they exist
    if (!defensiveStatsSnapshot.empty) {
      gameStats.playerStats[PlayerStatType.DEFENSE] = defensiveStatsSnapshot.docs.map(doc => doc.data() as DefensiveStats);
    }

    if (!kickingStatsSnapshot.empty) {
      gameStats.playerStats[PlayerStatType.KICKING] = kickingStatsSnapshot.docs.map(doc => doc.data() as KickingStats);
    }

    if (!puntingStatsSnapshot.empty) {
      gameStats.playerStats[PlayerStatType.PUNTING] = puntingStatsSnapshot.docs.map(doc => doc.data() as PuntingStats);
    }

    if (!receivingStatsSnapshot.empty) {
      gameStats.playerStats[PlayerStatType.RECEIVING] = receivingStatsSnapshot.docs.map(doc => doc.data() as ReceivingStats);
    }

    if (!rushingStatsSnapshot.empty) {
      gameStats.playerStats[PlayerStatType.RUSHING] = rushingStatsSnapshot.docs.map(doc => doc.data() as RushingStats);
    }

    if (!passingStatsSnapshot.empty) {
      gameStats.playerStats[PlayerStatType.PASSING] = passingStatsSnapshot.docs.map(doc => doc.data() as PassingStats);
    }

    return gameStats;
  },
  getTeamSchedule: async function(leagueId: string, season?: number) {
    const teams = await this.getLatestTeams(leagueId)
    const scheduleCollection = db.collection("madden_data26")
      .doc(leagueId)
      .collection(MaddenEvents.MADDEN_SCHEDULE).where("stageIndex", "==", 1)

    if (season !== undefined) {

      const seasonGamesSnapshot = await scheduleCollection
        .where("seasonIndex", "==", season)
        .get();

      const seasonGames = seasonGamesSnapshot.docs.map(doc => convertDate(doc.data()) as StoredEvent<MaddenGame>);

      return deduplicateSchedule(seasonGames, teams).sort((a, b) => a.weekIndex - b.weekIndex)
    } else {

      const allGamesSnapshot = await scheduleCollection.get();

      if (allGamesSnapshot.empty) {
        console.log("no games")
        return [];
      }

      const games = allGamesSnapshot.docs.map(doc => convertDate(doc.data()) as StoredEvent<MaddenGame>)
      const latestSeason = Math.max(...games.map(game => game.seasonIndex));
      return deduplicateSchedule(games
        .filter(game => game.seasonIndex === latestSeason)
        , teams).sort((a, b) => a.weekIndex - b.weekIndex)
    }
  }
}

export default MaddenDB

// when teams are updated, just delete the entry in the cache for now.
// simple is best? can revisit if we want to do event driven updates to it
MaddenDB.on<Team>(MaddenEvents.MADDEN_TEAM, async events => {
  const leagueId = events?.[0].key
  if (leagueId) {
    teamCache.del(leagueId)
  }
})
