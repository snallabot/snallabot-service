import { Command } from "../commands_handler"
import { createMessageResponse, DiscordClient, deferMessage, formatTeamMessageName, SnallabotReactions, SnallabotDiscordError, formatSchedule, NoConnectedLeagueError, SnallabotCommandReactions } from "../discord_utils"
import { APIApplicationCommandInteractionDataBooleanOption, APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataRoleOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import LeagueSettingsDB, { CategoryId, ChannelId, DiscordIdType, GameChannel, GameChannelConfiguration, GameChannelState, LeagueSettings, MaddenLeagueConfiguration, MessageId, RoleId, UserId, WeekState } from "../settings_db"
import MaddenClient from "../../db/madden_db"
import { formatRecord } from "../../export/madden_league_types"
import createLogger from "../logging"
import createNotifier from "../notifier"
import { ExportContext, Stage, exporterForLeague, EAAccountError } from "../../dashboard/ea_client"
import { leagueLogosView } from "../../db/view"

async function react(client: DiscordClient, channel: ChannelId, message: MessageId, reaction: SnallabotReactions) {
  await client.reactToMessage(`${reaction}`, message, channel)
}

function notifierMessage(users: string, waitPing: number, role: RoleId): string {
  return `${users}\nTime to schedule your game! Once your game is scheduled, hit the ⏰. Otherwise, You will be notified again every ${waitPing} hours.\nWhen you're done playing, let me know with 🏆 and I will clean up the channel.\nNeed to sim this game? React with ⏭ AND the home/away request a force win from <@&${role.id}>. Choose both home and away to fair sim! <@&${role.id}> hit the ⏭ to confirm it!`
}


async function createGameChannels(client: DiscordClient, token: string, guild_id: string, settings: LeagueSettings, week: number, category: CategoryId, author: UserId) {
  let channelsToCleanup: ChannelId[] = []
  try {
    const leagueId = (settings.commands.madden_league as Required<MaddenLeagueConfiguration>).league_id
    await client.editOriginalInteraction(token, {
      content: `Creating Game Channels:
- ${SnallabotCommandReactions.LOADING} Exporting
- ${SnallabotCommandReactions.WAITING} Creating Channels
- ${SnallabotCommandReactions.WAITING} Creating Notification Messages
- ${SnallabotCommandReactions.WAITING} Setting up notifier
- ${SnallabotCommandReactions.WAITING} Creating Scoreboard
- ${SnallabotCommandReactions.WAITING} Logging`
    })
    let exportEmoji = SnallabotCommandReactions.FINISHED
    let errorMessage = ""
    try {
      const exporter = exporterForLeague(Number(leagueId), ExportContext.AUTO)
      const { waitUntilDone } = exporter.exportSurroundingWeek()
      await waitUntilDone
    } catch (e) {
      exportEmoji = SnallabotCommandReactions.ERROR
      if (e instanceof EAAccountError) {
        errorMessage = `Export Failed with: EA Error ${e.message} Guidance: ${e.troubleshoot}`
      } else {
        errorMessage = `Export Failed with: ${e}`
      }
    }
    await client.editOriginalInteraction(token, {
      content: `Creating Game Channels:
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.LOADING} Creating Channels
- ${SnallabotCommandReactions.WAITING} Creating Notification Messages
- ${SnallabotCommandReactions.WAITING} Setting up notifier
- ${SnallabotCommandReactions.WAITING} Creating Scoreboard
- ${SnallabotCommandReactions.WAITING} Logging`
    })
    let weekSchedule;
    try {
      weekSchedule = (await MaddenClient.getLatestWeekSchedule(leagueId, week)).sort((g, g2) => g.scheduleId - g2.scheduleId)
    } catch (e) {
      await client.editOriginalInteraction(token, {
        content: `Creating Game Channels:
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.LOADING} Creating Channels, automatically retrieving the week for you! Please wait..
- ${SnallabotCommandReactions.WAITING} Creating Notification Messages
- ${SnallabotCommandReactions.WAITING} Setting up notifier
- ${SnallabotCommandReactions.WAITING} Creating Scoreboard
- ${SnallabotCommandReactions.WAITING} Logging`
      })
      try {
        const exporter = exporterForLeague(Number(leagueId), ExportContext.AUTO)
        const { waitUntilDone } = exporter.exportSpecificWeeks([{ weekIndex: week, stage: Stage.SEASON }])
        await waitUntilDone
          .catch(e => { throw e })
        weekSchedule = (await MaddenClient.getLatestWeekSchedule(leagueId, week)).sort((g, g2) => g.scheduleId - g2.scheduleId)
      } catch (e) {
        await client.editOriginalInteraction(token, { content: `Could not retrieve this weeks schedule ${e}` })
        return
      }
    }
    const teams = await MaddenClient.getLatestTeams(leagueId)
    const assignments = teams.getLatestTeamAssignments(settings.commands.teams?.assignments || {})
    const gameChannels = []
    for (const game of weekSchedule) {
      const awayTeam = teams.getTeamForId(game.awayTeamId)
      const homeTeam = teams.getTeamForId(game.homeTeamId)
      let channel;
      if (settings.commands.game_channel?.private_channels) {
        const users: UserId[] = [assignments?.[awayTeam.teamId]?.discord_user, assignments?.[homeTeam.teamId]?.discord_user]
          .flatMap(u => u ? [u] : [])
        channel = await client.createChannel(guild_id, `${awayTeam.displayName}-at-${homeTeam.displayName}`, category, users, [settings.commands.game_channel.admin])
      } else {
        channel = await client.createChannel(guild_id, `${awayTeam.displayName}-at-${homeTeam.displayName}`, category,)
      }
      gameChannels.push({ game: game, scheduleId: game.scheduleId, channel: channel })
    }
    channelsToCleanup = gameChannels.map(c => c.channel)
    await client.editOriginalInteraction(token, {
      content: `Creating Game Channels:
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.FINISHED} Creating Channels
- ${SnallabotCommandReactions.LOADING} Creating Notification Messages
- ${SnallabotCommandReactions.WAITING} Setting up notifier
- ${SnallabotCommandReactions.WAITING} Creating Scoreboard
- ${SnallabotCommandReactions.WAITING} Logging`
    })
    if (!settings.commands.game_channel) {
      return
    }
    const waitPing = settings.commands.game_channel.wait_ping || 12
    const role = settings.commands.game_channel.admin
    const gameChannelsWithMessage = await Promise.all(gameChannels.map(async gameChannel => {
      const channel = gameChannel.channel
      const game = gameChannel.game
      const awayTeamId = teams.getTeamForId(game.awayTeamId).teamId
      const homeTeamId = teams.getTeamForId(game.homeTeamId).teamId
      const awayUser = formatTeamMessageName(assignments?.[awayTeamId]?.discord_user?.id, teams.getTeamForId(game.awayTeamId)?.userName)
      const homeUser = formatTeamMessageName(assignments?.[homeTeamId]?.discord_user?.id, teams.getTeamForId(game.homeTeamId)?.userName)
      const awayTeamStanding = await MaddenClient.getStandingForTeam(leagueId, awayTeamId)
      const homeTeamStanding = await MaddenClient.getStandingForTeam(leagueId, homeTeamId)
      const usersMessage = `${awayUser} (${formatRecord(awayTeamStanding)}) at ${homeUser} (${formatRecord(homeTeamStanding)})`
      const message = await client.createMessage(channel, notifierMessage(usersMessage, waitPing, role), ["users"])
      return { message: message, ...gameChannel }
    }))
    await client.editOriginalInteraction(token, {
      content: `Creating Game Channels:
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.FINISHED} Creating Channels
- ${SnallabotCommandReactions.FINISHED} Creating Notification Messages
- ${SnallabotCommandReactions.LOADING} Setting up notifier
- ${SnallabotCommandReactions.WAITING} Creating Scoreboard
- ${SnallabotCommandReactions.WAITING} Logging`
    })
    const finalGameChannels: GameChannel[] = await Promise.all(gameChannelsWithMessage.map(async gameChannel => {
      const { channel: channel, message: message } = gameChannel
      await react(client, channel, message, SnallabotReactions.SCHEDULE)
      await react(client, channel, message, SnallabotReactions.GG)
      await react(client, channel, message, SnallabotReactions.HOME)
      await react(client, channel, message, SnallabotReactions.AWAY)
      await react(client, channel, message, SnallabotReactions.SIM)
      const { game, ...rest } = gameChannel
      const createdTime = new Date().getTime()
      return { ...rest, state: GameChannelState.CREATED, notifiedTime: createdTime, channel: channel, message: message }
    }))
    const channelsMap = {} as { [key: string]: GameChannel }
    finalGameChannels.forEach(g => channelsMap[g.channel.id] = g)
    await client.editOriginalInteraction(token, {
      content: `Creating Game Channels:
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.FINISHED} Creating Channels
- ${SnallabotCommandReactions.FINISHED} Creating Notification Messages
- ${SnallabotCommandReactions.FINISHED} Setting up notifier
- ${SnallabotCommandReactions.LOADING} Creating Scoreboard
- ${SnallabotCommandReactions.WAITING} Logging`
    })

    const season = weekSchedule[0].seasonIndex
    const logos = await leagueLogosView.createView(leagueId)
    const scoreboardMessage = formatSchedule(week, season, weekSchedule, teams, [], logos)
    const scoreboardMessageId = await client.createMessage(settings.commands.game_channel?.scoreboard_channel, scoreboardMessage, [])
    const weeklyState: WeekState = { week: week, seasonIndex: season, scoreboard: scoreboardMessageId, channel_states: channelsMap }
    await client.editOriginalInteraction(token, {
      content: `Creating Game Channels:
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.FINISHED} Creating Channels
- ${SnallabotCommandReactions.FINISHED} Creating Notification Messages
- ${SnallabotCommandReactions.FINISHED} Setting up notifier
- ${SnallabotCommandReactions.FINISHED} Creating Scoreboard
- ${SnallabotCommandReactions.LOADING} Logging`
    })
    if (settings?.commands?.logger) {
      const logger = createLogger(settings.commands.logger)
      await logger.logUsedCommand("game_channels create", author, client)
    }
    await client.editOriginalInteraction(token, {
      content: `Game Channels Successfully Created :
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.FINISHED} Creating Channels
- ${SnallabotCommandReactions.FINISHED} Creating Notification Messages
- ${SnallabotCommandReactions.FINISHED} Setting up notifier
- ${SnallabotCommandReactions.FINISHED} Creating Scoreboard
- ${SnallabotCommandReactions.FINISHED} Logging
${errorMessage}
`
    })
    await LeagueSettingsDB.updateGameWeekState(guild_id, week, season, weeklyState)
  } catch (e) {
    try {
      await Promise.all(channelsToCleanup.map(async channel => {
        await client.deleteChannel(channel)
      }))
    } catch (e) {
    }
    if (e instanceof SnallabotDiscordError) {
      await client.editOriginalInteraction(token, { content: `Game Channels Create Failed with Error: ${e} Guidance: ${e.guidance}` })
    } else {
      await client.editOriginalInteraction(token, { content: `Game Channels Create Failed with Error: ${e}` })
    }
  }
}

async function clearGameChannels(client: DiscordClient, token: string, guild_id: string, settings: LeagueSettings, author: UserId, weekToClear?: number) {
  try {
    await client.editOriginalInteraction(token, { content: `Clearing Game Channels...` })
    const weekStates = settings.commands.game_channel?.weekly_states || {}
    const weekStatesWithChannels = Object.fromEntries(Object.entries(weekStates).filter(entry => {
      const weekState = entry[1]
      if (weekToClear) {
        return weekState?.channel_states && weekState.week === weekToClear
      }
      return weekState?.channel_states
    }))
    const channelsToClear = Object.entries(weekStatesWithChannels).flatMap(entry => {
      const weekState = entry[1]
      return Object.values(weekState?.channel_states || {})
    }).flatMap(channelStates => {
      return channelStates.channel ? [channelStates.channel] : []
    })
    if (settings.commands.logger?.channel) {
      await client.editOriginalInteraction(token, { content: `Logging Game Channels...` })
      const logger = createLogger(settings.commands.logger)
      await logger.logChannels(channelsToClear, [author], client)
      await logger.logUsedCommand("game_channels clear", author, client)
    } else {
      await Promise.all(channelsToClear.map(async channel => {
        try {
          return await client.deleteChannel(channel)
        } catch (e) {
          if (e instanceof SnallabotDiscordError) {
            if (e.isDeletedChannel()) {
              return
            }
          }
          throw e
        }
      }))
    }
    await Promise.all(Object.values(weekStatesWithChannels).map(async weekState => {
      await LeagueSettingsDB.deleteGameChannels(guild_id, weekState.week, weekState.seasonIndex)
    }))
    await client.editOriginalInteraction(token, { content: `Game Channels Cleared` })
  } catch (e) {
    console.error(e)
    await client.editOriginalInteraction(token, { content: `Game Channels could not be cleared properly . Error: ${e}` })
  }
}

async function notifyGameChannels(client: DiscordClient, token: string, guild_id: string, settings: LeagueSettings) {
  try {
    await client.editOriginalInteraction(token, { content: `Notifying Game Channels...` })
    const weekStates = settings.commands.game_channel?.weekly_states || {}
    const notifier = createNotifier(client, guild_id, settings)
    await Promise.all(Object.entries(weekStates).map(async entry => {
      const weekState = entry[1]
      const season = weekState.seasonIndex
      const week = weekState.week
      return await Promise.all(Object.values(weekState?.channel_states || {}).map(async channel => {
        await notifier.ping(channel, season, week)
      }))
    }))
    await client.editOriginalInteraction(token, { content: `Game Channels Notified` })
  } catch (e) {
    await client.editOriginalInteraction(token, { content: `Game Channels could not be notified properly Error: ${e}` })
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id, token, member } = command
    const author: UserId = { id: member.user.id, id_type: DiscordIdType.USER }
    if (!command.data.options) {
      throw new Error("game channels command not defined properly")
    }
    const options = command.data.options
    const gameChannelsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = gameChannelsCommand.name
    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(guild_id)
    if (subCommand === "configure") {
      if (!gameChannelsCommand.options || !gameChannelsCommand.options[0] || !gameChannelsCommand.options[1] || !gameChannelsCommand.options[2] || !gameChannelsCommand.options[3]) {
        throw new Error("game_channels configure command misconfigured")
      }
      const gameChannelCategory = (gameChannelsCommand.options[0] as APIApplicationCommandInteractionDataChannelOption).value
      const scoreboardChannel = (gameChannelsCommand.options[1] as APIApplicationCommandInteractionDataChannelOption).value
      const waitPing = (gameChannelsCommand.options[2] as APIApplicationCommandInteractionDataIntegerOption).value
      const adminRole = (gameChannelsCommand.options[3] as APIApplicationCommandInteractionDataRoleOption).value
      const usePrivateChannels = (gameChannelsCommand?.options?.[4] as APIApplicationCommandInteractionDataBooleanOption)?.value
      const conf: GameChannelConfiguration = {
        admin: { id: adminRole, id_type: DiscordIdType.ROLE },
        default_category: { id: gameChannelCategory, id_type: DiscordIdType.CATEGORY },
        scoreboard_channel: { id: scoreboardChannel, id_type: DiscordIdType.CHANNEL },
        wait_ping: Number.parseInt(`${waitPing}`),
        weekly_states: leagueSettings?.commands?.game_channel?.weekly_states || {},
        private_channels: !!usePrivateChannels
      }
      await LeagueSettingsDB.configureGameChannel(guild_id, conf)
      return createMessageResponse(`game channels commands are configured! Configuration:

- Admin Role: <@&${adminRole}>
- Game Channel Category: <#${gameChannelCategory}>
- Scoreboard Channel: <#${scoreboardChannel}>
- Notification Period: Every ${waitPing} hour(s)
- Private Channels: ${!!usePrivateChannels ? "Yes" : "No"}`)
    } else if (subCommand === "create" || subCommand === "wildcard" || subCommand === "divisional" || subCommand === "conference" || subCommand === "superbowl") {
      const week = (() => {
        if (subCommand === "create") {
          if (!gameChannelsCommand.options || !gameChannelsCommand.options[0]) {
            throw new Error("game_channels create command misconfigured")
          }
          const week = Number((gameChannelsCommand.options[0] as APIApplicationCommandInteractionDataIntegerOption).value)
          if (week < 1 || week > 23 || week === 22) {
            throw new Error("Invalid week number. Valid weeks are week 1-18 and use specific playoff commands or playoff week numbers: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
          }
          return week
        }
        if (subCommand === "wildcard") {
          return 19
        }
        if (subCommand === "divisional") {
          return 20
        }
        if (subCommand === "conference") {
          return 21
        }
        if (subCommand === "superbowl") {
          return 23
        }
      })()
      if (!week) {
        throw new Error("Invalid Week found " + week)
      }
      const categoryOverride = (() => {
        if (subCommand === "create") {
          return (gameChannelsCommand.options?.[1] as APIApplicationCommandInteractionDataChannelOption)?.value
        } else {
          return (gameChannelsCommand.options?.[0] as APIApplicationCommandInteractionDataChannelOption)?.value
        }
      })()
      if (!leagueSettings.commands?.game_channel?.scoreboard_channel) {
        throw new Error("Game channels are not configured! run /game_channels configure first")
      }
      if (!leagueSettings.commands?.madden_league?.league_id) {
        throw new NoConnectedLeagueError(guild_id)
      }
      const category = categoryOverride ? categoryOverride : leagueSettings.commands.game_channel.default_category.id
      createGameChannels(client, token, guild_id, leagueSettings, week, { id: category, id_type: DiscordIdType.CATEGORY }, author)
      return deferMessage()
    } else if (subCommand === "clear") {
      const gameChannelsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
      const gameChannelWeekToClear = (gameChannelsCommand?.options?.[0] as APIApplicationCommandInteractionDataIntegerOption)?.value
      const weekToClear = gameChannelWeekToClear ? Number(gameChannelWeekToClear) : undefined
      clearGameChannels(client, token, guild_id, leagueSettings, author, weekToClear)
      return deferMessage()
    } else if (subCommand === "notify") {
      notifyGameChannels(client, token, guild_id, leagueSettings)
      return deferMessage()
    } else {
      throw new Error(`game_channels ${subCommand} not implemented`)
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "game_channels",
      description: "handles Snallabot game channels",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "create",
          description: "create game channels",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "week",
              description: "the week number to create for",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Channel,
              name: "category_override",
              description: "overrides the category to create channels in",
              channel_types: [ChannelType.GuildCategory],
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "wildcard",
          description: "creates wildcard week game channels",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "category_override",
              description: "overrides the category to create channels in",
              channel_types: [ChannelType.GuildCategory],
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "divisional",
          description: "creates divisional week game channels",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "category_override",
              description: "overrides the category to create channels in",
              channel_types: [ChannelType.GuildCategory],
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "conference",
          description: "creates conference championship week game channels",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "category_override",
              description: "overrides the category to create channels in",
              channel_types: [ChannelType.GuildCategory],
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "superbowl",
          description: "creates superbowl week game channels",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "category_override",
              description: "overrides the category to create channels in",
              channel_types: [ChannelType.GuildCategory],
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "clear",
          description: "clear all game channels",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "week",
              description: "optional week to clear",
              required: false,
            },
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "sets up game channels",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "category",
              description: "category to create channels under",
              required: true,
              channel_types: [ChannelType.GuildCategory],
            },
            {
              type: ApplicationCommandOptionType.Channel,
              name: "scoreboard_channel",
              description: "channel to post scoreboard",
              required: true,
              channel_types: [0],
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "notification_period",
              description: "number of hours to wait before notifying unscheduled games",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Role,
              name: "admin_role",
              description: "admin role to confirm force wins",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Boolean,
              name: "private_channels",
              description: "make game channels private to users and admins",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "notify",
          description: "notifies all remaining game channels",
          options: [
          ]
        },
      ]
    }
  }
}
