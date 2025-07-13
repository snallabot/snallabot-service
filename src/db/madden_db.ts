import { randomUUID } from "crypto"
import { Timestamp } from "firebase-admin/firestore"
import db from "./firebase"
import EventDB, { EventNotifier, SnallabotEvent, StoredEvent, notifiers } from "./events_db"
import { DefensiveStats, KickingStats, MADDEN_SEASON, MaddenGame, POSITION_GROUP, PassingStats, Player, PuntingStats, ReceivingStats, RushingStats, Standing, Team, dLinePositions, dbPositions, oLinePositions } from "../export/madden_league_types"
import { TeamAssignments } from "../discord/settings_db"

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

export type PlayerListQuery = { teamId?: number, position?: string, rookie?: boolean }

interface MaddenDB {
  appendEvents<Event>(event: SnallabotEvent<Event>[], idFn: (event: Event) => string): Promise<void>
  on<Event>(event_type: string, notifier: EventNotifier<Event>): void,
  getLatestTeams(leagueId: string): Promise<TeamList>,
  getLatestWeekSchedule(leagueId: string, week: number): Promise<MaddenGame[]>,
  getWeekScheduleForSeason(leagueId: string, week: number, season: number): Promise<MaddenGame[]>
  getGameForSchedule(leagueId: string, scheduleId: number, week: number, season: number): Promise<MaddenGame>,
  getStandingForTeam(leagueId: string, teamId: number): Promise<Standing>,
  getLatestStandings(leagueId: string): Promise<Standing[]>,
  getLatestPlayers(leagueId: string): Promise<Player[]>,
  getPlayer(leagueId: string, rosterId: string): Promise<Player>,
  getPlayerStats(leagueId: string, player: Player): Promise<PlayerStats>,
  getGamesForSchedule(leagueId: string, scheduleIds: Iterable<{ id: number, week: number, season: number }>): Promise<MaddenGame[]>,
  getPlayers(leagueId: string, query: PlayerListQuery, limit: number, startAfter?: Player, endBefore?: Player): Promise<Player[]>
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
    if (unMatched.length > 0) {
      // lets just assume the unmatched are normal teams
      unMatched.forEach(unmatched => {
        latestTeams.push(unmatched)
        latestTeamMap.set(unmatched.teamId, unmatched)
      })
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
        const latestTeam = this.getTeamForId(Number(teamId))
        return [latestTeam.teamId + "", assignment]
      }))
    }
  }
}

