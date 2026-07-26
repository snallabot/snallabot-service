const fs = require("fs")
const path = require("path")

exports.shorthands = undefined

// Executes sql/madden_schema.sql verbatim so the checked-in schema file and what
// actually runs against the database can never drift.
exports.up = pgm => {
  const schemaPath = path.join(__dirname, "..", "sql", "madden_schema.sql")
  pgm.sql(fs.readFileSync(schemaPath, "utf8"))
}

exports.down = pgm => {
  const tables = [
    "madden_teams", "madden_standings", "madden_schedules",
    "madden_team_stats", "madden_passing_stats", "madden_rushing_stats",
    "madden_receiving_stats", "madden_defensive_stats", "madden_kicking_stats",
    "madden_punting_stats", "madden_players",
  ]
  for (const table of tables) {
    pgm.sql(`DROP TABLE IF EXISTS ${table}_history`)
    pgm.sql(`DROP TABLE IF EXISTS ${table}`)
  }
  pgm.sql("DROP TABLE IF EXISTS player_identity_map")
}
