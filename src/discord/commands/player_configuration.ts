import { Command } from "../commands_handler"
import { createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataBooleanOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import LeagueSettingsDB from "../settings_db"

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("player configure command not defined properly")
    }
    const options = command.data.options
    const playerCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = playerCommand.name
    if (subCommand === "configure") {
      const subCommandOptions = playerCommand.options
      if (!subCommandOptions) {
        throw new Error("missing player configure options!")
      }
      const hiddenDevs = (subCommandOptions[0] as APIApplicationCommandInteractionDataBooleanOption
      ).value
      await LeagueSettingsDB.configurePlayer(guild_id, { useHiddenDevs: hiddenDevs })
      return createMessageResponse(`Player Configuration:\n  - Hidden Devs: ${hiddenDevs ? "on" : "off"}`)
    }

    else {
      throw new Error(`Missing player command ${subCommand}`)
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "player_configuration",
      description: "configures the players command in your league",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "configures settings for players",
          options: [
            {
              type: ApplicationCommandOptionType.Boolean,
              name: "hidden_devs",
              description:
                "Turn on/off rookie hidden devs",
              required: true
            },
          ],
        },
      ],
      type: 1,
    }
  }
}
