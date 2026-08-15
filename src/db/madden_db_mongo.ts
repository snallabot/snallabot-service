import { randomUUID } from "crypto"
import db from "./mongo_db"
import EventDB, { EventNotifier, SnallabotEvent, StoredEvent, notifiers } from "./events_db"
import { DefensiveStats, GameResult, KickingStats, MADDEN_SEASON, MaddenGame, POSITION_GROUP, PassingStats, Player, PuntingStats, ReceivingStats, RushingStats, Standing, Team, TeamStats, dLinePositions, dbPositions, oLinePositions } from "../export/madden_league_types"
import { EventTypes, RetiredPlayersEvent } from "./events"
import { maddenDBRequestsCounter, maddenEventsDistribution } from "../debug/metrics"
import { ExportStatus, GameStats, MaddenDB, MaddenEvents, PlayerListIndex, PlayerListQuery, PlayerStatEvents, PlayerStatType, PlayerStatTypes, PlayerStats, TeamList, createPlayerKey, createTeamList, deduplicatePlayerStats, deduplicatePlayers, deduplicateSchedule, deduplicateStats, findLatestScheduleId } from "./madden_db"
import { CachedUpdatingView, StorageBackedCachedView, View } from "./view"

type HistoryUpdate<ValueType> = { oldValue?: ValueType, newValue?: ValueType }
type History = { [key: string]: HistoryUpdate<any> }
type StoredHistoryDoc = {
  leagueId: string,
  eventType: string,
  eventId: string,
  changeId: string,
  timestamp: Date
} & History


// Replaces the Firestore "league doc" — one flat collection, one doc per
// league, keyed by leagueId as the Mongo _id instead of a Firestore doc path.
export type LeagueDoc = {
  _id: string,
  exportStatus?: ExportStatus
}


// Firestore version issued one .where("rosterId","==",id).get() PER rosterId
// in a Promise.all. Mongo version issues a single query with $in instead —
// same result, far fewer round trips at your scale.
async function getStats<T extends { rosterId: number, stageIndex: number, weekIndex: number, seasonIndex: number }>(leagueId: string, rosterIds: number[], collection: string): Promise<StoredEvent<T>[]> {
  const docs = await db.collection(collection).find({ key: leagueId, rosterId: { $in: rosterIds } }).toArray()
  const playerStats = (docs as unknown as StoredEvent<T>[]).filter(d => d.stageIndex > 0)
  return deduplicateStats(playerStats)
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
        1
      }
    }
  })
  return change
}

class PlayerListView extends View<PlayerListIndex> {
  constructor() {
    super("player_list_v2")
  }

