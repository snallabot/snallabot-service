import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, NoConnectedLeagueError } from "../discord_utils"
import { ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { discordLeagueView } from "../../db/view"

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    const view = await discordLeagueView.createView(guild_id)
    if (view) {

    } else {
      throw new NoConnectedLeagueError(guild_id)
    }
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
