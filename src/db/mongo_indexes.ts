import db from "./mongo_db"

// Run once after collections exist (or safe to re-run anytime — createIndex
// is a no-op if an identical index already exists). Each index below is
// tied to a specific query pattern from maddendb.ts / appendEvents, noted
// in the comment above it.

const EVENT_TYPES = [
  "MADDEN_TEAM",
  "MADDEN_STANDING",
  "MADDEN_SCHEDULE",
  "MADDEN_PUNTING_STAT",
  "MADDEN_TEAM_STAT",
  "MADDEN_PASSING_STAT",
  "MADDEN_KICKING_STAT",
  "MADDEN_RUSHING_STAT",
  "MADDEN_DEFENSIVE_STAT",
  "MADDEN_RECEIVING_STAT",
  "MADDEN_PLAYER",
]

const PLAYER_STAT_TYPES = [
  "MADDEN_PUNTING_STAT",
  "MADDEN_PASSING_STAT",
  "MADDEN_KICKING_STAT",
  "MADDEN_RUSHING_STAT",
  "MADDEN_DEFENSIVE_STAT",
  "MADDEN_RECEIVING_STAT",
]

async function createIndexes() {
  // ---------------------------------------------------------------------
  // 1. Every event-type collection: unique (leagueId, id)
  //    Needed by: appendEvents' upsert filter { leagueId, id }, and every
  //    single-record lookup (getPlayer, getStandingForTeam, etc).
  //    Unique because idFn produces one stable id per record per league —
  //    this is the constraint that makes upsert-by-id actually work.
  // ---------------------------------------------------------------------
  for (const eventType of EVENT_TYPES) {
    await db.collection(eventType).createIndex(
      { leagueId: 1, id: 1 },
      { unique: true, name: "leagueId_id_unique" }
    )
  }

  // ---------------------------------------------------------------------
  // 2. MADDEN_SCHEDULE: (leagueId, seasonIndex, weekIndex, stageIndex)
  //    Needed by: getLatestWeekSchedule, getWeekScheduleForSeason,
  //    getGameForSchedule, getPlayoffSchedule, getTeamSchedule, getAllWeeks
  //    — every one of these filters on some subset of these 4 fields.
  // ---------------------------------------------------------------------
  await db.collection("MADDEN_SCHEDULE").createIndex(
    { leagueId: 1, seasonIndex: 1, weekIndex: 1, stageIndex: 1 },
    { name: "schedule_lookup" }
  )

  // ---------------------------------------------------------------------
  // 3. Every player-stat collection: (leagueId, seasonIndex, stageIndex, weekIndex)
  //    Needed by: getStatsForWeek (filters all 4), getStatsForSeason
  //    (filters leagueId+seasonIndex+stageIndex, omitting weekIndex —
  //    stageIndex is placed before weekIndex here specifically so that
  //    query can still use the index as a prefix match).
  // ---------------------------------------------------------------------
  for (const statType of PLAYER_STAT_TYPES) {
    await db.collection(statType).createIndex(
      { leagueId: 1, seasonIndex: 1, stageIndex: 1, weekIndex: 1 },
      { name: "stats_by_week_or_season" }
    )
  }

  // ---------------------------------------------------------------------
  // 4. Every player-stat collection + MADDEN_TEAM_STAT:
  //    (leagueId, seasonIndex, weekIndex, scheduleId)
  //    Needed by: getStatsForGame, which filters exactly these 4 fields
  //    across all 7 stat collections at once for a single game.
  // ---------------------------------------------------------------------
  for (const statType of [...PLAYER_STAT_TYPES, "MADDEN_TEAM_STAT"]) {
    await db.collection(statType).createIndex(
      { leagueId: 1, seasonIndex: 1, weekIndex: 1, scheduleId: 1 },
      { name: "stats_by_game" }
    )
  }

  // ---------------------------------------------------------------------
  // 5. Every player-stat collection: (leagueId, rosterId)
  //    Needed by: getPlayerStats -> getStats(), which looks up all stats
  //    for a given (deduplicated) set of rosterIds within a league.
  // ---------------------------------------------------------------------
  for (const statType of PLAYER_STAT_TYPES) {
    await db.collection(statType).createIndex(
      { leagueId: 1, rosterId: 1 },
      { name: "stats_by_roster" }
    )
  }

  // ---------------------------------------------------------------------
  // 6. MADDEN_TEAM_STAT: (leagueId, seasonIndex, weekIndex, teamId)
  //    Needed by: getTeamStatsForGame, which looks up a single team's
  //    stat line for a specific week/season.
  // ---------------------------------------------------------------------
  await db.collection("MADDEN_TEAM_STAT").createIndex(
    { leagueId: 1, seasonIndex: 1, weekIndex: 1, teamId: 1 },
    { name: "team_stat_lookup" }
  )

  // ---------------------------------------------------------------------
  // 7. MADDEN_PLAYER: (leagueId, presentationId, birthYear, birthMonth, birthDay)
  //    Needed by: getPlayer, getPlayerStats, PlayerListView.createView —
  //    all of these look up player-identity duplicates via this derived
  //    key (NOT unique — this is exactly the field combo that produces
  //    multiple docs per real player across title-update-induced
  //    duplicate rosterIds, which is the whole point of deduplicatePlayers).
  // ---------------------------------------------------------------------
  await db.collection("MADDEN_PLAYER").createIndex(
    { leagueId: 1, presentationId: 1, birthYear: 1, birthMonth: 1, birthDay: 1 },
    { name: "player_identity_lookup" }
  )

  // ---------------------------------------------------------------------
  // 8. MADDEN_TEAM: (leagueId, teamId)
  //    Needed by: getLatestTeams / createTeamList, which maps teamId ->
  //    team record within a league. Not unique — teamId isn't stable
  //    across title updates, so multiple docs can share a teamId over
  //    time; "latest" is resolved in app code via timestamp, not the DB.
  // ---------------------------------------------------------------------
  await db.collection("MADDEN_TEAM").createIndex(
    { leagueId: 1, teamId: 1 },
    { name: "team_by_id" }
  )

  // ---------------------------------------------------------------------
  // 9. history collection: (leagueId, eventType, eventId, timestamp)
  //    Needed by: any history-reconstruction path (reconstructFromHistory)
  //    that pulls all changes for a specific record, sorted by time.
  // ---------------------------------------------------------------------
  await db.collection("history").createIndex(
    { leagueId: 1, eventType: 1, eventId: 1, timestamp: 1 },
    { name: "history_by_record" }
  )

  console.log("All indexes created.")
}

createIndexes()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Failed to create indexes:", err)
    process.exit(1)
  })
