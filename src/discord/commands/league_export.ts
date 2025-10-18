import { Command } from "../commands_handler"
import { createMessageResponse, DiscordClient } from "../discord_utils"
import { ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { DEPLOYMENT_URL } from "../../config"

export default {
  async handleCommand(command: Command, _: DiscordClient) {
    const { guild_id } = command
    return createMessageResponse(`If you have not tried the snallabot dashboard, please use that. Run command /dashboard\nOtherwise, here are the export links to enter into the Madden Companion app:\n\n First time: https://${DEPLOYMENT_URL}/connect/discord/${guild_id}\nAfter first time: https://${DEPLOYMENT_URL}/`)
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "league_export",
      description: "retrieve the Madden Companion App exporter url",
      type: ApplicationCommandType.ChatInput,
    }
  }
} 
