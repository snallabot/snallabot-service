import pool from "./postgres"
import { PoolClient } from "pg"
import EventDB, { EventNotifier, SnallabotEvent, StoredEvent, notifiers } from "./events_db"
import {
  DefensiveStats, GameResult, KickingStats, MADDEN_SEASON, MaddenGame, POSITION_GROUP, PassingStats, Player,
  PuntingStats, ReceivingStats, RushingStats, Standing, Team, TeamStats, dLinePositions, dbPositions, oLinePositions,
} from "../export/madden_league_types"
import { CachedUpdatingView, StorageBackedCachedView, View } from "./view"
import { EventTypes, RetiredPlayersEvent } from "./events"
import { maddenEventsDistribution } from "../debug/metrics"
import {
  PlayerStatType, PlayerStats, GameStats, MaddenEvents, PlayerStatEvents, PlayerStatTypes,
  PlayerListQuery, SeasonWeek, SmallPlayerIndex, PlayerListIndex, MaddenDB as MaddenDBInterface, TeamList,
  createTeamList, deduplicateSchedule, findLatestScheduleId, createPlayerKey, withMetrics,
} from "./madden_shared"
import { updateLeagueExportStatus, updateWeeklyExportStatus, updateRosterExportStatus, getExportStatus } from "./madden_export_status"
import {
  ColumnMapping, TEAM_COLUMNS, STANDING_COLUMNS, SCHEDULE_COLUMNS, PUNTING_STAT_COLUMNS, TEAM_STAT_COLUMNS,
  PASSING_STAT_COLUMNS, KICKING_STAT_COLUMNS, RUSHING_STAT_COLUMNS, DEFENSIVE_STAT_COLUMNS, RECEIVING_STAT_COLUMNS,
  PLAYER_COLUMNS, PLAYER_JSON_COLUMNS,
} from "./madden_postgres_columns"

type MaddenDB = MaddenDBInterface

// =====================================================================
// Write path
// =====================================================================

type Spec = { column: string, pgType: string, getValue: (e: any) => any }[]

function specFromColumns(mappings: ColumnMapping[]): Spec {
  return mappings.map(m => ({
    column: m.column,
    pgType: m.pgType,
    getValue: (e: any) => e[m.field] ?? null,
  }))
}

function jsonSpecFromColumns(mappings: ColumnMapping[]): Spec {
  return mappings.map(m => ({
    column: m.column,
    pgType: m.pgType,
    getValue: (e: any) => (e[m.field] != null ? JSON.stringify(e[m.field]) : null),
  }))
}

async function bulkUpsert(client: PoolClient, table: string, conflictCols: string[], spec: Spec, events: any[]) {
  if (events.length === 0) return
  const columns = spec.map(s => s.column)
  const updateCols = columns.filter(c => !conflictCols.includes(c))
  const updateSet = updateCols.map(c => `${c} = EXCLUDED.${c}`).concat("updated_at = now()").join(", ")
  const unnestArgs = spec.map((s, i) => `$${i + 1}::${s.pgType}`).join(", ")
  const params = spec.map(s => events.map(e => s.getValue(e)))
  const query = `
    INSERT INTO ${table} (${columns.join(", ")})
    SELECT * FROM unnest(${unnestArgs}) AS v(${columns.join(", ")})
    ON CONFLICT (${conflictCols.join(", ")}) DO UPDATE SET ${updateSet}
  `
  await client.query(query, params)
}

type TableSpec = { table: string, conflictCols: string[], spec: Spec }

function statTableSpec(table: string, columns: ColumnMapping[]): TableSpec {
  return {
    table,
    conflictCols: ["league_id", "season_index", "week_index", "stat_id"],
    spec: [
      { column: "league_id", pgType: "text[]", getValue: (e: any) => e.key },
      { column: "season_index", pgType: "smallint[]", getValue: (e: any) => e.seasonIndex },
      { column: "week_index", pgType: "smallint[]", getValue: (e: any) => e.weekIndex },
      { column: "stat_id", pgType: "integer[]", getValue: (e: any) => e.statId },
      { column: "platform", pgType: "text[]", getValue: (e: any) => e.platform ?? null },
      ...specFromColumns(columns),
    ],
  }
}

