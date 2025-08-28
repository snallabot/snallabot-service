import { ParameterizedContext } from "koa"
import { CommandHandler, Command, AutocompleteHandler, Autocomplete, MessageComponentHandler, MessageComponentInteraction } from "../commands_handler"
import { respond, DiscordClient, deferMessage, formatTeamEmoji } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, APIMessageStringSelectInteractionData, ApplicationCommandOptionType, ApplicationCommandType, ComponentType, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { GameResult, MADDEN_SEASON, Team, getMessageForWeek } from "../../export/madden_league_types"
import MaddenClient from "../../db/madden_db"
import LeagueSettingsDB from "../settings_db"
import { allLeagueWeeks, discordLeagueView, teamSearchView } from "../../db/view"
import { GameStatsOptions } from "./game_stats"
import fuzzysort from "fuzzysort"

export type WeekSelection = { wi: number, si: number }
export type TeamSelection = { t: number, si: number }
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
    const awayDisplay = `${formatTeamEmoji(awayTeam?.abbrName)} ${awayTeam?.displayName}`;
    const homeDisplay = `${formatTeamEmoji(homeTeam?.abbrName)} ${homeTeam?.displayName}`;

    if (game.status === GameResult.NOT_PLAYED) {
      return `${awayDisplay} vs ${homeDisplay}`;
    } else {
      if (game.awayScore > game.homeScore) {
        return `**${awayDisplay} ${game.awayScore}** vs ${game.homeScore} ${homeDisplay}`;
      } else if (game.homeScore > game.awayScore) {
        return `${awayDisplay} ${game.awayScore} vs **${game.homeScore} ${homeDisplay}**`;
      }
      return `${awayDisplay} ${game.awayScore} vs ${game.homeScore} ${homeDisplay}`;
    }
  }).join("\n")
  const season = schedule?.[0]?.seasonIndex >= 0 ? schedule[0].seasonIndex : requestedSeason != null ? requestedSeason : 0
  const week = schedule?.[0]?.weekIndex >= 0 ? schedule[0].weekIndex + 1 : requestedWeek != null ? requestedWeek : 1

  const message = `# ${MADDEN_SEASON + season} ${getMessageForWeek(week)} Schedule\n${schedulesMessage}`
  const gameOptions = sortedSchedule.filter(g => g.status !== GameResult.NOT_PLAYED).map(game => ({
    label: `${teamMap.get(game.awayTeamId)?.abbrName} ${game.awayScore} - ${game.homeScore} ${teamMap.get(game.homeTeamId)?.abbrName}`,
    value: { w: game.weekIndex, s: game.seasonIndex, c: game.scheduleId, o: GameStatsOptions.OVERVIEW, b: { wi: week - 1, si: season } }
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
  console.log()
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
            placeholder: `Season ${(season) + MADDEN_SEASON}`,
            options: seasonOptions
          }
        ]
      },
    ]
  })
}

