const fs = require("fs")
const path = require("path")

exports.shorthands = undefined

const TABLES = [
  "madden_teams", "madden_standings", "madden_schedules",
  "madden_team_stats", "madden_passing_stats", "madden_rushing_stats",
  "madden_receiving_stats", "madden_defensive_stats", "madden_kicking_stats",
  "madden_punting_stats", "madden_players",
]

// Executes sql/history_triggers.sql verbatim - see that file for how it was generated
// and why triggers (not application code) capture history.
exports.up = pgm => {
  const sqlPath = path.join(__dirname, "..", "sql", "history_triggers.sql")
  pgm.sql(fs.readFileSync(sqlPath, "utf8"))
}

exports.down = pgm => {
  for (const table of TABLES) {
    pgm.sql(`DROP TRIGGER IF EXISTS trg_${table}_history ON ${table}`)
    pgm.sql(`DROP FUNCTION IF EXISTS ${table}_capture_history()`)
  }
}
