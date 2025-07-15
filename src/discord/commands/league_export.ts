import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { DEPLOYMENT_URL } from "../../config"

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    respond(ctx, createMessageResponse(`If you have not tried the snallabot dashboard, please use that. Run command /dashboard\nOtherwise, here are the export links to enter into the Madden Companion app:\n\n First time: https://${DEPLOYMENT_URL}/connect/discord/${guild_id}\nAfter first time: https://${DEPLOYMENT_URL}/`))
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "league_export",
      description: "retrieve the Madden Companion App exporter url",
      type: ApplicationCommandType.ChatInput,
    }
  }
} as CommandHandler
