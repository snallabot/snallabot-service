import LeagueSettingsDB, { createWeekKey, } from "../discord/settings_db"
import MaddenClient from "../db/madden_db"
import { createClient, formatSchedule, getSimsForWeek } from "../discord/discord_utils"

import { leagueLogosView } from "../db/view"

if (!process.env.PUBLIC_KEY) {
  throw new Error("No Public Key passed for interaction verification")
}

if (!process.env.DISCORD_TOKEN) {
  throw new Error("No Discord Token passed for interaction verification")
}
if (!process.env.APP_ID) {
  throw new Error("No App Id passed for interaction verification")
}

const prodSettings = { publicKey: process.env.PUBLIC_KEY, botToken: process.env.DISCORD_TOKEN, appId: process.env.APP_ID }

const prodClient = createClient(prodSettings)

async function updateScoreboard(guildId: string, seasonIndex: number, week: number) {
  const leagueSettings = await LeagueSettingsDB.getLeagueSettings(guildId)
  const leagueId = leagueSettings.commands.madden_league?.league_id
  if (!leagueId) {
    return
  }
  const weekState = leagueSettings.commands.game_channel?.weekly_states?.[createWeekKey(seasonIndex, week)]
  const scoreboard_channel = leagueSettings.commands.game_channel?.scoreboard_channel
  if (!scoreboard_channel) {
    return
  }
  const scoreboard = weekState?.scoreboard
  if (!scoreboard) {
    return
  }
  const teams = await MaddenClient.getLatestTeams(leagueId)
  const games = await MaddenClient.getWeekScheduleForSeason(leagueId, week, seasonIndex)

  const logos = await leagueLogosView.createView(leagueId)
  const sims = await getSimsForWeek(leagueId, week, seasonIndex)
  const message = formatSchedule(week, seasonIndex, games, teams, sims, logos)
  await prodClient.editMessage(scoreboard_channel, scoreboard, message, [])
}



updateScoreboard("1198780271814770829", 0, 1)