async function showTeamSchedule(token: string, client: DiscordClient,
  league: string, teamId: number, requestedSeason?: number) {
  const settledPromise = await Promise.allSettled([
    MaddenClient.getTeamSchedule(league, requestedSeason),
    MaddenClient.getLatestTeams(league)
  ])

  const schedule = settledPromise[0].status === "fulfilled" ? settledPromise[0].value : []
  if (settledPromise[1].status !== "fulfilled") {
    throw new Error("No Teams setup, setup the bot and export")
  }
  const teams = settledPromise[1].value

  // Filter schedule to only include games for the specified team
  const teamSchedule = schedule.filter(game =>
    game.awayTeamId === teamId || game.homeTeamId === teamId
  ).sort((a, b) => a.scheduleId - b.scheduleId)


  const selectedTeam = teams.getTeamForId(teamId)
  if (!selectedTeam) {
    throw new Error("Team not found")
  }

  const schedulesMessage = teamSchedule.map(game => {
    const isTeamAway = game.awayTeamId === teamId
    const opponent = teams.getTeamForId(isTeamAway ? game.homeTeamId : game.awayTeamId)
    const opponentDisplay = `${formatTeamEmoji(opponent?.abbrName)} ${opponent?.displayName}`
    const teamDisplay = `${formatTeamEmoji(selectedTeam.abbrName)} ${selectedTeam.displayName}`

    if (game.status === GameResult.NOT_PLAYED) {
      return `${teamDisplay} ${isTeamAway ? '@' : 'vs'} ${opponentDisplay}`
    } else {
      const teamScore = isTeamAway ? game.awayScore : game.homeScore
      const opponentScore = isTeamAway ? game.homeScore : game.awayScore
      const teamWon = teamScore > opponentScore

      if (teamWon) {
        return `**${teamDisplay} ${teamScore}** ${isTeamAway ? '@' : 'vs'} ${opponentScore} ${opponentDisplay}`
      } else {
        return `${teamDisplay} ${teamScore} ${isTeamAway ? '@' : 'vs'} **${opponentScore} ${opponentDisplay}**`
      }
    }
  }).join("\n")

  const season = teamSchedule?.[0]?.seasonIndex >= 0 ? teamSchedule[0].seasonIndex : requestedSeason != null ? requestedSeason : 0

  const message = `# ${selectedTeam.displayName} ${MADDEN_SEASON + season} Season Schedule\n${schedulesMessage}`

  const gameOptions = teamSchedule.filter(g => g.status !== GameResult.NOT_PLAYED).map(game => {
    const isTeamAway = game.awayTeamId === teamId
    const opponent = teams.getTeamForId(isTeamAway ? game.homeTeamId : game.awayTeamId)
    const teamScore = isTeamAway ? game.awayScore : game.homeScore
    const opponentScore = isTeamAway ? game.homeScore : game.awayScore

    return {
      label: `${selectedTeam.abbrName} ${teamScore} - ${opponentScore} ${opponent?.abbrName}`,
      value: { w: game.weekIndex, s: game.seasonIndex, c: game.scheduleId, o: GameStatsOptions.OVERVIEW, b: { t: teamId, si: season } }
    }
  })
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
  const seasonOptions = [...new Set(view?.map(ws => ws.seasonIndex))]
    .sort((a, b) => a - b)
    .map(s => ({
      label: `Season ${s + MADDEN_SEASON}`,
      value: { si: s, t: teamId }
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
            custom_id: "team_season_selector",
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

function getWeekSelection(interaction: MessageComponentInteraction) {
  const customId = interaction.custom_id
  if (customId === "week_selector" || customId === "season_selector") {
    const data = interaction.data as APIMessageStringSelectInteractionData
    if (data.values.length !== 1) {
      throw new Error("Somehow did not receive just one selection from schedule selector " + data.values)
    }
    return JSON.parse(data.values[0]) as WeekSelection
  } else {
    try {
      const parsedId = JSON.parse(customId)
      if (parsedId.wi) {
        return parsedId as WeekSelection
      }
    } catch (e) {
      throw e
    }
  }
}

function getTeamSelection(interaction: MessageComponentInteraction) {
  const customId = interaction.custom_id
  if (customId === "team_season_selector") {
    const data = interaction.data as APIMessageStringSelectInteractionData
    if (data.values.length !== 1) {
      throw new Error("Somehow did not receive just one selection from schedule selector " + data.values)
    }
    return JSON.parse(data.values[0]) as TeamSelection
  } else {
    try {
      const parsedId = JSON.parse(customId)
      if (parsedId.t) {
        return parsedId
      }
    } catch (e) {
      throw e
    }
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
    if (!command.data.options) {
      throw new Error("schedule command not defined properly")
    }
    const options = command.data.options
    const scheduleCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const week = (command.data.options?.[0] as APIApplicationCommandInteractionDataIntegerOption)?.value
    if (scheduleCommand.name === "weekly") {

      if (week && (Number(week) < 1 || Number(week) > 23 || week === 22)) {
        throw new Error("Invalid week number. Valid weeks are week 1-18 and for playoffs: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
      }
      const season = (command.data.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value
      showSchedule(command.token, client, league, week ? Number(week) : undefined, season ? Number(season) : undefined)
      respond(ctx, deferMessage())
    } else if (scheduleCommand.name === "team") {
      if (!scheduleCommand.options || !scheduleCommand.options[0]) {
        throw new Error("teams free misconfigured")
      }
      const teamSearchPhrase = (scheduleCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value.toLowerCase()
      if (!leagueSettings?.commands?.madden_league?.league_id) {
        throw new Error("No Madden league linked, setup the bot with your madden league first.")
      }
      const leagueId = leagueSettings.commands.madden_league.league_id
      const teams = await MaddenClient.getLatestTeams(leagueId)
      const teamsToSearch = await teamSearchView.createView(leagueId)
      if (!teamsToSearch) {
        throw new Error("no teams found")
      }
      const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.9 })
      if (results.length < 1) {
        throw new Error(`Could not find team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs`)
      } else if (results.length > 1) {
        throw new Error(`Found more than one  team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs.Found teams: ${results.map(t => t.obj.displayName).join(", ")}`)
      }
      const foundTeam = results[0].obj
      const teamIdToShowSchedule = teams.getTeamForId(foundTeam.id).teamId

    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "schedule",
      description: "Shows the schedule for the week and season",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "weekly",
          description: "Shows the current weeks schedule",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "week",
              description: "optional week to get the schedule for",
              required: false
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "season",
              description: "optional season to get the schedule for",
              required: false
            }
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "team",
          description: "Shows team's season schedule",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "team",
              description: "Ex: Buccaneers, TB, Tampa Bay, Bucs",
              required: true,
              autocomplete: true
            }
          ]
        },
      ],
      type: ApplicationCommandType.ChatInput,
    }
  },
  async handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient) {
    try {
      const weekSelection = getWeekSelection(interaction)
      const teamSelection = getTeamSelection(interaction)
      if (weekSelection) {
        const { wi: weekIndex, si: seasonIndex } = weekSelection
        const guildId = interaction.guild_id
        const discordLeague = await discordLeagueView.createView(guildId)
        const leagueId = discordLeague?.leagueId
        if (leagueId) {
          showSchedule(interaction.token, client, leagueId, weekIndex + 1, seasonIndex)
        }
      } else if (teamSelection) {
        const { t: team, si: seasonIndex } = teamSelection
        const guildId = interaction.guild_id
        const discordLeague = await discordLeagueView.createView(guildId)
        const leagueId = discordLeague?.leagueId
        if (leagueId) {
          showTeamSchedule(interaction.token, client, leagueId, team, seasonIndex)
        }
      } else {
        throw new Error("has to be week or team")
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
  },
  async choices(command: Autocomplete) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("team command not defined properly")
    }
    const options = command.data.options
    const scheduleCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const view = await discordLeagueView.createView(guild_id)
    const leagueId = view?.leagueId

    if (leagueId && (scheduleCommand?.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.focused && scheduleCommand?.options?.[0]?.value) {
      const teamSearchPhrase = scheduleCommand.options[0].value as string
      const teamsToSearch = await teamSearchView.createView(leagueId)
      if (teamsToSearch) {
        const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.4, limit: 25 })
        return results.map(r => ({ name: r.obj.displayName, value: r.obj.displayName }))
      }
    }
    return []
  }
} as CommandHandler & MessageComponentHandler
