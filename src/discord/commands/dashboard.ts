import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, deferMessage } from "../discord_utils"
import { ApplicationCommandType, ComponentType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { DEPLOYMENT_URL } from "../../config"
import { discordLeagueView } from "../../db/view"
import { storedTokenClient } from "../../dashboard/ea_client"

async function getDashboardInfo(client: DiscordClient, token: string, guild_id: string) {
  let message = `Snallabot Dashboard: https://${DEPLOYMENT_URL}/dashboard?discord_connection=${guild_id}\n`
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
          },
          {
            type: ComponentType.Separator,
            divider: true,
            spacing: SeparatorSpacingSize.Small
          },
        ]
      })
    try {
      const leagueId = Number(v.leagueId)
      const eaClient = await storedTokenClient(leagueId)
      const [leagueInfo, leagues] = await Promise.all([eaClient.getLeagueInfo(leagueId), eaClient.getLeagues()])
      const name = leagues.find(l => l.leagueId === leagueId)?.leagueName || "League not found"
      message += `League Name: ${name}\n`
      message += `Current Week: ${leagueInfo.careerHubInfo.seasonInfo.displayWeek}\n`
      await client.editOriginalInteraction(token,
        {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: message
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: SeparatorSpacingSize.Small
            },
          ]
        })
    } catch (e) {
      message += `Could not fetch league information. Error: ${e}\n`
      await client.editOriginalInteraction(token,
        {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: message
            },
            {
              type: ComponentType.Separator,
              divider: true,
              spacing: SeparatorSpacingSize.Small
            },
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
          },
          {
            type: ComponentType.Separator,
            divider: true,
            spacing: SeparatorSpacingSize.Small
          },
        ]
      })
  }
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
