import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    respond(ctx, createMessageResponse(`bot is working`))
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "test",
      description: "test the bot is responding",
      type: ApplicationCommandType.ChatInput,
    }
  }
} as CommandHandler
