import { Command } from "../commands_handler"
import { createMessageResponse, DiscordClient } from "../discord_utils"
import { ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"


export default {
  async handleCommand(command: Command, client: DiscordClient) {
    return createMessageResponse(`bot is working`)
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "test",
      description: "test the bot is responding",
      type: ApplicationCommandType.ChatInput,
    }
  }
} 