async function getStats<T extends { rosterId: number, stageIndex: number }>(leagueId: string, rosterId: number, collection: string): Promise<SnallabotEvent<T>[]> {
  const stats = await db.collection("league_data").doc(leagueId).collection(collection).where("rosterId", "==", rosterId).get()
  const playerStats = stats.docs.map(d => d.data() as StoredEvent<T>).filter(d => d.stageIndex > 0)
  try {
    const historyDocs = await db.collectionGroup("history").where("rosterId.oldValue", "==", rosterId).get()
    const fromhistory = await Promise.all(historyDocs.docs.filter(d => {
      return d.ref.parent.parent?.parent.id === collection
    }).flatMap(d => d.ref.parent.parent?.id ? [d.ref.parent.parent.id] : [])
      .map(async docId => {
        const ogDoc = await db.collection("league_data").doc(leagueId).collection(collection).doc(docId).get()
        const data = ogDoc.data() as StoredEvent<T>
        const histories = await db.collection("league_data").doc(leagueId).collection(collection).doc(docId).collection("history").get()
        const changes = histories.docs.map(d => convertDate(d.data() as StoredHistory))
        const historyStats = reconstructFromHistory<T>(changes, data)
        historyStats.push(data)
        return historyStats.filter(d => d.rosterId === rosterId && d.stageIndex > 0)
      }))
    return playerStats.concat(fromhistory.flat())
  }
  catch (e) {
    return playerStats
  }
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
        const doc = db.collection("league_data").doc(event.key).collection(event.event_type).doc(eventId)
        const fetchedDoc = await doc.get()
        if (fetchedDoc.exists) {
          const { timestamp: oldTimestamp, id, ...oldEvent } = fetchedDoc.data() as StoredEvent<Event>
          const change = createEventHistoryUpdate(event, oldEvent)
          if (Object.keys(change).length > 0) {
            const changeId = randomUUID()
            const historyDoc = db.collection("league_data").doc(event.key).collection(event.event_type).doc(eventId).collection("history").doc(changeId)
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
    Object.entries(Object.groupBy(events, e => e.event_type)).map(async entry => {
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
    })
  },
  on<Event>(event_type: string, notifier: EventNotifier<Event>) {
    EventDB.on(event_type, notifier)
  },
  getLatestTeams: async function(leagueId: string): Promise<TeamList> {
    const teamDocs = await db.collection("league_data").doc(leagueId).collection("MADDEN_TEAM").get()
    return createTeamList(teamDocs.docs.filter(d => d.id !== "leagueteams").map(d => d.data() as StoredEvent<Team>))
  },
  getLatestWeekSchedule: async function(leagueId: string, week: number) {
    const weekDocs = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").where("weekIndex", "==", week - 1)
      .where("stageIndex", "==", 1).get()
    const maddenSchedule = weekDocs.docs.filter(d => !d.id.startsWith("schedules")).map(d => d.data() as SnallabotEvent<MaddenGame>)
      .filter(game => game.awayTeamId != 0 && game.homeTeamId != 0)
    if (maddenSchedule.length === 0) {
      throw new Error("Missing schedule for week " + week)
    }
    const bySeason = Object.groupBy(maddenSchedule, s => s.seasonIndex)
    const latestSeason = Math.max(...(Object.keys(bySeason).map(i => Number(i))))
    const latestSeasonSchedule = bySeason[latestSeason]
    if (latestSeasonSchedule) {
      return latestSeasonSchedule
    }
    throw new Error("Missing schedule for week " + week)
  },
  getWeekScheduleForSeason: async function(leagueId: string, week: number, season: number) {
    const weekDocs = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").where("weekIndex", "==", week - 1).where("seasonIndex", "==", season)
      .where("stageIndex", "==", 1).get()
    const maddenSchedule = weekDocs.docs.filter(d => !d.id.startsWith("schedules")).map(d => d.data() as SnallabotEvent<MaddenGame>)
      .filter(game => game.awayTeamId != 0 && game.homeTeamId != 0)
    if (maddenSchedule.length !== 0) {
      return maddenSchedule
    }
    const allDocs = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").get()
    const allGameChanges = await Promise.all(allDocs.docs.map(async (doc) => {
      if (doc.id.startsWith("schedules")) {
        return []
      }
      const data = doc.data() as StoredEvent<MaddenGame>
      const changesSnapshot = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").doc(doc.id).collection("history").get()
      const changes = changesSnapshot.docs.map(d => convertDate(d.data() as StoredHistory))
      return reconstructFromHistory(changes, data)
    }))
    const allGames = Object.entries(Object.groupBy(allGameChanges.flat(), g => `${g.id}|${g.weekIndex}|${g.seasonIndex}`))
      .flatMap(entry => {
        const [_, gamesInWeek] = entry
        if (gamesInWeek && gamesInWeek.length > 0) {
          return [gamesInWeek.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0]]
        }
        return []
      }).filter(g => g.weekIndex === week - 1 && g.seasonIndex === season && g.stageIndex > 0)
    if (allGames.length === 0) {
      throw new Error(`Missing schedule for week ${week} and season ${MADDEN_SEASON + season}`)
    }
    return allGames
  },
  getGameForSchedule: async function(leagueId: string, scheduleId: number, week: number, season: number) {
    const schedule = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").doc(`${scheduleId}`).get()
    if (!schedule.exists) {
      throw new Error("Schedule document not found for id " + scheduleId)
    }
    const game = schedule.data() as MaddenGame
    if (game.weekIndex === week - 1 && season === game.seasonIndex) {
      return game
    }
    const history = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").doc(`${scheduleId}`).collection("history").get()
    const changes: StoredHistory[] = history.docs
      .map(doc => convertDate(doc.data() as StoredHistory))
    const allGames = reconstructFromHistory(changes, game)
    const correctGame = allGames.filter(g => g.weekIndex === week - 1 && g.seasonIndex === season && g.stageIndex > 0)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    if (correctGame.length === 0) {
      throw new Error("Schedule not found for id " + scheduleId + ` ${week} and ${season}`)
    }
    return correctGame[0]
  },
  getStandingForTeam: async function(leagueId: string, teamId: number) {
    const standing = await db.collection("league_data").doc(leagueId).collection("MADDEN_STANDING").doc(`${teamId}`).get()
    if (!standing.exists) {
      throw new Error("standing not found for id " + teamId)
    }
    return standing.data() as Standing
  },
  getLatestStandings: async function(leagueId: string) {
    const standingSnapshot = await db.collection("league_data").doc(leagueId).collection("MADDEN_STANDING").get()
    return standingSnapshot.docs.filter(d => d.id !== "standings").map(doc => {
      return doc.data() as SnallabotEvent<Standing>
    })
  },
  getLatestPlayers: async function(leagueId: string) {
    const playerSnapshot = await db.collection("league_data").doc(leagueId).collection("MADDEN_PLAYER").select("rosterId", "firstName", "lastName", "teamId", "position").get()
    return playerSnapshot.docs.filter(d => !d.id.startsWith("roster")).map(doc => {
      return doc.data() as SnallabotEvent<Player>
    })
  },
  getPlayer: async function(leagueId: string, rosterId: string) {
    const playerDoc = await db.collection("league_data").doc(leagueId).collection("MADDEN_PLAYER").doc(rosterId).get()
    if (playerDoc.exists) {
      return playerDoc.data() as Player
    }
    throw new Error(`Player ${rosterId} not found in league ${leagueId}`)
  },
  getPlayerStats: async function(leagueId: string, player: Player): Promise<PlayerStats> {
    const rosterId = player.rosterId
    switch (player.position) {
      case "QB":
        const [passingStats, rushingStats] = await Promise.all([getStats<PassingStats>(leagueId, rosterId, "MADDEN_PASSING_STAT"), getStats<RushingStats>(leagueId, rosterId, "MADDEN_RUSHING_STAT")])
        return {
          [PlayerStatType.PASSING]: passingStats,
          [PlayerStatType.RUSHING]: rushingStats,
        }
      case "HB":
      case "FB":
      case "WR":
      case "TE":
        const [rushing, receivingStats] = await Promise.all([getStats<RushingStats>(leagueId, rosterId, "MADDEN_RUSHING_STAT"), getStats<ReceivingStats>(leagueId, rosterId, "MADDEN_RECEIVING_STAT")])
        return {
          [PlayerStatType.RUSHING]: rushing,
          [PlayerStatType.RECEIVING]: receivingStats
        }
      case "K":
        const kickingStats = await getStats<KickingStats>(leagueId, rosterId, "MADDEN_KICKING_STAT")
        return {
          [PlayerStatType.KICKING]: kickingStats
        }
      case "P":
        const puntingStats = await getStats<PuntingStats>(leagueId, rosterId, "MADDEN_PUNTING_STAT")
        return {
          [PlayerStatType.PUNTING]: puntingStats
        }
      case "LE":
      case "RE":
      case "DT":
      case "LOLB":
      case "ROLB":
      case "MLB":
      case "CB":
      case "FS":
      case "SS":
        const defenseStats = await getStats<DefensiveStats>(leagueId, rosterId, "MADDEN_DEFENSIVE_STAT")
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
  getPlayers: async function(leagueId: string, query: PlayerListQuery, limit, startAfter?: Player, endBefore?: Player) {
    let playersQuery;
    // flip the query for going backwards by ordering opposite and using start after
    if (endBefore) {
      playersQuery = db.collection("league_data").doc(leagueId).collection("MADDEN_PLAYER").orderBy("playerBestOvr", "asc").orderBy("rosterId", "desc").limit(limit)
    } else {
      playersQuery = db.collection("league_data").doc(leagueId).collection("MADDEN_PLAYER").orderBy("playerBestOvr", "desc").orderBy("rosterId").limit(limit)
    }
    if ((query.teamId && query.teamId !== -1) || query.teamId === 0) {
      playersQuery = playersQuery.where("teamId", "==", query.teamId);
    }

    if (query.position) {
      if (POSITION_GROUP.includes(query.position)) {
        if (query.position === "OL") {
          playersQuery = playersQuery.where("position", "in", oLinePositions)
        } else if (query.position === "DL") {
          playersQuery = playersQuery.where("position", "in", dLinePositions)
        } else if (query.position === "DB") {
          playersQuery = playersQuery.where("position", "in", dbPositions)
        }
      } else {
        playersQuery = playersQuery.where("position", "==", query.position);
      }
    }

    if (query.rookie) {
      playersQuery = playersQuery.where("yearsPro", "==", 0);
    }

    if (startAfter) {
      playersQuery = playersQuery.startAfter(startAfter.playerBestOvr, startAfter.rosterId);
    }

    if (endBefore) {
      playersQuery = playersQuery.startAfter(endBefore.playerBestOvr, endBefore.rosterId);
    }

    const snapshot = await playersQuery.get();

    const players = snapshot.docs.map(d => d.data() as Player)
    if (endBefore) {
      return players.reverse()
    } else {
      return players
    }

  }
}

export default MaddenDB
