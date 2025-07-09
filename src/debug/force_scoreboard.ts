import { LeagueSettings, } from "../discord/settings_db"
import MaddenClient from "../db/madden_db"
import { formatScoreboard } from "../discord/commands/game_channels"
import { createClient, createWeekKey } from "../discord/discord_utils"
import EventDB from "../db/events_db"
import { ConfirmedSim } from "../db/events"
import db from "../db/firebase"

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
  const doc = await db.collection("league_settings").doc(guildId).get()
  const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
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
  const sims = await EventDB.queryEvents<ConfirmedSim>(guildId, "CONFIRMED_SIM", new Date(0), { week: week, seasonIndex: seasonIndex }, 30)
  const message = formatScoreboard(week, seasonIndex, games, teams, sims, leagueId)
  await prodClient.editMessage(scoreboard_channel, scoreboard, message, [])
}

updateScoreboard("1296207094344843264", 1, 12)