function plainTableSpec(eventType: string): TableSpec {
  switch (eventType) {
    case MaddenEvents.MADDEN_TEAM:
      return {
        table: "madden_teams",
        conflictCols: ["league_id", "team_id"],
        spec: [
          { column: "league_id", pgType: "text[]", getValue: (e: any) => e.key },
          { column: "team_id", pgType: "integer[]", getValue: (e: any) => e.teamId },
          { column: "platform", pgType: "text[]", getValue: (e: any) => e.platform ?? null },
          ...specFromColumns(TEAM_COLUMNS),
        ],
      }
    case MaddenEvents.MADDEN_STANDING:
      return {
        table: "madden_standings",
        conflictCols: ["league_id", "team_id"],
        spec: [
          { column: "league_id", pgType: "text[]", getValue: (e: any) => e.key },
          { column: "team_id", pgType: "integer[]", getValue: (e: any) => e.teamId },
          { column: "platform", pgType: "text[]", getValue: (e: any) => e.platform ?? null },
          ...specFromColumns(STANDING_COLUMNS),
        ],
      }
    case MaddenEvents.MADDEN_SCHEDULE:
      return {
        table: "madden_schedules",
        conflictCols: ["league_id", "season_index", "week_index", "schedule_id"],
        spec: [
          { column: "league_id", pgType: "text[]", getValue: (e: any) => e.key },
          { column: "season_index", pgType: "smallint[]", getValue: (e: any) => e.seasonIndex },
          { column: "week_index", pgType: "smallint[]", getValue: (e: any) => e.weekIndex },
          { column: "schedule_id", pgType: "integer[]", getValue: (e: any) => e.scheduleId },
          { column: "platform", pgType: "text[]", getValue: (e: any) => e.platform ?? null },
          ...specFromColumns(SCHEDULE_COLUMNS),
        ],
      }
    case MaddenEvents.MADDEN_PUNTING_STAT:
      return statTableSpec("madden_punting_stats", PUNTING_STAT_COLUMNS)
    case MaddenEvents.MADDEN_TEAM_STAT:
      return statTableSpec("madden_team_stats", TEAM_STAT_COLUMNS)
    case MaddenEvents.MADDEN_PASSING_STAT:
      return statTableSpec("madden_passing_stats", PASSING_STAT_COLUMNS)
    case MaddenEvents.MADDEN_KICKING_STAT:
      return statTableSpec("madden_kicking_stats", KICKING_STAT_COLUMNS)
    case MaddenEvents.MADDEN_RUSHING_STAT:
      return statTableSpec("madden_rushing_stats", RUSHING_STAT_COLUMNS)
    case MaddenEvents.MADDEN_DEFENSIVE_STAT:
      return statTableSpec("madden_defensive_stats", DEFENSIVE_STAT_COLUMNS)
    case MaddenEvents.MADDEN_RECEIVING_STAT:
      return statTableSpec("madden_receiving_stats", RECEIVING_STAT_COLUMNS)
    default:
      throw new Error(`${eventType} is not a plain-table event type`)
  }
}

async function upsertPlayers(client: PoolClient, events: any[]) {
  if (events.length === 0) return

  // 1. roster_id -> stable identity, so historical stat rows can resolve after a title update
  const identitySpec: Spec = [
    { column: "league_id", pgType: "text[]", getValue: (e: any) => e.key },
    { column: "roster_id", pgType: "integer[]", getValue: (e: any) => e.rosterId },
    { column: "presentation_id", pgType: "integer[]", getValue: (e: any) => e.presentationId },
    { column: "birth_year", pgType: "smallint[]", getValue: (e: any) => e.birthYear },
    { column: "birth_month", pgType: "smallint[]", getValue: (e: any) => e.birthMonth },
    { column: "birth_day", pgType: "smallint[]", getValue: (e: any) => e.birthDay },
  ]
  await bulkUpsert(client, "player_identity_map", ["league_id", "roster_id"], identitySpec, events)

  // 2. madden_players itself, keyed by identity - a title update's new roster_id updates
  // the existing row in place instead of creating a duplicate.
  const playerSpec: Spec = [
    { column: "league_id", pgType: "text[]", getValue: (e: any) => e.key },
    { column: "presentation_id", pgType: "integer[]", getValue: (e: any) => e.presentationId },
    { column: "birth_year", pgType: "smallint[]", getValue: (e: any) => e.birthYear },
    { column: "birth_month", pgType: "smallint[]", getValue: (e: any) => e.birthMonth },
    { column: "birth_day", pgType: "smallint[]", getValue: (e: any) => e.birthDay },
    { column: "platform", pgType: "text[]", getValue: (e: any) => e.platform ?? null },
    ...specFromColumns(PLAYER_COLUMNS),
    ...jsonSpecFromColumns(PLAYER_JSON_COLUMNS),
  ]
  await bulkUpsert(
    client, "madden_players",
    ["league_id", "presentation_id", "birth_year", "birth_month", "birth_day"],
    playerSpec, events
  )
}

