import { MaddenEvents } from "../../db/madden_db"
import { Command } from "../commands_handler"
import { createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import LeagueSettingsDB from "../settings_db"

const statEventTypes = [
  { label: "Passing", value: MaddenEvents.MADDEN_PASSING_STAT },
  { label: "Rushing", value: MaddenEvents.MADDEN_RUSHING_STAT },
  { label: "Receiving", value: MaddenEvents.MADDEN_RECEIVING_STAT },
  { label: "Defense", value: MaddenEvents.MADDEN_DEFENSIVE_STAT },
  { label: "Kicking", value: MaddenEvents.MADDEN_KICKING_STAT },
  { label: "Punting", value: MaddenEvents.MADDEN_PUNTING_STAT },
]

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id } = command
    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(guild_id)
    if (!leagueSettings.commands.madden_league?.league_id) {
      throw new Error("Could not find a linked Madden league, link a league first")
    }
    const league = leagueSettings.commands.madden_league.league_id
    if (!command.data.options) {
      throw new Error("stats command not defined properly")
    }
    const options = command.data.options
    const statsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption

    if (statsCommand.name === "weekly") {
      const statType = (statsCommand.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.value ?? MaddenEvents.MADDEN_PASSING_STAT
      const week = (statsCommand.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value ?? -1
      const season = (statsCommand.options?.[2] as APIApplicationCommandInteractionDataIntegerOption)?.value ?? -1

      return createMessageResponse(`Weekly stats - Type: ${statType}, Week: ${week}, Season: ${season}`)
    } else if (statsCommand.name === "season") {
      const statType = (statsCommand.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.value ?? MaddenEvents.MADDEN_PASSING_STAT
      const season = (statsCommand.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value ?? -1

      return createMessageResponse(`Season stats - Type: ${statType}, Season: ${season}`)
    }

    throw new Error("Invalid stats subcommand")
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "stats",
      description: "shows player stats for your league",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "weekly",
          description: "shows weekly stat leaders",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "stat_type",
              description:
                "passing, rushing, receiving, defense...",
              required: false,
              choices: statEventTypes.map(f => ({ name: f.label, value: f.value }))
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "week",
              description:
                "optional week to show stats for",
              required: false
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "season",
              description:
                "optional season to show stats for",
              required: false
            }
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "season",
          description: "shows season stat leaders",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "stat_type",
              description:
                "passing, rushing, receiving, defense...",
              required: false,
              choices: statEventTypes.map(f => ({ name: f.label, value: f.value }))
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "season",
              description:
                "optional season to show stats for",
              required: false
            }
          ],
        }
      ],
      type: ApplicationCommandType.ChatInput,
    }
  }
}
