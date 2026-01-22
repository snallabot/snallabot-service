import { Command } from "../commands_handler"
import { DiscordClient, SnallabotCommandReactions, deferMessageInvisible } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { ExportContext, exporterForLeague, ExportResult, ExportStatus, getPositionInQueue, getQueueSize, getTask, TaskStatus } from "../../dashboard/ea_client"
import { discordLeagueView } from "../../db/view"
import { getMessageForWeek } from "../../export/madden_league_types"


async function handleExport(guildId: string, week: number, token: string, client: DiscordClient) {
  await client.editOriginalInteraction(token, {
    content: "Starting export...",
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
    const exporter = exporterForLeague(Number(league.leagueId), ExportContext.MANUAL)
    let result: ExportResult

    if (week === 100) {
      result = exporter.exportCurrentWeek()
    } else if (week === 101) {
      result = exporter.exportAllWeeks()
    } else {
      result = exporter.exportSpecificWeeks([{ weekIndex: week - 1, stage: 1 }])
    }

    const { task, waitUntilDone } = result

    // Poll for status updates
    const pollInterval = setInterval(async () => {
      try {
        const currentTask = getTask(task.id)
        const position = getPositionInQueue(task.id)

        let content = ""

        if (position >= 0) {
          // Task is still in queue
          content = `${SnallabotCommandReactions.WAITING} Export queued, No need to keep exporting - Position: ${position + 1} of ${getQueueSize()}`
        } else {
          // Task is being processed
          content = buildStatusMessage(currentTask.status)
        }

        await client.editOriginalInteraction(token, {
          content,
          flags: 64
        })
      } catch (e) {
        // Task might be complete or error occurred
        clearInterval(pollInterval)
      }
    }, 10000)

    // Wait for completion
    await waitUntilDone
    clearInterval(pollInterval)

    // Show final success state
    const finalTask = getTask(task.id)
    await client.editOriginalInteraction(token, {
      content: buildCompletionMessage(finalTask.status),
      flags: 64
    })

  } catch (e) {
    await client.editOriginalInteraction(token, {
      content: `${SnallabotCommandReactions.ERROR} Export failed: ${e}`,
      flags: 64
    })
  }
}

function buildStatusMessage(status: ExportStatus): string {
  const parts: string[] = []

  // League info status
  parts.push(`League Info: ${getStatusEmoji(status.leagueInfo)}`)

  // Weekly data status
  if (status.weeklyData.length > 0) {
    const weekSummary = status.weeklyData.map(w =>
      `${getMessageForWeek(w.weekIndex + 1)}: ${getStatusEmoji(w.status)}`
    ).join("\n")
    parts.push(weekSummary)
  }

  // Rosters status
  parts.push(`Rosters: ${getStatusEmoji(status.rosters)}`)

  return parts.join("\n")
}

function buildCompletionMessage(status: ExportStatus): string {
  const parts: string[] = []

  parts.push(`League Info: ${SnallabotCommandReactions.FINISHED}`)

  if (status.weeklyData.length > 0) {
    const weekSummary = status.weeklyData.map(w =>
      `${getMessageForWeek(w.weekIndex + 1)}: ${SnallabotCommandReactions.FINISHED}`
    ).join("\n")
    parts.push(weekSummary)
  }

  parts.push(`Rosters: ${SnallabotCommandReactions.FINISHED}`)
  parts.push(`\n${SnallabotCommandReactions.FINISHED} Export complete!`)

  return parts.join("\n")
}

function getStatusEmoji(status: TaskStatus): string {
  switch (status) {
    case TaskStatus.NOT_STARTED:
      return SnallabotCommandReactions.WAITING
    case TaskStatus.STARTED:
      return SnallabotCommandReactions.LOADING
    case TaskStatus.FINISHED:
      return SnallabotCommandReactions.FINISHED
    case TaskStatus.ERROR:
      return SnallabotCommandReactions.ERROR
    default:
      return "❓"
  }
}
export default {
  async handleCommand(command: Command, client: DiscordClient) {
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
    handleExport(guild_id, week, token, client)
    return deferMessageInvisible()
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
}
