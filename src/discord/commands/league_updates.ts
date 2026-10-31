import { Command } from "../commands_handler"
import { createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import LeagueSettingsDB, { DiscordIdType, LeagueSettings, LeagueUpdateConfiguration, LeagueUpdateOptions } from "../settings_db"
import { Player } from "../../export/madden_league_types"
import { History } from "../../db/events_db"

const LEAGUE_UPDATE_OPTIONS: Record<LeagueUpdateOptions, { name: string }> = {
  [LeagueUpdateOptions.DEV_TRAIT_CHANGE]: { name: "Dev Trait Changes" },
  [LeagueUpdateOptions.GAME_FINISHED]: { name: "Finished Games" },
  [LeagueUpdateOptions.PLAYER_EDIT]: { name: "Player Edits" },
  [LeagueUpdateOptions.PLAYER_RATING_CHANGE]: { name: "Player Rating Updates" },
  [LeagueUpdateOptions.PLAYER_TEAM_CHANGE]: { name: "Player Roster Updates" }
}
const choices: { name: string, value: LeagueUpdateOptions }[] = Object.entries(LEAGUE_UPDATE_OPTIONS).sort(([a], [b]) => a.localeCompare(b)).map(e => ({ name: e[1].name, value: e[0] as LeagueUpdateOptions }))

function createLeagueUpdateConfigurationMessage(config: LeagueUpdateConfiguration) {
  let message = `League Update Configuration:\n`
  choices.forEach(choice => {
    const channel = config[choice.value]
    const channelMessage = channel ? `<#${channel.id}>` : "Not Configured"
    message += `- ${choice.name}: ${channelMessage}\n`
  })
  message += `\n Note: Once an update is configured, the bot will only send new changes`
  return message
}

const PLAYER_EDIT_FIELDS = ["height", "firstName", "lastName", "age", "weight", "position"]
const PLAYER_RATING_FIELDS = ["throwOnRunRating", "powerMovesRating", "runBlock"]
export async function handlePlayerChanges(settings: LeagueSettings, latestPlayersUpdated: Player[], changes: History[]) {
  const leagueUpdateConfig = settings.commands?.league_updates
  if (!leagueUpdateConfig) {
    return
  }
  if (leagueUpdateConfig[LeagueUpdateOptions.PLAYER_EDIT]) {

  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("league_updates command not defined properly")
    }
    const options = command.data.options
    const playerCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = playerCommand.name
    if (subCommand === "configure") {
      const subCommandOptions = playerCommand.options
      if (!subCommandOptions) {
        throw new Error("missing player configure options!")
      }
      const updateOption = (subCommandOptions[0] as APIApplicationCommandInteractionDataStringOption
      ).value as LeagueUpdateOptions
      const channel = (subCommandOptions[1] as APIApplicationCommandInteractionDataChannelOption
      ).value
      const leagueUpdateConfiguration = await LeagueSettingsDB.configureLeagueUpdate(guild_id, updateOption, { id: channel, id_type: DiscordIdType.CHANNEL })
      return createMessageResponse(createLeagueUpdateConfigurationMessage(leagueUpdateConfiguration))
    } else if (subCommand === "remove") {
      const subCommandOptions = playerCommand.options
      if (!subCommandOptions) {
        throw new Error("missing player configure options!")
      }
      const updateOption = (subCommandOptions[0] as APIApplicationCommandInteractionDataStringOption
      ).value as LeagueUpdateOptions
      const leagueUpdateConfiguration = await LeagueSettingsDB.removeLeagueUpdate(guild_id, updateOption)
      return createMessageResponse(createLeagueUpdateConfigurationMessage(leagueUpdateConfiguration))
    }

    else {
      throw new Error(`Missing player command ${subCommand}`)
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "league_updates",
      description: "tracks and sends league changes",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "Configures channels to send league updates to",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "update_option",
              description: "which part of your league you want to track",
              required: true,
              choices: choices
            },
            {
              type: ApplicationCommandOptionType.Channel,
              name: "update_channel",
              description: "which channel to send updates to",
              required: true,
              channel_types: [ChannelType.GuildText],
            }
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "remove",
          description: "removes tracking of an update",
          options: [{
            type: ApplicationCommandOptionType.String,
            name: "update_option",
            description: "which part of your league you want to track",
            required: true,
            choices: choices
          }],
        }
      ],
      type: ApplicationCommandType.ChatInput,
    }
  }
} 
