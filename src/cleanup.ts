import { deleteToken, getAllTokens } from "./dashboard/ea_client"
import { createClient } from "./discord/discord_utils"
import LeagueSettingsDB, { ChannelId, DiscordIdType } from "./discord/settings_db"
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

const STATS_CHANNEL: ChannelId = { id: "1207476843373010984", id_type: DiscordIdType.CHANNEL }

async function calculateLeagueStats() {
  const allLeagues = await LeagueSettingsDB.getAllLeagueSettings()
  const stats = {
    totalLeagues: allLeagues.length,
    configurationUsage: {
      logger: 0,
      game_channel: 0,
      stream_count: 0,
      broadcast: 0,
      teams: 0,
      waitlist: 0,
      madden_league: 0
    }
  }

  allLeagues.forEach(league => {
    if (league.commands.logger) stats.configurationUsage.logger++
    if (league.commands.game_channel) stats.configurationUsage.game_channel++
    if (league.commands.stream_count) stats.configurationUsage.stream_count++
    if (league.commands.broadcast) stats.configurationUsage.broadcast++
    if (league.commands.teams) stats.configurationUsage.teams++
    if (league.commands.waitlist) stats.configurationUsage.waitlist++
    if (league.commands.madden_league) stats.configurationUsage.madden_league++
  })
  const individualConfigurationStats = Object.entries(stats.configurationUsage).map(e => {
    const [conf, stat] = e
    return `Total ${conf} leagues: ${stat}`
  }).join("\n")
  const message = `# Snallabot Daily League Settings Stats\nTotal Leagues: ${stats.totalLeagues}\n${individualConfigurationStats}`
  await prodClient.createMessage(STATS_CHANNEL, message, [])
}

async function cleanupDashboards() {
  const tokens = await getAllTokens()

  const now = new Date()
  const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000))

  const tokensToDelete = tokens.filter((storedToken) => {
    return storedToken.token.expiry < threeDaysAgo
  })

  // Delete the expired tokens
  for (const tokenToDelete of tokensToDelete) {
    await deleteToken(tokenToDelete.token.blazeId)
  }

  const message = `# Snallabot Daily Dashboard Stats\nTotal Tokens: ${tokens.length}\nExpired: ${tokensToDelete.length}`
  await prodClient.createMessage(STATS_CHANNEL, message, [])
}

async function main() {
  await calculateLeagueStats()
  await cleanupDashboards()
}
main()
