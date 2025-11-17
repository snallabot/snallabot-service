import MaddenDB from "../db/madden_db"

async function debugTeamList(leagueId: string) {
  const teams = await MaddenDB.getLatestTeams(leagueId)
  console.log(teams.getLatestTeams().map(t => ({ name: t.displayName, division: t.divName, abbrName: t.abbrName, cityName: t.cityName })))
}

debugTeamList("2277397")
