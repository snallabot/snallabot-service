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
  const settledPromise = await Promise.allSettled([getWeekSchedule(league, requestedWeek ? Number(requestedWeek) : undefined, requestedSeason ? Number(requestedSeason) : undefined), MaddenClient.getLatestTeams(league)])
  const schedule = settledPromise[0].status === "fulfilled" ? settledPromise[0].value : []
  if (settledPromise[1].status !== "fulfilled") {
    throw new Error("No Teams setup, setup the bot and export")
  }
  const teams = settledPromise[1].value
  const sortedSchedule = schedule.sort((a, b) => a.scheduleId - b.scheduleId)
  const teamMap = new Map<Number, Team>()
  teams.getLatestTeams().forEach(t => teamMap.set(t.teamId, t))
  const schedulesMessage = sortedSchedule.filter(w => w.awayTeamId !== 0 && w.homeTeamId !== 0).map(game => {
    const awayTeam = teamMap.get(game.awayTeamId);
    const homeTeam = teamMap.get(game.homeTeamId);
    const awayDisplay = `${awayTeam?.abbrName} ${formatTeamEmoji(awayTeam?.abbrName)} ${awayTeam?.displayName}`;
    const homeDisplay = `${homeTeam?.abbrName} ${formatTeamEmoji(homeTeam?.abbrName)} ${homeTeam?.displayName}`;

    if (game.status === GameResult.NOT_PLAYED) {
      return `${awayDisplay} vs ${homeDisplay}`;
    } else {
      if (game.awayScore > game.homeScore) {
        return `**__${awayDisplay} ${game.awayScore}__** vs ${game.homeScore} ${homeDisplay}`;
      } else if (game.homeScore > game.awayScore) {
        return `${awayDisplay} ${game.awayScore} vs **${game.homeScore} ${homeDisplay}**`;
      }
      return `${awayDisplay} ${game.awayScore} vs ${game.homeScore} ${homeDisplay}`;
    }
  }).join("\n");
  const season = schedule?.[0]?.seasonIndex || requestedSeason
  const week = schedule?.[0]?.weekIndex + 1 || requestedWeek

  const message = typeof season === 'number' && typeof week === 'number' ? `# ${MADDEN_SEASON + season} ${getMessageForWeek(week)} Schedule\n${schedulesMessage}` : `No Schedule found`
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
      label: `${getMessageForWeek(w + 1)}`,
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
            placeholder: `Week ${week || 1}`,
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
            placeholder: `Season ${season || 0 + MADDEN_SEASON}`,
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
          showSchedule(interaction.token, client, leagueId, weekIndex + 1, seasonIndex)
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
