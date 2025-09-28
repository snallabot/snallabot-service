import { ParameterizedContext } from "koa"
import { CommandHandler, Command, MessageComponentHandler, MessageComponentInteraction } from "../commands_handler"
import { respond, DiscordClient, deferMessage } from "../discord_utils"
import { APIMessageStringSelectInteractionData, ApplicationCommandType, ComponentType, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { MADDEN_SEASON } from "../../export/madden_league_types"
import LeagueSettingsDB, { UserId } from "../settings_db"
import { discordLeagueView } from "../../db/view"
import { getSims } from "../discord_utils"
import { SimResult } from "../../db/events"

export type SeasonSelection = { si: number, }

async function showSeasonSims(token: string, client: DiscordClient, league: string, requestedSeason?: number) {
  try {
    const allSims = await getSims(league)

    if (allSims.length === 0) {
      await client.editOriginalInteraction(token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: "No sims found for this league."
          }
        ]
      })
      return
    }

    // Get available seasons and determine current season
    const seasons = [...new Set(allSims.map(ws => ws.seasonIndex))].sort((a, b) => a - b)
    const currentSeason = requestedSeason ?? Math.max(...seasons)

    // Filter sims for the selected season
    const seasonSims = allSims.filter(sim => sim.seasonIndex === currentSeason)

    // Group sims by user and categorize by result type
    const userStatsMap = new Map<UserId, { forceWins: number, forceLosses: number, fairSims: number, total: number }>()

    for (const sim of seasonSims) {
      // Only count homeUser and awayUser, ignore confirmed/requested users
      if (!sim.homeUser || !sim.awayUser) {
        continue; // Skip sims without both users
      }

      // Initialize users if they don't exist
      if (!userStatsMap.has(sim.homeUser)) {
        userStatsMap.set(sim.homeUser, { forceWins: 0, forceLosses: 0, fairSims: 0, total: 0 })
      }
      if (!userStatsMap.has(sim.awayUser)) {
        userStatsMap.set(sim.awayUser, { forceWins: 0, forceLosses: 0, fairSims: 0, total: 0 })
      }

      const homeStats = userStatsMap.get(sim.homeUser)!
      const awayStats = userStatsMap.get(sim.awayUser)!

      // Increment totals for both users
      homeStats.total++
      awayStats.total++

      // Categorize the sim result based on who wins/loses
      switch (sim.result) {
        case SimResult.FORCE_WIN_HOME:
          homeStats.forceWins++
          awayStats.forceLosses++
          break
        case SimResult.FORCE_WIN_AWAY:
          awayStats.forceWins++
          homeStats.forceLosses++
          break
        case SimResult.FAIR_SIM:
          homeStats.fairSims++
          awayStats.fairSims++
          break
        default:
          // Default to fair sim for any unknown results
          homeStats.fairSims++
          awayStats.fairSims++
          break
      }
    }

    // Build the message
    let message = `# Season ${currentSeason + MADDEN_SEASON} Sim Statistics\n`

    if (userStatsMap.size === 0) {
      message += "No sims found for this season."
    } else {
      // Sort users by total sims (descending)
      const sortedUsers = Array.from(userStatsMap.entries()).sort((a, b) => b[1].total - a[1].total)

      for (const [userId, stats] of sortedUsers) {
        message += `**<@${userId}>** - ${stats.total} total sims\n`
        if (stats.forceWins > 0) {
          message += `  • Force Wins: **${stats.forceWins}**\n`
        }
        if (stats.forceLosses > 0) {
          message += `  • Force Losses: **${stats.forceLosses}**\n`
        }
        if (stats.fairSims > 0) {
          message += `  • Fair Sims: **${stats.fairSims}**\n`
        }
        message += "\n"
      }

      // Add summary stats
      const totalSims = seasonSims.length
      const totalForceWins = Array.from(userStatsMap.values()).reduce((sum, stats) => sum + stats.forceWins, 0)
      const totalForceLosses = Array.from(userStatsMap.values()).reduce((sum, stats) => sum + stats.forceLosses, 0)
      const totalFairSims = Array.from(userStatsMap.values()).reduce((sum, stats) => sum + stats.fairSims, 0)

      message += `**Season Summary:**\n`
      message += `Total Sims: **${totalSims}**\n`

      const summaryParts = []
      if (totalForceWins > 0) summaryParts.push(`Force Wins: **${totalForceWins}**`)
      if (totalForceLosses > 0) summaryParts.push(`Force Losses: **${totalForceLosses}**`)
      if (totalFairSims > 0) summaryParts.push(`Fair Sims: **${totalFairSims}**`)

      if (summaryParts.length > 0) {
        message += summaryParts.join(' • ')
      }
    }

    // Create season selector dropdown
    const seasonOptions = seasons.map(s => ({
      label: `Season ${s + MADDEN_SEASON}`,
      value: JSON.stringify({ si: s } as SeasonSelection)
    }))
    console.log(message)
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: message
        },
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Small
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: "sims_season_selector",
              placeholder: `Season ${currentSeason + MADDEN_SEASON}`,
              options: seasonOptions
            }
          ]
        }
      ]
    })
  } catch (e) {
    console.error(e)
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Failed to show sims: ${e}`
        }
      ]
    })
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command

    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(guild_id)
    if (!leagueSettings.commands.madden_league?.league_id) {
      throw new Error("Could not find a linked Madden league, link a league first")
    }
    const league = leagueSettings.commands.madden_league.league_id

    showSeasonSims(command.token, client, league)
    respond(ctx, deferMessage())
  },

  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "sims",
      description: "View sim statistics by season",
      type: ApplicationCommandType.ChatInput,
    }
  },

  async handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient) {
    try {
      const guildId = interaction.guild_id
      const discordLeague = await discordLeagueView.createView(guildId)
      const leagueId = discordLeague?.leagueId

      if (!leagueId) {
        throw new Error("No league found")
      }
      const selectorData = interaction.data as APIMessageStringSelectInteractionData
      const selection = JSON.parse(selectorData.values[0]) as SeasonSelection
      showSeasonSims(interaction.token, client, leagueId, selection.si)
    } catch (e) {
      console.error(e)
      await client.editOriginalInteraction(interaction.token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `Could not handle sims interaction. Error: ${e}`
          }
        ]
      })
    }

    return {
      type: InteractionResponseType.DeferredMessageUpdate,
    }
  }
} as CommandHandler & MessageComponentHandler
