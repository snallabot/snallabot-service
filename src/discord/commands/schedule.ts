import { ParameterizedContext } from "koa"
import { CommandHandler, Command, AutocompleteHandler, Autocomplete, MessageComponentHandler, MessageComponentInteraction } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, ResponseType, deferMessage, getTeamEmoji, SnallabotTeamEmojis } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIMessageStringSelectInteractionData, ApplicationCommandOptionType, ApplicationCommandType, ComponentType, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { GameResult, MADDEN_SEASON, MaddenGame, Team, getMessageForWeek } from "../../export/madden_league_types"
import MaddenClient from "../../db/madden_db"
import LeagueSettingsDB from "../settings_db"
import { allLeagueWeeks, discordLeagueView } from "../../db/view"

function formatTeamEmoji(teamId?: string) {
  if (teamId) {
    return getTeamEmoji(teamId)
  }
  return SnallabotTeamEmojis.NFL
}
type WeekSelection = { wi: number, si: number }
async function showSchedule(token: string, client: DiscordClient,
  league: string, requestedWeek?: number, requestedSeason?: number) {
  const [schedule, teams] = await Promise.all([getWeekSchedule(league, requestedWeek ? Number(requestedWeek) : undefined, requestedSeason ? Number(requestedSeason) : undefined), MaddenClient.getLatestTeams(league)])
  const sortedSchedule = schedule.sort((a, b) => a.scheduleId - b.scheduleId)
  const teamMap = new Map<Number, Team>()
  teams.getLatestTeams().forEach(t => teamMap.set(t.teamId, t))
  const schedulesMessage = sortedSchedule.filter(w => w.awayTeamId !== 0 && w.homeTeamId !== 0).map(game => {
    if (game.status === GameResult.NOT_PLAYED) {
      return `${formatTeamEmoji(teamMap.get(game.awayTeamId)?.abbrName)} vs ${formatTeamEmoji(teamMap.get(game.homeTeamId)?.abbrName)}`
    } else {
      if (game.awayScore > game.homeScore) {
        return `**__${formatTeamEmoji(teamMap.get(game.awayTeamId)?.abbrName)} ${game.awayScore
          }__** vs ${game.homeScore} ${formatTeamEmoji(teamMap.get(game.homeTeamId)?.abbrName)}`
      } else if (game.homeScore > game.awayScore) {
        return `${formatTeamEmoji(teamMap.get(game.awayTeamId)?.abbrName)} ${game.awayScore
          } vs **__${game.homeScore} ${formatTeamEmoji(teamMap.get(game.homeTeamId)?.abbrName)}__**`
      }
      return `${formatTeamEmoji(teamMap.get(game.awayTeamId)?.abbrName)} ${game.awayScore} vs ${game.homeScore
        } ${formatTeamEmoji(teamMap.get(game.homeTeamId)?.abbrName)}`
    }
  }).join("\n")
  const season = schedule[0].seasonIndex
  const week = schedule[0].weekIndex + 1
  const message = `# ${MADDEN_SEASON + season} ${getMessageForWeek(week)} Schedule\n${schedulesMessage}`
  const gameOptions = sortedSchedule.filter(g => g.status !== GameResult.NOT_PLAYED).map(game => ({
    label: `${teamMap.get(game.awayTeamId)?.abbrName} ${game.awayScore} - ${game.homeScore} ${teamMap.get(game.homeTeamId)?.abbrName}`,
    value: { w: game.weekIndex, s: game.seasonIndex, c: game.scheduleId }
  }))
    .map(option => ({ ...option, value: JSON.stringify(option.value) }))
  const gameSelector = gameOptions.length > 0 ? [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: "game_stats",
          placeholder: "View Game Stats",
          options: gameOptions
        }
      ]
    },
    {
      type: ComponentType.Separator,
      divider: true,
      spacing: SeparatorSpacingSize.Large
    },
  ] : []
  const view = await allLeagueWeeks.createView(league)
  const weekOptions = view?.filter(ws => ws.seasonIndex === season)
    .map(ws => ws.weekIndex)
    .sort((a, b) => a - b)
    .map(w => ({
      label: `Week ${w}`,
      value: { wi: w, si: season }
    }))
    .map(option => ({ ...option, value: JSON.stringify(option.value) }))
  const seasonOptions = [...new Set(view?.map(ws => ws.seasonIndex))]
    .sort((a, b) => a - b)
    .map(s => ({
      label: `Season ${s + MADDEN_SEASON}`,
      value: { wi: Math.min(...view?.map(ws => ws.seasonIndex).filter(ws => ws === s) || [0]), si: s }
    }))
    .map(option => ({ ...option, value: JSON.stringify(option.value) }))
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
      ...gameSelector,
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: "week_selector",
            placeholder: `Week ${week}`,
            options: weekOptions
          }
        ]
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: "season_selector",
            placeholder: `Season ${season + MADDEN_SEASON}`,
            options: seasonOptions
          }
        ]
      },
    ]
  })

}

async function getWeekSchedule(league: string, week?: number, season?: number) {
  if (season) {
    if (week) {
      const seasonIndex = season < 100 ? season : season - MADDEN_SEASON
      return await MaddenClient.getWeekScheduleForSeason(league, week, seasonIndex)
    }
    throw new Error("If you specified Season please also specify the week")
  } else if (week) {
    return await MaddenClient.getLatestWeekSchedule(league, week)
  } else {
    return await MaddenClient.getLatestSchedule(league)
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
    const week = (command.data.options?.[0] as APIApplicationCommandInteractionDataIntegerOption)?.value
    if (week && (Number(week) < 1 || Number(week) > 23 || week === 22)) {
      throw new Error("Invalid week number. Valid weeks are week 1-18 and for playoffs: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
    }
    const season = (command.data.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value
    showSchedule(command.token, client, league, week ? Number(week) : undefined, season ? Number(season) : undefined)
    respond(ctx, deferMessage())
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "schedule",
      description: "Shows the schedule for the week and season",
      options: [
        {
          type: ApplicationCommandOptionType.Integer,
          name: "week",
          description: "The week to get the schedule for",
          required: false
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: "season",
          description: "The season to get the schedule for",
          required: false
        }
      ],
      type: ApplicationCommandType.ChatInput,
    }
  },
  async handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient) {
    const customId = interaction.custom_id
    if (customId === "week_selector" || customId === "season_selector") {
      const data = interaction.data as APIMessageStringSelectInteractionData
      if (data.values.length !== 1) {
        throw new Error("Somehow did not receive just one selection from schedule selector " + data.values)
      }
      const { wi: weekIndex, si: seasonIndex } = JSON.parse(data.values[0]) as WeekSelection
      try {
        const guildId = interaction.guild_id
        const discordLeague = await discordLeagueView.createView(guildId)
        const leagueId = discordLeague?.leagueId
        if (leagueId) {
          showSchedule(interaction.token, client, leagueId, weekIndex, seasonIndex)
        }
      } catch (e) {
        await client.editOriginalInteraction(interaction.token, {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: `Could not show schedule Error: ${e}`
            },

          ]
        })
      }
      return {
        type: InteractionResponseType.DeferredMessageUpdate,
      }
    }
    throw new Error(`Invalid interaction on schedule`)
  }
} as CommandHandler & MessageComponentHandler
