import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, DiscordClient, deferMessage } from "../discord_utils"
import { ApplicationCommandType, ComponentType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { DEPLOYMENT_URL } from "../../config"
import { discordLeagueView } from "../../db/view"
import { storedTokenClient } from "../../dashboard/ea_client"

async function getDashboardInfo(client: DiscordClient, token: string, guild_id: string) {
  let message = `${createDashboard(guild_id)}\n`
  await client.editOriginalInteraction(token,
    {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: message
        }
      ]
    })
  const v = await discordLeagueView.createView(guild_id)
  if (v && v.leagueId) {
    message += `Connected League: ${v.leagueId}\n`
    await client.editOriginalInteraction(token,
      {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: message + `Fetching League Information...`
          }
        ]
      })
    try {
      const leagueId = Number(v.leagueId)
      const eaClient = await storedTokenClient(leagueId)
      const [leagueInfo, leagues] = await Promise.all([eaClient.getLeagueInfo(leagueId), eaClient.getLeagues()])
      const name = leagues.find(l => l.leagueId === leagueId)?.leagueName || "League not found"
      message += `League Name: ${name}\n`
      const seasonInfo = leagueInfo.careerHubInfo.seasonInfo
      message += `Current Week: ${seasonInfo.weekTitle} ${seasonInfo.displayWeek > 0 ? seasonInfo.displayWeek : ''}\n`
      await client.editOriginalInteraction(token,
        {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: message
            }
          ]
        })
    } catch (e) {
      message += `Could not fetch league information. Error: ${e}\n\nTo link a different league, click on the link above. Hit unlink league. Then come back here, and setup the new league at the link above`
      await client.editOriginalInteraction(token,
        {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: message
            }
          ]
        })
    }
  } else {
    message += `No connected league. To connect a league, setup the dashboard at the above link`
    await client.editOriginalInteraction(token,
      {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: message
          }
        ]
      })
  }
}

export function createDashboard(guild_id: string) {
  return `Snallabot Dashboard: https://${DEPLOYMENT_URL}/dashboard?discord_connection=${guild_id}`
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command

    getDashboardInfo(client, command.token, command.guild_id)
    respond(ctx, deferMessage())
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "dashboard",
      description: "snallabot dashboard link",
      type: ApplicationCommandType.ChatInput,
    }
  }
} as CommandHandler
