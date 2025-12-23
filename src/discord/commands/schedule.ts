import { Command, Autocomplete, MessageComponentInteraction } from "../commands_handler"
import { DiscordClient, deferMessage, formatTeamEmoji, getSimsForWeek, formatSchedule, getSims, createSimMessageForTeam } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, APIMessageStringSelectInteractionData, ApplicationCommandOptionType, ApplicationCommandType, ComponentType, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import { GameResult, MADDEN_SEASON, getMessageForWeek, getMessageForWeekShortened } from "../../export/madden_league_types"
import LeagueSettingsDB from "../settings_db"
import { discordLeagueView, leagueLogosView } from "../../db/view"
import { GameStatsOptions } from "./game_stats"
import fuzzysort from "fuzzysort"
import { ConfirmedSimV2 } from "../../db/events"
import MaddenDB from "../../db/madden_db"

export type WeekSelection = { wi: number, si: number }
export type TeamSelection = { ti: number, si: number }
async function showSchedule(token: string, client: DiscordClient,
  league: string, requestedWeek?: number, requestedSeason?: number) {
  try {
    const settledPromise = await Promise.allSettled([getWeekSchedule(league, requestedWeek != null ? Number(requestedWeek) : undefined, requestedSeason != null ? Number(requestedSeason) : undefined), MaddenDB.getLatestTeams(league)])
    const schedule = settledPromise[0].status === "fulfilled" ? settledPromise[0].value : []
    if (settledPromise[1].status !== "fulfilled") {
      throw new Error("No Teams setup, setup the bot and export")
    }
    const teams = settledPromise[1].value
    const logos = await leagueLogosView.createView(league)
    const sortedSchedule = schedule.sort((a, b) => a.scheduleId - b.scheduleId)
    const season = schedule?.[0]?.seasonIndex >= 0 ? schedule[0].seasonIndex : requestedSeason != null ? requestedSeason : 0
    const week = schedule?.[0]?.weekIndex >= 0 ? schedule[0].weekIndex + 1 : requestedWeek != null ? requestedWeek : 1
    const sims = await getSimsForWeek(league, week, season)
    const message = formatSchedule(week, season, sortedSchedule, teams, sims, logos)
    const gameOptions = sortedSchedule.filter(g => g.status !== GameResult.NOT_PLAYED && g.stageIndex > 0).map(game => ({
      label: `${teams.getTeamForId(game.awayTeamId)?.abbrName} ${game.awayScore} - ${game.homeScore} ${teams.getTeamForId(game.homeTeamId)?.abbrName}`,
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
    const allWeeks = await MaddenDB.getAllWeeks(league)
    if (allWeeks.length === 0) {
      throw new Error(`No Weeks availaible. Try exporting from the dashboard`)
    }
    const weekOptions = allWeeks.filter(ws => ws.seasonIndex === season)
      .map(ws => ws.weekIndex)
      .sort((a, b) => a - b)
      .map(w => ({
        label: `${getMessageForWeek(w + 1)}`,
        value: { wi: w, si: season }
      }))
      .map(option => ({ ...option, value: JSON.stringify(option.value) }))
    const seasonOptions = [...new Set(allWeeks.map(ws => ws.seasonIndex))]
      .sort((a, b) => a - b)
      .map(s => ({
        label: `Season ${s + MADDEN_SEASON}`,
        value: { wi: Math.min(...allWeeks.filter(ws => ws.seasonIndex === s).map(ws => ws.weekIndex) || [0]), si: s }
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
              placeholder: `${getMessageForWeek(week)}`,
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
  } catch (e) {
    console.error(e)
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Failed to show schedule, ${e}`
        }
      ]
    })
  }
}

async function showTeamSchedule(token: string, client: DiscordClient,
  league: string, requestedTeamId: number, requestedSeason?: number) {
  try {
    const settledPromise = await Promise.allSettled([
      MaddenDB.getTeamSchedule(league, requestedSeason),
      MaddenDB.getLatestTeams(league),
      MaddenDB.getAllWeeks(league)
    ])

    const schedule = settledPromise[0].status === "fulfilled" ? settledPromise[0].value : []
    if (settledPromise[1].status !== "fulfilled") {
      throw new Error("No Teams setup, setup the bot and export")
    }
    const teams = settledPromise[1].value
    if (settledPromise[2].status !== "fulfilled") {
      throw new Error("Failed to get all season weeks")
    }
    const allWeeks = settledPromise[2].value
    const teamId = teams.getTeamForId(requestedTeamId).teamId
    const logos = await leagueLogosView.createView(league)

    // Filter schedule to only include games for the specified team
    const teamSchedule = schedule.filter(game => game.awayTeamId !== 0 && game.homeTeamId !== 0).filter(game =>
      teams.getTeamForId(game.awayTeamId).teamId === teamId || teams.getTeamForId(game.homeTeamId).teamId === teamId
    ).sort((a, b) => a.scheduleId - b.scheduleId)


    const selectedTeam = teams.getTeamForId(teamId)
    if (!selectedTeam) {
      throw new Error("Team not found")
    }

    const weekToGameMap = new Map<number, any>()
    teamSchedule.forEach(game => {
      weekToGameMap.set(game.weekIndex + 1, game)
    })
    const season = teamSchedule?.[0]?.seasonIndex >= 0 ? teamSchedule[0].seasonIndex : requestedSeason != null ? requestedSeason : 0
    const sims = await getSims(league, season)
    const scheduleKeys = new Set(
      teamSchedule.map(game => `${game.scheduleId}-${game.seasonIndex}`)
    )

    const teamSims = sims.filter(sim =>
      scheduleKeys.has(`${sim.scheduleId}-${sim.seasonIndex}`)
    )

    const gameToSim = new Map<number, ConfirmedSimV2>()
    teamSims.forEach(sim => gameToSim.set(sim.scheduleId, sim))

    const scheduleLines = []
    const weeksToShow = allWeeks.filter(ws => ws.seasonIndex === season).map(ws => ws.weekIndex + 1).sort((a, b) => a - b)
    for (const week of weeksToShow) {
      const game = weekToGameMap.get(week)

      if (!game && allWeeks.find(ws => ws.weekIndex === week - 1 && ws.seasonIndex === season)) {
        // Only show bye week for regular season weeks (1-18)
        // its only a bye week if that week exists. if it does not, then its just a missing exported week
        if (week <= 18) {
          scheduleLines.push(`**Wk ${week}:** BYE`)
        }
      } else {
        const isTeamAway = teams.getTeamForId(game.awayTeamId).teamId === teamId
        const opponent = teams.getTeamForId(isTeamAway ? game.homeTeamId : game.awayTeamId)
        const opponentDisplay = `${formatTeamEmoji(logos, opponent?.abbrName)} ${opponent?.displayName}`
        const teamDisplay = `${formatTeamEmoji(logos, selectedTeam.abbrName)} ${selectedTeam.displayName}`

        const weekLabel = getMessageForWeekShortened(week)

        if (game.status === GameResult.NOT_PLAYED) {
          scheduleLines.push(`**${weekLabel}:** ${teamDisplay} ${isTeamAway ? '@' : 'vs'} ${opponentDisplay}`)
        } else {
          const teamScore = isTeamAway ? game.awayScore : game.homeScore
          const opponentScore = isTeamAway ? game.homeScore : game.awayScore
          const teamWon = teamScore > opponentScore
          const simMessage = gameToSim.has(game.scheduleId) ? `(${createSimMessageForTeam(gameToSim.get(game.scheduleId)!, game, teamId, teams)})` : ""
          if (teamWon) {
            scheduleLines.push(`**${weekLabel}:** **${teamDisplay} ${teamScore}** ${isTeamAway ? '@' : 'vs'} ${opponentScore} ${opponentDisplay} ${simMessage}`)
          } else if (teamScore < opponentScore) {
            scheduleLines.push(`**${weekLabel}:** ${teamDisplay} ${teamScore} ${isTeamAway ? '@' : 'vs'} **${opponentScore} ${opponentDisplay}** ${simMessage}`)
          } else {
            // Tie game
            scheduleLines.push(`**${weekLabel}:** ${teamDisplay} ${teamScore} ${isTeamAway ? '@' : 'vs'} ${opponentScore} ${opponentDisplay} ${simMessage}`)
          }
        }
      }
    }
    const schedulesMessage = scheduleLines.join("\n")

    const playedGames = teamSchedule.filter(game => game.status !== GameResult.NOT_PLAYED)
    let wins = 0
    let losses = 0
    let ties = 0

    playedGames.forEach(game => {
      const isTeamAway = teams.getTeamForId(game.awayTeamId).teamId === teamId
      const teamScore = isTeamAway ? game.awayScore : game.homeScore
      const opponentScore = isTeamAway ? game.homeScore : game.awayScore

      if (teamScore > opponentScore) {
        wins++
      } else if (teamScore < opponentScore) {
        losses++
      } else {
        ties++
      }
    })

    const recordText = playedGames.length > 0 ?
      ties > 0 ? ` (${wins}-${losses}-${ties})` : ` (${wins}-${losses})` : ""
    const message = `# ${selectedTeam.displayName} ${MADDEN_SEASON + season} Season Schedule${recordText}\n${schedulesMessage}`

    const gameOptions = teamSchedule.filter(g => g.status !== GameResult.NOT_PLAYED).sort((a, b) => a.weekIndex - b.weekIndex).map(game => {
      const isTeamAway = game.awayTeamId === teamId
      const opponent = teams.getTeamForId(isTeamAway ? game.homeTeamId : game.awayTeamId)
      const teamScore = isTeamAway ? game.awayScore : game.homeScore
      const opponentScore = isTeamAway ? game.homeScore : game.awayScore

      return {
        label: `${selectedTeam.abbrName} ${teamScore} - ${opponentScore} ${opponent?.abbrName}`,
        value: { w: game.weekIndex, s: game.seasonIndex, c: game.scheduleId, o: GameStatsOptions.OVERVIEW, b: { ti: teamId, si: season } }
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
    const seasonOptions = [...new Set(allWeeks.map(ws => ws.seasonIndex))]
      .sort((a, b) => a - b)
      .map(s => ({
        label: `Season ${s + MADDEN_SEASON}`,
        value: { si: s, ti: teamId }
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
  } catch (e) {
    console.error(e)
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Failed to show schedule, ${e}`
        }
      ]
    })
  }

}

async function getWeekSchedule(league: string, week?: number, season?: number) {
  if (season != null) {
    if (week != null) {
      const seasonIndex = season < 100 ? season : season - MADDEN_SEASON
      return await MaddenDB.getWeekScheduleForSeason(league, week, seasonIndex)
    }
    throw new Error("If you specified Season please also specify the week")
  } else if (week) {
    return await MaddenDB.getLatestWeekSchedule(league, week)
  } else {
    return await MaddenDB.getLatestSchedule(league)
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
      if (parsedId.wi != null) {
        return parsedId as WeekSelection
      }
    } catch (e) {
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
      if (parsedId.ti != null) {
        return parsedId
      }
    } catch (e) {
    }
  }
}


export default {
  async handleCommand(command: Command, client: DiscordClient) {
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
    if (scheduleCommand.name === "weekly") {
      const week = (scheduleCommand.options?.[0] as APIApplicationCommandInteractionDataIntegerOption)?.value
      if (week != null && (Number(week) < 1 || Number(week) > 23 || week === 22)) {
        throw new Error("Invalid week number. Valid weeks are week 1-18 and for playoffs: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
      }
      const season = (scheduleCommand.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value
      showSchedule(command.token, client, league, week != null ? Number(week) : undefined, season != null ? Number(season) : undefined)
      return deferMessage()
    } else if (scheduleCommand.name === "team") {
      if (!scheduleCommand.options || !scheduleCommand.options[0]) {
        throw new Error("teams free misconfigured")
      }
      const teamSearchPhrase = (scheduleCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value.toLowerCase()
      if (!leagueSettings?.commands?.madden_league?.league_id) {
        throw new Error("No Madden league linked, setup the bot with your madden league first.")
      }
      const leagueId = leagueSettings.commands.madden_league.league_id
      const season = (scheduleCommand.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value
      const teams = await MaddenDB.getLatestTeams(leagueId)
      const results = fuzzysort.go(teamSearchPhrase, teams.getLatestTeams(), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.9 })
      if (results.length < 1) {
        throw new Error(`Could not find team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs`)
      } else if (results.length > 1) {
        throw new Error(`Found more than one  team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs.Found teams: ${results.map(t => t.obj.displayName).join(", ")}`)
      }
      const foundTeam = results[0].obj
      const teamIdToShowSchedule = teams.getTeamForId(foundTeam.teamId).teamId
      showTeamSchedule(command.token, client, leagueId, teamIdToShowSchedule, season ? Number(season) : undefined)
      return deferMessage()
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
              type: ApplicationCommandOptionType.String,
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
        const { ti: team, si: seasonIndex } = teamSelection
        const guildId = interaction.guild_id
        const discordLeague = await discordLeagueView.createView(guildId)
        const leagueId = discordLeague?.leagueId
        if (leagueId) {
          showTeamSchedule(interaction.token, client, leagueId, team, seasonIndex)
        }
      }
    } catch (e) {
      console.error(e)
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
      const teamsToSearch = await MaddenDB.getLatestTeams(leagueId)
      if (teamsToSearch) {
        const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.4, limit: 25 })
        return results.map(r => ({ name: r.obj.displayName, value: r.obj.displayName }))
      }
    }
    return []
  }
}