async function appendEvents<Event>(events: SnallabotEvent<Event>[], idFn: (event: Event) => string): Promise<void> {
  const BATCH_SIZE = 250
  const byType = Object.groupBy(events, (e: any) => e.event_type)

  for (const [eventType, typeEvents] of Object.entries(byType)) {
    if (!typeEvents || typeEvents.length === 0) continue
    const totalBatches = Math.ceil(typeEvents.length / BATCH_SIZE)
    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIdx = batchIndex * BATCH_SIZE
      const endIdx = Math.min((batchIndex + 1) * BATCH_SIZE, typeEvents.length)
      const batch = typeEvents.slice(startIdx, endIdx)

      let retryCount = 0
      while (retryCount < 5) {
        const client = await pool.connect()
        try {
          await client.query("BEGIN")
          if (eventType === MaddenEvents.MADDEN_PLAYER) {
            await upsertPlayers(client, batch)
          } else {
            const { table, conflictCols, spec } = plainTableSpec(eventType)
            await bulkUpsert(client, table, conflictCols, spec, batch)
          }
          await client.query("COMMIT")
          break
        } catch (e) {
          await client.query("ROLLBACK")
          retryCount = retryCount + 1
          if (retryCount >= 5) throw e
          await new Promise(r => setTimeout(r, 1000))
          console.log("errored, slept and retrying, " + e)
        } finally {
          client.release()
        }
      }
    }
  }

  // notifier dispatch over the whole input, matching madden_db.ts's appendEvents exactly -
  // this is what drives teamView/seasonView/playerListIndex and external listeners like
  // discord/routes.ts's MADDEN_SCHEDULE subscription.
  await Promise.all(Object.entries(Object.groupBy(events, (e: any) => e.event_type)).map(async entry => {
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
}

// =====================================================================
// Row -> domain object mapping (reverse of the write-path column specs)
// =====================================================================

function mapRow<T>(row: any, columns: ColumnMapping[], extra: Record<string, string> = {}): T {
  const result: any = {}
  for (const [col, field] of Object.entries(extra)) {
    result[field] = row[col]
  }
  for (const m of columns) {
    result[m.field] = row[m.column]
  }
  return result as T
}

function mapTeamRow(row: any): StoredEvent<Team> {
  return { ...mapRow<Team>(row, TEAM_COLUMNS, { team_id: "teamId" }), timestamp: row.updated_at, id: `${row.team_id}`, key: row.league_id, event_type: MaddenEvents.MADDEN_TEAM }
}

function mapStandingRow(row: any): Standing {
  return mapRow<Standing>(row, STANDING_COLUMNS, { team_id: "teamId" })
}

function mapScheduleRow(row: any): StoredEvent<MaddenGame> {
  return {
    ...mapRow<MaddenGame>(row, SCHEDULE_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex", schedule_id: "scheduleId" }),
    timestamp: row.updated_at, id: `${row.schedule_id}`, key: row.league_id, event_type: MaddenEvents.MADDEN_SCHEDULE,
  }
}

function mapPlayerRow(row: any): Player {
  const player = mapRow<Player>(row, PLAYER_COLUMNS, {
    roster_id: "rosterId", team_id: "teamId",
    presentation_id: "presentationId", birth_year: "birthYear", birth_month: "birthMonth", birth_day: "birthDay",
  })
  return { ...player, signatureSlotList: row.signature_abilities ?? [] } as Player
}

function mapStatRow<T>(row: any, columns: ColumnMapping[]): StoredEvent<T> {
  return {
    ...mapRow<T>(row, columns, { season_index: "seasonIndex", week_index: "weekIndex", stat_id: "statId", roster_id: "rosterId", team_id: "teamId" }),
    timestamp: row.updated_at, id: `${row.stat_id}`, key: row.league_id, event_type: "" as any,
  }
}

const STAT_TABLE_INFO: Record<PlayerStatEvents, { table: string, columns: ColumnMapping[] }> = {
  [MaddenEvents.MADDEN_PASSING_STAT]: { table: "madden_passing_stats", columns: PASSING_STAT_COLUMNS },
  [MaddenEvents.MADDEN_RUSHING_STAT]: { table: "madden_rushing_stats", columns: RUSHING_STAT_COLUMNS },
  [MaddenEvents.MADDEN_DEFENSIVE_STAT]: { table: "madden_defensive_stats", columns: DEFENSIVE_STAT_COLUMNS },
  [MaddenEvents.MADDEN_KICKING_STAT]: { table: "madden_kicking_stats", columns: KICKING_STAT_COLUMNS },
  [MaddenEvents.MADDEN_RECEIVING_STAT]: { table: "madden_receiving_stats", columns: RECEIVING_STAT_COLUMNS },
  [MaddenEvents.MADDEN_PUNTING_STAT]: { table: "madden_punting_stats", columns: PUNTING_STAT_COLUMNS },
}

// =====================================================================
// Views (only the raw createView() bodies are Postgres-specific - the
// CachedUpdatingView/StorageBackedCachedView decorator layer, and the
// notifier-driven .listen()/update() plumbing, are storage-agnostic and
// unchanged from madden_db.ts)
// =====================================================================

class PlayerListView extends View<PlayerListIndex> {
  constructor() {
    super("player_list")
  }

  async createView(key: string) {
    const { rows } = await pool.query(
      `SELECT presentation_id, birth_year, birth_month, birth_day, roster_id, first_name, last_name,
              team_id, position, years_pro, player_best_ovr
       FROM madden_players WHERE league_id = $1`,
      [key]
    )
    // madden_players is already exactly one row per identity by construction - unlike
    // Firestore, no deduplicatePlayers() pass is needed here.
    return Object.fromEntries(rows.map(row => {
      const smallPlayer: SmallPlayerIndex = {
        rosterId: `${row.roster_id}`,
        firstName: row.first_name,
        lastName: row.last_name,
        teamId: `${row.team_id}`,
        yearsPro: row.years_pro,
        playerBestOvr: row.player_best_ovr,
        position: row.position,
        birthYear: row.birth_year,
        birthMonth: row.birth_month,
        birthDay: row.birth_day,
        presentationId: row.presentation_id,
      }
      return [`${row.presentation_id}-${row.birth_year}-${row.birth_month}-${row.birth_day}`, smallPlayer]
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
          presentationId: player.presentationId,
        }
      })
    }
    return currentView
  }
}

const playerListIndex = new CacheablePlayerListView()
playerListIndex.listen(MaddenEvents.MADDEN_PLAYER)

type TeamIndex = {
  [key: string]: StoredEvent<Team>
}

class TeamView extends View<TeamIndex> {
  constructor() {
    super("team_view")
  }
  async createView(key: string) {
    const { rows } = await pool.query(`SELECT * FROM madden_teams WHERE league_id = $1`, [key])
    const teams = rows.map(mapTeamRow)
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
    super("season_view")
  }
  async createView(key: string) {
    const [{ rows }, teamList] = await Promise.all([
      pool.query(`SELECT * FROM madden_schedules WHERE league_id = $1 AND stage_index = 1`, [key]),
      MaddenPostgresDB.getLatestTeams(key),
    ])
    const games = deduplicateSchedule(rows.map(mapScheduleRow), teamList)
    if (games.length === 0) {
      return { currentSeasonIndex: 0 }
    }
    const maxSeason = Math.max(...games.map(game => game.seasonIndex))
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

const seasonView = new CacheableSeasonView
seasonView.listen(MaddenEvents.MADDEN_SCHEDULE)

// =====================================================================
// Read path helpers shared across multiple interface methods
// =====================================================================

async function queryStatsForLeague<T>(
  table: string, columns: ColumnMapping[], leagueId: string, seasonIndex: number, weekIndex?: number
): Promise<StoredEvent<T>[]> {
  // Dedup handles EA emitting two different stat_ids for the same player/week (duplicate
  // or retried exports) - the PK (league_id, season_index, week_index, stat_id) doesn't
  // prevent that. Orphaned rows (no player_identity_map match) must never collapse into
  // each other, hence the 'orphan:' fallback key covering every such row individually.
  const dedupKey = weekIndex !== undefined
    ? `COALESCE(m.presentation_id::text || '-' || m.birth_year || '-' || m.birth_month || '-' || m.birth_day, 'orphan:' || s.stat_id)`
    : `COALESCE(m.presentation_id::text || '-' || m.birth_year || '-' || m.birth_month || '-' || m.birth_day || '-' || s.week_index, 'orphan:' || s.stat_id)`
  const params: any[] = [leagueId, seasonIndex]
  let weekFilter = ""
  if (weekIndex !== undefined) {
    weekFilter = "AND s.week_index = $3"
    params.push(weekIndex)
  }
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT s.*, ${dedupKey} AS dedup_key
       FROM ${table} s
       LEFT JOIN player_identity_map m ON m.league_id = s.league_id AND m.roster_id = s.roster_id
       WHERE s.league_id = $1 AND s.season_index = $2 ${weekFilter} AND s.stage_index = 1
     ) x ORDER BY dedup_key, updated_at DESC`,
    params
  )
  const seen = new Set<string>()
  const deduped: any[] = []
  for (const row of rows) {
    if (seen.has(row.dedup_key)) continue
    seen.add(row.dedup_key)
    deduped.push(row)
  }
  return deduped.map(row => mapStatRow<T>(row, columns))
}

async function getPlayerStatsForType<T>(
  leagueId: string, player: { presentationId: number, birthYear: number, birthMonth: number, birthDay: number },
  table: string, columns: ColumnMapping[]
): Promise<StoredEvent<T>[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (s.season_index, s.week_index) s.*
     FROM ${table} s
     JOIN player_identity_map m ON m.league_id = s.league_id AND m.roster_id = s.roster_id
     WHERE s.league_id = $1 AND m.presentation_id = $2 AND m.birth_year = $3 AND m.birth_month = $4 AND m.birth_day = $5
       AND s.stage_index > 0
     ORDER BY s.season_index, s.week_index, s.updated_at DESC`,
    [leagueId, player.presentationId, player.birthYear, player.birthMonth, player.birthDay]
  )
  return rows.map(row => mapStatRow<T>(row, columns))
}

// =====================================================================
// MaddenDB implementation
// =====================================================================

const MaddenPostgresDB: MaddenDB = {
  appendEvents,
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
    const [{ rows }, teamList] = await Promise.all([
      pool.query(
        `SELECT * FROM madden_schedules WHERE league_id = $1 AND week_index = $2 AND season_index = $3 AND stage_index = 1`,
        [leagueId, week - 1, maxSeason]
      ),
      this.getLatestTeams(leagueId),
    ])
    const maddenSchedule = rows.map(mapScheduleRow).filter(game => game.awayTeamId != 0 && game.homeTeamId != 0)
    if (maddenSchedule.length === 0) {
      throw new Error("Missing schedule for week " + week)
    }
    const bySeason = Object.groupBy(maddenSchedule, s => s.seasonIndex)
    const latestSeason = Math.max(...Object.keys(bySeason).map(i => Number(i)))
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

    const { rows: allRows } = await pool.query(
      `SELECT * FROM madden_schedules WHERE league_id = $1 AND season_index = $2 AND stage_index = 1`,
      [leagueId, maxSeason]
    )
    const games = deduplicateSchedule(allRows.map(mapScheduleRow), teamList)
    const unplayedGames = games.filter(g => g.status === GameResult.NOT_PLAYED)

    if (unplayedGames.length === 0) {
      const maxWeek = Math.max(...games.map(game => game.weekIndex))
      return deduplicateSchedule(games.filter(game => game.seasonIndex === maxSeason && game.weekIndex === maxWeek), teamList)
    }

    const currentWeek = Math.min(...unplayedGames.map(game => game.weekIndex))
    const { rows: currentWeekRows } = await pool.query(
      `SELECT * FROM madden_schedules WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND stage_index = 1`,
      [leagueId, maxSeason, currentWeek]
    )
    return deduplicateSchedule(currentWeekRows.map(mapScheduleRow), teamList)
  },
  getPlayoffSchedule: async function(leagueId: string) {
    const seasonIndex = await seasonView.createView(leagueId)
    const maxSeason = seasonIndex ? seasonIndex.currentSeasonIndex : 0
    const [{ rows }, teamList] = await Promise.all([
      pool.query(
        `SELECT * FROM madden_schedules WHERE league_id = $1 AND season_index = $2 AND week_index IN (18, 19, 20, 22)`,
        [leagueId, maxSeason]
      ),
      this.getLatestTeams(leagueId),
    ])
    return deduplicateSchedule(rows.map(mapScheduleRow), teamList)
  },
  getWeekScheduleForSeason: async function(leagueId: string, week: number, season: number) {
    const [{ rows }, teamList] = await Promise.all([
      pool.query(
        `SELECT * FROM madden_schedules WHERE league_id = $1 AND week_index = $2 AND season_index = $3 AND stage_index = 1`,
        [leagueId, week - 1, season]
      ),
      this.getLatestTeams(leagueId),
    ])
    const maddenSchedule = deduplicateSchedule(rows.map(mapScheduleRow), teamList)
      .filter(game => game.awayTeamId != 0 && game.homeTeamId != 0)
    if (maddenSchedule.length !== 0) {
      return maddenSchedule
    }
    throw new Error(`Missing schedule for week ${week} and season ${MADDEN_SEASON + season}`)
  },
  getGameForSchedule: async function(leagueId: string, scheduleId: number, week: number, season: number) {
    const [{ rows }, teamList] = await Promise.all([
      pool.query(
        `SELECT * FROM madden_schedules WHERE league_id = $1 AND week_index = $2 AND season_index = $3 AND stage_index = 1`,
        [leagueId, week - 1, season]
      ),
      this.getLatestTeams(leagueId),
    ])
    return findLatestScheduleId(scheduleId, rows.map(mapScheduleRow), teamList)
  },
  getAllWeeks: async function(leagueId: string) {
    const { rows } = await pool.query(
      `SELECT DISTINCT season_index AS "seasonIndex", week_index AS "weekIndex" FROM madden_schedules WHERE league_id = $1 AND stage_index = 1`,
      [leagueId]
    )
    return rows as SeasonWeek[]
  },
  getStandingForTeam: async function(leagueId: string, teamId: number) {
    const teamList = await this.getLatestTeams(leagueId)
    const resolvedTeamId = teamList.getTeamForId(teamId).teamId
    const { rows } = await pool.query(
      `SELECT * FROM madden_standings WHERE league_id = $1 AND team_id = $2`,
      [leagueId, resolvedTeamId]
    )
    if (rows.length === 0) {
      throw new Error("standing not found for id " + teamId)
    }
    return mapStandingRow(rows[0])
  },
  getLatestStandings: async function(leagueId: string) {
    const [{ rows }, teamList] = await Promise.all([
      pool.query(`SELECT * FROM madden_standings WHERE league_id = $1`, [leagueId]),
      this.getLatestTeams(leagueId),
    ])
    const latestTeams = new Set(teamList.getLatestTeams().map(t => t.teamId))
    return rows.map(mapStandingRow).filter((s: Standing) => latestTeams.has(s.teamId))
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
    const { rows } = await pool.query(
      `SELECT * FROM madden_players WHERE league_id = $1 AND roster_id = $2`,
      [leagueId, Number(rosterId)]
    )
    if (rows.length === 0) {
      throw new Error(`Player ${rosterId} not found in league ${leagueId}`)
    }
    return mapPlayerRow(rows[0])
  },
  getPlayerStats: async function(leagueId: string, player: Player): Promise<PlayerStats> {
    switch (player.position) {
      case "QB": {
        const [passingStats, rushingStats] = await Promise.all([
          getPlayerStatsForType<PassingStats>(leagueId, player, "madden_passing_stats", PASSING_STAT_COLUMNS),
          getPlayerStatsForType<RushingStats>(leagueId, player, "madden_rushing_stats", RUSHING_STAT_COLUMNS),
        ])
        return { [PlayerStatType.PASSING]: passingStats, [PlayerStatType.RUSHING]: rushingStats }
      }
      case "HB":
      case "FB":
      case "WR":
      case "TE": {
        const [rushing, receivingStats] = await Promise.all([
          getPlayerStatsForType<RushingStats>(leagueId, player, "madden_rushing_stats", RUSHING_STAT_COLUMNS),
          getPlayerStatsForType<ReceivingStats>(leagueId, player, "madden_receiving_stats", RECEIVING_STAT_COLUMNS),
        ])
        return { [PlayerStatType.RUSHING]: rushing, [PlayerStatType.RECEIVING]: receivingStats }
      }
      case "K": {
        const kickingStats = await getPlayerStatsForType<KickingStats>(leagueId, player, "madden_kicking_stats", KICKING_STAT_COLUMNS)
        return { [PlayerStatType.KICKING]: kickingStats }
      }
      case "P": {
        const puntingStats = await getPlayerStatsForType<PuntingStats>(leagueId, player, "madden_punting_stats", PUNTING_STAT_COLUMNS)
        return { [PlayerStatType.PUNTING]: puntingStats }
      }
      case "LEDGE":
      case "REDGE":
      case "DT":
      case "SAM":
      case "MIKE":
      case "WILL":
      case "CB":
      case "FS":
      case "SS": {
        const defenseStats = await getPlayerStatsForType<DefensiveStats>(leagueId, player, "madden_defensive_stats", DEFENSIVE_STAT_COLUMNS)
        return { [PlayerStatType.DEFENSE]: defenseStats }
      }
      default:
        return {}
    }
  },
  getGamesForSchedule: async function(leagueId: string, scheduleIds: Iterable<{ id: number, week: number, season: number }>) {
    // Promise.all over .map is order-preserving, matching discord_utils.ts's positional
    // indexing assumption against the input iterable.
    return await Promise.all(Array.from(scheduleIds).map(s => this.getGameForSchedule(leagueId, s.id, s.week, s.season)))
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
      const targetTeamId = query.teamId != 0 ? teams.getTeamForId(query.teamId).teamId : 0
      players = players.filter(p => p.teamId === `${targetTeamId}`)
    }

    if (query.position) {
      if (POSITION_GROUP.includes(query.position)) {
        if (query.position === "OL") {
          players = players.filter(p => oLinePositions.includes(p.position))
        } else if (query.position === "DL") {
          players = players.filter(p => dLinePositions.includes(p.position))
        } else if (query.position === "DB") {
          players = players.filter(p => dbPositions.includes(p.position))
        }
      } else {
        players = players.filter(p => p.position === query.position)
      }
    }

    if (query.rookie) {
      players = players.filter(p => p.yearsPro === 0)
    }

    if (query.retired) {
      players = players.filter(p => p.isRetired)
    } else {
      players = players.filter(p => !p.isRetired)
    }

    // Deterministic tiebreak on presentationId instead of relying on incidental array
    // order the way the Firestore version's stable-sort-over-arbitrary-doc-order did.
    players.sort((a, b) => b.playerBestOvr - a.playerBestOvr || a.presentationId - b.presentationId)

    let resultPlayers
    if (startAfter) {
      const cursorIndex = players.findIndex(p =>
        p.presentationId === startAfter.presentationId &&
        p.birthYear === startAfter.birthYear &&
        p.birthMonth === startAfter.birthMonth &&
        p.birthDay === startAfter.birthDay
      )
      resultPlayers = cursorIndex !== -1
        ? players.slice(cursorIndex + 1, Math.min(cursorIndex + 1 + limit, players.length))
        : players.slice(0, limit)
    } else if (endBefore) {
      const cursorIndex = players.findIndex(p =>
        p.presentationId === endBefore.presentationId &&
        p.birthYear === endBefore.birthYear &&
        p.birthMonth === endBefore.birthMonth &&
        p.birthDay === endBefore.birthDay
      )
      if (cursorIndex !== -1) {
        const startIndex = Math.max(0, Math.max(cursorIndex - limit, 0))
        resultPlayers = players.slice(startIndex, cursorIndex)
      } else {
        resultPlayers = players.slice(0, limit)
      }
    } else {
      resultPlayers = players.slice(0, limit)
    }

    return await Promise.all(resultPlayers.map(p => this.getPlayer(leagueId, p.rosterId)))
  },
  updateLeagueExportStatus,
  updateWeeklyExportStatus,
  updateRosterExportStatus,
  getTeamStatsForGame: async function(leagueId: string, teamId: string, week: number, seasonIndex: number) {
    const { rows } = await pool.query(
      `SELECT * FROM madden_team_stats WHERE league_id = $1 AND week_index = $2 AND season_index = $3 AND team_id = $4 LIMIT 1`,
      [leagueId, week - 1, seasonIndex, Number(teamId)]
    )
    if (rows.length > 0) {
      return mapRow<TeamStats>(rows[0], TEAM_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex" })
    }
    throw new Error(`Missing Team Stats for ${MADDEN_SEASON + seasonIndex} Week ${week} for ${teamId}. Try exporting this week again`)
  },
  getExportStatus,
  getStatsForGame: async function(leagueId: string, season: number, week: number, scheduleId: number) {
    const weekIndex = week - 1
    const [teamStatsRows, defensiveRows, kickingRows, puntingRows, receivingRows, rushingRows, passingRows] = await Promise.all([
      pool.query(`SELECT * FROM madden_team_stats WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND schedule_id = $4`, [leagueId, season, weekIndex, scheduleId]),
      pool.query(`SELECT * FROM madden_defensive_stats WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND schedule_id = $4`, [leagueId, season, weekIndex, scheduleId]),
      pool.query(`SELECT * FROM madden_kicking_stats WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND schedule_id = $4`, [leagueId, season, weekIndex, scheduleId]),
      pool.query(`SELECT * FROM madden_punting_stats WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND schedule_id = $4`, [leagueId, season, weekIndex, scheduleId]),
      pool.query(`SELECT * FROM madden_receiving_stats WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND schedule_id = $4`, [leagueId, season, weekIndex, scheduleId]),
      pool.query(`SELECT * FROM madden_rushing_stats WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND schedule_id = $4`, [leagueId, season, weekIndex, scheduleId]),
      pool.query(`SELECT * FROM madden_passing_stats WHERE league_id = $1 AND season_index = $2 AND week_index = $3 AND schedule_id = $4`, [leagueId, season, weekIndex, scheduleId]),
    ])

    const gameStats: GameStats = {
      teamStats: teamStatsRows.rows.map(r => mapRow<TeamStats>(r, TEAM_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex" })),
      playerStats: {},
    }
    if (defensiveRows.rows.length > 0) {
      gameStats.playerStats[PlayerStatType.DEFENSE] = defensiveRows.rows.map(r => mapRow<DefensiveStats>(r, DEFENSIVE_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex", roster_id: "rosterId", team_id: "teamId" }))
    }
    if (kickingRows.rows.length > 0) {
      gameStats.playerStats[PlayerStatType.KICKING] = kickingRows.rows.map(r => mapRow<KickingStats>(r, KICKING_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex", roster_id: "rosterId", team_id: "teamId" }))
    }
    if (puntingRows.rows.length > 0) {
      gameStats.playerStats[PlayerStatType.PUNTING] = puntingRows.rows.map(r => mapRow<PuntingStats>(r, PUNTING_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex", roster_id: "rosterId", team_id: "teamId" }))
    }
    if (receivingRows.rows.length > 0) {
      gameStats.playerStats[PlayerStatType.RECEIVING] = receivingRows.rows.map(r => mapRow<ReceivingStats>(r, RECEIVING_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex", roster_id: "rosterId", team_id: "teamId" }))
    }
    if (rushingRows.rows.length > 0) {
      gameStats.playerStats[PlayerStatType.RUSHING] = rushingRows.rows.map(r => mapRow<RushingStats>(r, RUSHING_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex", roster_id: "rosterId", team_id: "teamId" }))
    }
    if (passingRows.rows.length > 0) {
      gameStats.playerStats[PlayerStatType.PASSING] = passingRows.rows.map(r => mapRow<PassingStats>(r, PASSING_STAT_COLUMNS, { season_index: "seasonIndex", week_index: "weekIndex", roster_id: "rosterId", team_id: "teamId" }))
    }
    return gameStats
  },
  getTeamSchedule: async function(leagueId: string, season?: number) {
    const teams = await this.getLatestTeams(leagueId)
    if (season !== undefined) {
      const { rows } = await pool.query(`SELECT * FROM madden_schedules WHERE league_id = $1 AND stage_index = 1 AND season_index = $2`, [leagueId, season])
      return deduplicateSchedule(rows.map(mapScheduleRow), teams).sort((a, b) => a.weekIndex - b.weekIndex)
    } else {
      const { rows } = await pool.query(`SELECT * FROM madden_schedules WHERE league_id = $1 AND stage_index = 1`, [leagueId])
      if (rows.length === 0) {
        return []
      }
      const games = rows.map(mapScheduleRow)
      const latestSeason = Math.max(...games.map(game => game.seasonIndex))
      return deduplicateSchedule(games.filter(game => game.seasonIndex === latestSeason), teams).sort((a, b) => a.weekIndex - b.weekIndex)
    }
  },
  getStatsForWeek: async function <T extends PlayerStatTypes>(leagueId: string, statType: PlayerStatEvents, week?: number, season?: number): Promise<{ seasonIndex: number, weekIndex: number, stats: T[] }> {
    const seasonIndexView = await seasonView.createView(leagueId)
    const seasonToQuery = season ? season : seasonIndexView ? seasonIndexView.currentSeasonIndex : 0
    let weekToQuery: number
    if (week) {
      weekToQuery = week - 1
    } else {
      const [{ rows }, teamList] = await Promise.all([
        pool.query(`SELECT * FROM madden_schedules WHERE league_id = $1 AND season_index = $2 AND stage_index = 1`, [leagueId, seasonToQuery]),
        this.getLatestTeams(leagueId),
      ])
      const games = deduplicateSchedule(rows.map(mapScheduleRow), teamList)
      const playedGames = games.filter(g => g.status !== GameResult.NOT_PLAYED)
      weekToQuery = playedGames.length === 0 ? 0 : Math.max(...playedGames.map(game => game.weekIndex))
    }
    const { table, columns } = STAT_TABLE_INFO[statType]
    const stats = await queryStatsForLeague<T>(table, columns, leagueId, seasonToQuery, weekToQuery)
    return { seasonIndex: seasonToQuery, weekIndex: weekToQuery, stats: stats as unknown as T[] }
  },
  getStatsForSeason: async function <T extends PlayerStatTypes>(leagueId: string, statType: PlayerStatEvents, season?: number): Promise<T[]> {
    const seasonIndexView = await seasonView.createView(leagueId)
    const seasonToQuery = season ? season : seasonIndexView ? seasonIndexView.currentSeasonIndex : 0
    const { table, columns } = STAT_TABLE_INFO[statType]
    const stats = await queryStatsForLeague<T>(table, columns, leagueId, seasonToQuery)
    return stats as unknown as T[]
  },
}

export default withMetrics(MaddenPostgresDB)