  async createView(key: string) {
    const playerDocs = await db.collection(MaddenEvents.MADDEN_PLAYER).find(
      { leagueId: key },
      { projection: { rosterId: 1, firstName: 1, lastName: 1, teamId: 1, position: 1, birthYear: 1, birthMonth: 1, birthDay: 1, presentationId: 1, timestamp: 1, yearsPro: 1, playerBestOvr: 1 } }
    ).toArray()
    const players = deduplicatePlayers(playerDocs as unknown as StoredEvent<Player>[])
    return Object.fromEntries(players.map(player => {
      return [createPlayerKey(player), {
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

class CacheablePlayerListView extends StorageBackedCachedView<PlayerListIndex> {
  constructor() {
    super(new PlayerListView())
  }

  update(events: { [key: string]: any[] }, currentView: PlayerListIndex) {
    if (events[MaddenEvents.MADDEN_PLAYER]) {
      const playersToUpdate = events[MaddenEvents.MADDEN_PLAYER]
      playersToUpdate.map(player => {
        currentView[createPlayerKey(player)] = {
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

export const playerListIndex = new CacheablePlayerListView()
playerListIndex.listen(MaddenEvents.MADDEN_PLAYER)

export type TeamIndex = {
  [key: string]: StoredEvent<Team>
}

class TeamView extends View<TeamIndex> {
  constructor() {
    super("team_view_v2")
  }
  async createView(key: string) {
    const teamDocs = await db.collection(MaddenEvents.MADDEN_TEAM).find({ leagueId: key }).toArray()
    const teams = teamDocs as unknown as StoredEvent<Team>[]
    return Object.fromEntries(teams.map(t => [`${t.teamId}`, t]))
  }
}

class CacheableTeamView extends CachedUpdatingView<TeamIndex> {
  constructor() {
    super(new TeamView)
  }
  update(event: { [key: string]: any[] }, currentView: TeamIndex): TeamIndex {
    if (event[MaddenEvents.MADDEN_TEAM]) {
      const updatedTeams = event[MaddenEvents.MADDEN_TEAM] as SnallabotEvent<Team>[]
      updatedTeams.forEach(t => {
        currentView[t.teamId] = { ...currentView[t.teamId], ...t }
      })
    }
    return currentView
  }
}

export const teamView = new CacheableTeamView
teamView.listen(MaddenEvents.MADDEN_TEAM)

type SeasonIndex = {
  currentSeasonIndex: number
}

class SeasonView extends View<SeasonIndex> {
  constructor() {
    super("season_view_v2")
  }
  async createView(key: string) {
    const teamList = await MaddenDB.getLatestTeams(key)
    const allGames = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId: key, stageIndex: 1 }).toArray()
    const games = deduplicateSchedule(allGames as unknown as StoredEvent<MaddenGame>[], teamList)
    if (games.length === 0) {
      return { currentSeasonIndex: 0 }
    }
    const maxSeason = Math.max(...games.map(game => game.seasonIndex));
    return { currentSeasonIndex: maxSeason }
  }
}

class CacheableSeasonView extends CachedUpdatingView<SeasonIndex> {
  constructor() {
    super(new SeasonView)
  }
  update(event: { [key: string]: any[] }, currentView: SeasonIndex): SeasonIndex {
    if (event[MaddenEvents.MADDEN_SCHEDULE]) {
      const updatedGames = event[MaddenEvents.MADDEN_SCHEDULE] as SnallabotEvent<MaddenGame>[]
      currentView.currentSeasonIndex = Math.max(currentView.currentSeasonIndex, Math.max(...updatedGames.map(g => g.seasonIndex)))
    }
    return currentView
  }
}

export const seasonView = new CacheableSeasonView
seasonView.listen(MaddenEvents.MADDEN_SCHEDULE)

const MaddenDB: MaddenDB = {
  async appendEvents<Event>(events: SnallabotEvent<Event>[], idFn: (event: Event) => string) {
    const BATCH_SIZE = 250
    const timestamp = new Date()
    const totalBatches = Math.ceil(events.length / BATCH_SIZE)

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIdx = batchIndex * BATCH_SIZE
      const endIdx = Math.min((batchIndex + 1) * BATCH_SIZE, events.length)
      const batchEvents = events.slice(startIdx, endIdx)

      // group by event_type: one query per type per batch, instead of the
      // Firestore version's one .get() per individual event
      const byType = Object.groupBy(batchEvents, (e) => e.event_type)
      const historyDocs: StoredHistoryDoc[] = []

      for (const [eventType, typeEvents] of Object.entries(byType)) {
        if (!typeEvents) continue
        const collection = db.collection(eventType)
        const idsInBatch = typeEvents.map((e) => ({ leagueId: e.key, id: idFn(e) }))

        const existingDocs = await collection.find({
          $or: idsInBatch.map(({ leagueId, id }) => ({ leagueId, id })),
        }).toArray()
        const existingMap = new Map(existingDocs.map(d => [`${(d as any).leagueId}-${(d as any).id}`, d]))

        const bulkOps = typeEvents.map((event) => {
          const eventId = idFn(event)
          const mapKey = `${event.key}-${eventId}`
          const existing = existingMap.get(mapKey)

          if (existing) {
            const { timestamp: _oldTimestamp, id: _id, _id: _mongoId, leagueId: _leagueId, ...oldEvent } = existing as any
            const change = createEventHistoryUpdate(event, oldEvent)
            if (Object.keys(change).length > 0) {
              historyDocs.push({
                leagueId: event.key,
                eventType,
                eventId,
                changeId: randomUUID(),
                timestamp,
                ...change,
              } as StoredHistoryDoc)
            }
          }

          return {
            updateOne: {
              filter: { leagueId: event.key, id: eventId },
              update: { $set: { ...event, leagueId: event.key, id: eventId, timestamp } },
              upsert: true,
            },
          }
        })

        await collection.bulkWrite(bulkOps, { ordered: false })
      }

      if (historyDocs.length > 0) {
        await db.collection("history").insertMany(historyDocs)
      }
    }

    await Promise.all(Object.entries(Object.groupBy(events, e => e.event_type)).map(async entry => {
      const [eventType, specificTypeEvents] = entry
      if (specificTypeEvents) {
        maddenEventsDistribution.observe({ event_type: eventType }, specificTypeEvents.length)
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
    const view = await teamView.createView(leagueId)
    if (view) {
      return createTeamList(Object.values(view))
    }
    throw new Error(`No teams were found`)
  },

  getLatestWeekSchedule: async function(leagueId: string, week: number) {
    const seasonIndex = await seasonView.createView(leagueId)
    const maxSeason = seasonIndex ? seasonIndex.currentSeasonIndex : 0
    const [gameDocs, teamList] = await Promise.all([
      db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, weekIndex: week - 1, seasonIndex: maxSeason, stageIndex: 1 }).toArray(),
      this.getLatestTeams(leagueId)
    ])
    const maddenSchedule = (gameDocs as unknown as StoredEvent<MaddenGame>[])
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
    const seasonIndex = await seasonView.createView(leagueId)
    const maxSeason = seasonIndex ? seasonIndex.currentSeasonIndex : 0
    const teamList = await this.getLatestTeams(leagueId)

    const allGames = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, seasonIndex: maxSeason, stageIndex: 1 }).toArray()
    const games = deduplicateSchedule(allGames as unknown as StoredEvent<MaddenGame>[], teamList)
    const unplayedGames = games.filter(g => g.status === GameResult.NOT_PLAYED)

    if (unplayedGames.length === 0) {
      const maxWeek = Math.max(...games.map(game => game.weekIndex));
      return deduplicateSchedule(games.filter(game => game.seasonIndex === maxSeason && game.weekIndex === maxWeek), teamList)
    }

    const currentWeek = Math.min(...unplayedGames.map(game => game.weekIndex));
    const currentWeekGames = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, seasonIndex: maxSeason, weekIndex: currentWeek, stageIndex: 1 }).toArray()

    return deduplicateSchedule(currentWeekGames as unknown as StoredEvent<MaddenGame>[], teamList)
  },

  getPlayoffSchedule: async function(leagueId: string) {
    const seasonIndex = await seasonView.createView(leagueId)
    const maxSeason = seasonIndex ? seasonIndex.currentSeasonIndex : 0
    // Firestore version issued 4 separate queries (one per playoff week);
    // Mongo can do it in one round trip with $in
    const playoffGames = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find({
      leagueId,
      seasonIndex: maxSeason,
      weekIndex: { $in: [18, 19, 20, 22] },
    }).toArray()
    const teamList = await this.getLatestTeams(leagueId)
    return deduplicateSchedule(playoffGames as unknown as StoredEvent<MaddenGame>[], teamList)
  },

  getWeekScheduleForSeason: async function(leagueId: string, week: number, season: number) {
    const [weekDocs, teamList] = await Promise.all([
      db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, weekIndex: week - 1, seasonIndex: season, stageIndex: 1 }).toArray(),
      this.getLatestTeams(leagueId)
    ])
    const maddenSchedule = deduplicateSchedule(weekDocs as unknown as StoredEvent<MaddenGame>[], teamList)
      .filter(game => game.awayTeamId != 0 && game.homeTeamId != 0)
    if (maddenSchedule.length !== 0) {
      return maddenSchedule
    }
    throw new Error(`Missing schedule for week ${week} and season ${MADDEN_SEASON + season}`)
  },

  getGameForSchedule: async function(leagueId: string, scheduleId: number, week: number, season: number) {
    const [weekDocs, teamList] = await Promise.all([
      db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, weekIndex: week - 1, seasonIndex: season, stageIndex: 1 }).toArray(),
      this.getLatestTeams(leagueId)
    ])
    return findLatestScheduleId(scheduleId, weekDocs as unknown as StoredEvent<MaddenGame>[], teamList)
  },

  getAllWeeks: async function(leagueId: string) {
    const schedules = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find(
      { leagueId, stageIndex: 1 },
      { projection: { seasonIndex: 1, weekIndex: 1 } }
    ).toArray()
    const games = schedules as unknown as { seasonIndex: number, weekIndex: number }[]
    const distinctWeekSeason = Object.entries(Object.groupBy(games, g => `${g.seasonIndex}_${g.weekIndex}`)).flatMap(e => {
      const [_, gamesInWeek] = e
      return gamesInWeek ? [gamesInWeek[0]] : []
    })
    return distinctWeekSeason
  },

  getStandingForTeam: async function(leagueId: string, teamId: number) {
    const teamList = await this.getLatestTeams(leagueId)
    const latestTeamId = teamList.getTeamForId(teamId).teamId
    const standing = await db.collection(MaddenEvents.MADDEN_STANDING).findOne({ leagueId, id: `${latestTeamId}` })
    if (!standing) {
      throw new Error("standing not found for id " + teamId)
    }
    return standing as unknown as Standing
  },

  getLatestStandings: async function(leagueId: string) {
    const [standingDocs, teamList] = await Promise.all([
      db.collection(MaddenEvents.MADDEN_STANDING).find({ leagueId }).toArray(),
      this.getLatestTeams(leagueId)
    ])
    const latestTeams = new Set(teamList.getLatestTeams().map(t => t.teamId))
    return (standingDocs as unknown as Standing[]).filter(s => latestTeams.has(s.teamId))
  },

  getLatestPlayers: async function(leagueId: string) {
    const [view, teams] = await Promise.all([playerListIndex.createView(leagueId), this.getLatestTeams(leagueId)])
    if (view) {
      return Object.values(view).map(p => {
        const teamId = Number(p.teamId)
        const latestTeamId = teamId === 0 ? 0 : teams.getTeamForId(teamId).teamId
        return { ...p, teamId: `${latestTeamId}` }
      })
    }
    return []
  },

  getPlayer: async function(leagueId: string, rosterId: string) {
    const playerDoc = await db.collection(MaddenEvents.MADDEN_PLAYER).findOne({ leagueId, id: rosterId })
    if (playerDoc) {
      const foundPlayer = playerDoc as unknown as Player
      const potentiallyDuplicatePlayers = await db.collection(MaddenEvents.MADDEN_PLAYER).find({
        leagueId,
        presentationId: foundPlayer.presentationId,
        birthYear: foundPlayer.birthYear,
        birthMonth: foundPlayer.birthMonth,
        birthDay: foundPlayer.birthDay,
      }).toArray()
      return (potentiallyDuplicatePlayers as unknown as StoredEvent<Player>[]).reduce((latest, current) =>
        current.timestamp > latest.timestamp ? current : latest
      )
    }
    throw new Error(`Player ${rosterId} not found in league ${leagueId}`)
  },

  getPlayerStats: async function(leagueId: string, player: Player): Promise<PlayerStats> {
    const potentiallyDuplicatePlayers = await db.collection(MaddenEvents.MADDEN_PLAYER).find({
      leagueId,
      presentationId: player.presentationId,
      birthYear: player.birthYear,
      birthMonth: player.birthMonth,
      birthDay: player.birthDay,
    }).toArray()
    const rosterIds = (potentiallyDuplicatePlayers as unknown as Player[]).map(p => p.rosterId)

    switch (player.position) {
      case "QB": {
        const [passingStats, rushingStats] = await Promise.all([
          getStats<PassingStats>(leagueId, rosterIds, MaddenEvents.MADDEN_PASSING_STAT),
          getStats<RushingStats>(leagueId, rosterIds, MaddenEvents.MADDEN_RUSHING_STAT)
        ])
        return {
          [PlayerStatType.PASSING]: passingStats,
          [PlayerStatType.RUSHING]: rushingStats,
        }
      }
      case "HB":
      case "FB":
      case "WR":
      case "TE": {
        const [rushing, receivingStats] = await Promise.all([
          getStats<RushingStats>(leagueId, rosterIds, MaddenEvents.MADDEN_RUSHING_STAT),
          getStats<ReceivingStats>(leagueId, rosterIds, MaddenEvents.MADDEN_RECEIVING_STAT)
        ])
        return {
          [PlayerStatType.RUSHING]: rushing,
          [PlayerStatType.RECEIVING]: receivingStats
        }
      }
      case "K": {
        const kickingStats = await getStats<KickingStats>(leagueId, rosterIds, MaddenEvents.MADDEN_KICKING_STAT)
        return { [PlayerStatType.KICKING]: kickingStats }
      }
      case "P": {
        const puntingStats = await getStats<PuntingStats>(leagueId, rosterIds, MaddenEvents.MADDEN_PUNTING_STAT)
        return { [PlayerStatType.PUNTING]: puntingStats }
      }
      case "LEDG":
      case "REDG":
      case "DT":
      case "SAM":
      case "MIKE":
      case "WILL":
      case "CB":
      case "FS":
      case "SS": {
        const defenseStats = await getStats<DefensiveStats>(leagueId, rosterIds, MaddenEvents.MADDEN_DEFENSIVE_STAT)
        return { [PlayerStatType.DEFENSE]: defenseStats }
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
    const retiredPlayerEvents = await EventDB.queryEvents<RetiredPlayersEvent>(leagueId, EventTypes.RETIRED_PLAYERS, new Date(0), {}, 1000000)
    const retiredPlayers = new Set(retiredPlayerEvents.flatMap(e => e.retiredPlayers).map(e => createPlayerKey(e)))
    const teams = await this.getLatestTeams(leagueId)

    let players = playerIndex ? Object.values(playerIndex).map(p => {
      const teamId = Number(p.teamId)
      const latestTeam = teamId === 0 ? 0 : teams.getTeamForId(teamId).teamId
      return { ...p, isRetired: retiredPlayers.has(createPlayerKey(p)), teamId: `${latestTeam}` }
    }) : []

    if ((query.teamId && query.teamId !== -1) || query.teamId === 0) {
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

    if (query.retired) {
      players = players.filter(p => p.isRetired)
    } else {
      players = players.filter(p => !p.isRetired)
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
      resultPlayers = cursorIndex !== -1
        ? players.slice(cursorIndex + 1, Math.min(cursorIndex + 1 + limit, players.length))
        : players.slice(0, limit);
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

    const fullPlayers = await Promise.all(
      resultPlayers.map(p => this.getPlayer(leagueId, p.rosterId))
    );
    return fullPlayers;
  },

  // Firestore stored exportStatus as a field merged onto the league's own
  // doc. Mongo equivalent: a flat "leagues" collection, one doc per league,
  // _id set to leagueId, updated via dot-notation $set + upsert.
  updateLeagueExportStatus: async function(leagueId: string, eventType: MaddenEvents) {
    await db.collection("leagues").updateOne(
      { _id: leagueId as any },
      { $set: { [`exportStatus.${eventType}.lastExported`]: new Date() } },
      { upsert: true }
    )
  },

  updateWeeklyExportStatus: async function(leagueId: string, eventType: MaddenEvents, weekIndex: number, season: number) {
    const weekKey = `season${String(season).padStart(2, '0')}_week${String(weekIndex).padStart(2, '0')}`
    await db.collection("leagues").updateOne(
      { _id: leagueId as any },
      { $set: { [`exportStatus.weeklyStatus.${weekKey}.${eventType}.lastExported`]: new Date() } },
      { upsert: true }
    )
  },

  updateRosterExportStatus: async function(leagueId: string, eventType: MaddenEvents.MADDEN_PLAYER, teamId: string) {
    await db.collection("leagues").updateOne(
      { _id: leagueId as any },
      { $set: { [`exportStatus.rosterStatus.${teamId}.${eventType}.lastExported`]: new Date() } },
      { upsert: true }
    )
  },

  // NOTE: original Firestore code filtered on `.where("week", ...)`, but
  // TeamStats only has a `weekIndex` field — that looks like a pre-existing
  // bug that likely made this query always return nothing. Corrected to
  // `weekIndex` here; flag if this was intentionally something else.
  getTeamStatsForGame: async function(leagueId: string, teamId: string, week: number, seasonIndex: number) {
    const teamStats = await db.collection(MaddenEvents.MADDEN_TEAM_STAT).findOne({
      leagueId, weekIndex: week - 1, seasonIndex, teamId,
    })
    if (teamStats) {
      return teamStats as unknown as TeamStats
    }
    throw new Error(`Missing Team Stats for ${MADDEN_SEASON + seasonIndex} Week ${week} for ${teamId}. Try exporting this week again`)
  },

  getExportStatus: async function(leagueId: string) {
    const doc = await db.collection("leagues").findOne({ _id: leagueId as any })
    if (doc) {
      return (doc as unknown as LeagueDoc).exportStatus
    }
    return undefined
  },

  getStatsForGame: async function(leagueId: string, season: number, week: number, scheduleId: number) {
    const weekIndex = week - 1;
    const filter = { leagueId, seasonIndex: season, weekIndex, scheduleId }
    const [
      teamStatsDocs,
      defensiveStatsDocs,
      kickingStatsDocs,
      puntingStatsDocs,
      receivingStatsDocs,
      rushingStatsDocs,
      passingStatsDocs
    ] = await Promise.all([
      db.collection(MaddenEvents.MADDEN_TEAM_STAT).find(filter).toArray(),
      db.collection(MaddenEvents.MADDEN_DEFENSIVE_STAT).find(filter).toArray(),
      db.collection(MaddenEvents.MADDEN_KICKING_STAT).find(filter).toArray(),
      db.collection(MaddenEvents.MADDEN_PUNTING_STAT).find(filter).toArray(),
      db.collection(MaddenEvents.MADDEN_RECEIVING_STAT).find(filter).toArray(),
      db.collection(MaddenEvents.MADDEN_RUSHING_STAT).find(filter).toArray(),
      db.collection(MaddenEvents.MADDEN_PASSING_STAT).find(filter).toArray(),
    ]);

    const gameStats: GameStats = {
      teamStats: teamStatsDocs as unknown as TeamStats[],
      playerStats: {}
    };

    if (defensiveStatsDocs.length > 0) gameStats.playerStats[PlayerStatType.DEFENSE] = defensiveStatsDocs as unknown as DefensiveStats[];
    if (kickingStatsDocs.length > 0) gameStats.playerStats[PlayerStatType.KICKING] = kickingStatsDocs as unknown as KickingStats[];
    if (puntingStatsDocs.length > 0) gameStats.playerStats[PlayerStatType.PUNTING] = puntingStatsDocs as unknown as PuntingStats[];
    if (receivingStatsDocs.length > 0) gameStats.playerStats[PlayerStatType.RECEIVING] = receivingStatsDocs as unknown as ReceivingStats[];
    if (rushingStatsDocs.length > 0) gameStats.playerStats[PlayerStatType.RUSHING] = rushingStatsDocs as unknown as RushingStats[];
    if (passingStatsDocs.length > 0) gameStats.playerStats[PlayerStatType.PASSING] = passingStatsDocs as unknown as PassingStats[];

    return gameStats;
  },

  getTeamSchedule: async function(leagueId: string, season?: number) {
    const teams = await this.getLatestTeams(leagueId)

    if (season !== undefined) {
      const seasonGames = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, stageIndex: 1, seasonIndex: season }).toArray()
      return deduplicateSchedule(seasonGames as unknown as StoredEvent<MaddenGame>[], teams).sort((a, b) => a.weekIndex - b.weekIndex)
    } else {
      const allGames = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, stageIndex: 1 }).toArray()
      if (allGames.length === 0) {
        return [];
      }
      const games = allGames as unknown as StoredEvent<MaddenGame>[]
      const latestSeason = Math.max(...games.map(game => game.seasonIndex));
      return deduplicateSchedule(games.filter(game => game.seasonIndex === latestSeason), teams).sort((a, b) => a.weekIndex - b.weekIndex)
    }
  },

  getStatsForWeek: async function <T extends PlayerStatTypes>(leagueId: string, statType: PlayerStatEvents, week?: number, season?: number): Promise<{ seasonIndex: number, weekIndex: number, stats: T[] }> {
    const seasonIndex = await seasonView.createView(leagueId)
    const seasonToQuery = season ? season : seasonIndex ? seasonIndex.currentSeasonIndex : 0
    let weekToQuery: number;
    if (week) {
      weekToQuery = week - 1
    } else {
      const teamList = await this.getLatestTeams(leagueId)
      const allGames = await db.collection(MaddenEvents.MADDEN_SCHEDULE).find({ leagueId, seasonIndex: seasonToQuery, stageIndex: 1 }).toArray()
      const games = deduplicateSchedule(allGames as unknown as StoredEvent<MaddenGame>[], teamList)
      const playedGames = games.filter(g => g.status !== GameResult.NOT_PLAYED)
      weekToQuery = playedGames.length === 0 ? 0 : Math.max(...playedGames.map(game => game.weekIndex));
    }
    const statDocs = await db.collection(statType).find({ leagueId, seasonIndex: seasonToQuery, weekIndex: weekToQuery, stageIndex: 1 }).toArray()
    const finalStats = await deduplicatePlayerStats(leagueId, statDocs as unknown as StoredEvent<T>[])
    return { seasonIndex: seasonToQuery, weekIndex: weekToQuery, stats: finalStats }
  },

  getStatsForSeason: async function <T extends PlayerStatTypes>(leagueId: string, statType: PlayerStatEvents, season?: number): Promise<T[]> {
    const seasonIndex = await seasonView.createView(leagueId)
    const seasonToQuery = season ? season : seasonIndex ? seasonIndex.currentSeasonIndex : 0
    const statDocs = await db.collection(statType).find({ leagueId, seasonIndex: seasonToQuery, stageIndex: 1 }).toArray()
    return await deduplicatePlayerStats(leagueId, statDocs as unknown as StoredEvent<T>[])
  }
}

function withMetrics<T extends object>(db: T): T {
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

export default withMetrics(MaddenDB)
