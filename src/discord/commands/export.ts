import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, DiscordClient, deferMessageInvisible } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { ExportContext, exporterForLeague } from "../../dashboard/ea_client"
import { discordLeagueView } from "../../db/view"


async function handleExport(guildId: string, week: number, token: string, client: DiscordClient) {
  await client.editOriginalInteraction(token, {
    content: "exporting now...",
    flags: 64
  })
  const league = await discordLeagueView.createView(guildId)
  if (!league) {
    await client.editOriginalInteraction(token, {
      content: "Discord server not connected to any Madden league. Try setting up the dashboard again",
      flags: 64
    })
    return
  }
  try {
    const exporter = await exporterForLeague(Number(league.leagueId), ExportContext.MANUAL)
    if (week === 100) {
      await exporter.exportCurrentWeek()
    } else if (week === 101) {
      await exporter.exportAllWeeks()
    } else {
      await exporter.exportSpecificWeeks([{ weekIndex: week - 1, stage: 1 }])
    }
    await client.editOriginalInteraction(token, {
      content: "finished exporting!",
      flags: 64
    })
  } catch (e) {
    await client.editOriginalInteraction(token, {
      content: `Export failed :(, error: ${e}`,
      flags: 64
    })
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id, token } = command
    if (!command.data.options) {
      throw new Error("export command not defined properly")
    }
    const options = command.data.options
    const exportCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption


    const subCommand = exportCommand.name
    const week = (() => {
      if (subCommand === "week") {
        if (!exportCommand.options || !exportCommand.options[0]) {
          throw new Error("export week command misconfigured")
        }
        const week = Number((exportCommand.options[0] as APIApplicationCommandInteractionDataIntegerOption).value)
        if (week < 1 || week > 23 || week === 22) {
          throw new Error("Invalid week number. Valid weeks are week 1-18 and use specific playoff commands or playoff week numbers: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
        }
        return week
      }
      if (subCommand === "current") {
        return 100
      }
      if (subCommand === "all_weeks") {
        return 101
      }
    })()
    if (!week) {
      throw new Error("export week mising")
    }
    respond(ctx, deferMessageInvisible())
    handleExport(guild_id, week, token, client)
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "export",
      description: "export your league through the dashboard",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "current",
          description: "exports the current week",
          options: [],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "week",
          description: "exports the specified week",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "week",
              description: "the week number to export",
              required: true,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "all_weeks",
          description: "exports all weeks",
          options: [],
        },
      ],
    }
  }
} as CommandHandler
