import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, deferMessage, formatTeamMessageName, createWeekKey, SnallabotReactions } from "../discord_utils"
import { APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataRoleOption, APIApplicationCommandInteractionDataSubcommandOption, APIChannel, APIMessage, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { DiscordIdType, GameChannel, GameChannelState, LeagueSettings, MaddenLeagueConfiguration, RoleId, UserId, WeekState } from "../settings_db"
import MaddenClient, { TeamList } from "../../db/madden_db"
import { formatRecord, getMessageForWeek, MaddenGame } from "../../export/madden_league_types"
import createLogger from "../logging"
import { ConfirmedSim, SimResult } from "../../db/events"
import createNotifier from "../notifier"
import { ExportContext, exporterForLeague } from "../../dashboard/ea_client"

async function react(client: DiscordClient, channel: string, message: string, reaction: SnallabotReactions) {
  await client.requestDiscord(`channels/${channel}/messages/${message}/reactions/${reaction}/@me`, { method: "PUT" })
}

function notifierMessage(users: string, waitPing: number, role: RoleId): string {
  return `${users}\nTime to schedule your game! Once your game is scheduled, hit the ⏰. Otherwise, You will be notified again every ${waitPing} hours.\nWhen you're done playing, let me know with 🏆 and I will clean up the channel.\nNeed to sim this game? React with ⏭ AND the home/away request a force win from <@&${role.id}>. Choose both home and away to fair sim! <@&${role.id}> hit the ⏭ to confirm it!`
}

function createSimMessage(sim: ConfirmedSim): string {
  if (sim.result === SimResult.FAIR_SIM) {
    return "Fair Sim"
  } else if (sim.result === SimResult.FORCE_WIN_AWAY) {
    return "Force Win Away"
  } else if (sim.result === SimResult.FORCE_WIN_HOME) {
    return "Force Win Home"
  }
  throw new Error("Should not have gotten here! from createSimMessage")
}


export function formatScoreboard(week: number, seasonIndex: number, games: MaddenGame[], teams: TeamList, sims: ConfirmedSim[], leagueId: string) {
  const gameToSim = new Map<number, ConfirmedSim>()
  sims.filter(s => s.leagueId ? s.leagueId === leagueId : true).forEach(sim => gameToSim.set(sim.scheduleId, sim))
  const scoreboardGames = games.sort((g1, g2) => g1.scheduleId - g2.scheduleId).map(game => {
    const simMessage = gameToSim.has(game.scheduleId) ? ` (${createSimMessage(gameToSim.get(game.scheduleId)!)})` : ""
    const awayTeamName = teams.getTeamForId(game.awayTeamId)?.displayName
    const homeTeamName = teams.getTeamForId(game.homeTeamId)?.displayName
    const awayTeam = `${awayTeamName}`
    const homeTeam = `${homeTeamName}`
    if (game.awayScore == 0 && game.homeScore == 0) {
      return `${awayTeam} vs ${homeTeam}${simMessage}`
    } else {
      if (game.awayScore > game.homeScore) {
        return `**${awayTeam} ${game.awayScore
          }** vs ${game.homeScore} ${homeTeam}${simMessage}`
      } else if (game.homeScore > game.awayScore) {
        return `${awayTeam} ${game.awayScore
          } vs **${game.homeScore} ${homeTeam}**${simMessage}`
      }
      return `${awayTeam} ${game.awayScore} vs ${game.homeScore
        } ${homeTeam}${simMessage}`
    }
  }).join("\n")

  return `# ${seasonIndex + 2024} Season ${getMessageForWeek(week)} Scoreboard\n${scoreboardGames}`
}

enum SnallabotCommandReactions {
  LOADING = "<a:snallabot_loading:1288662414191104111>",
  WAITING = "<a:snallabot_waiting:1288664321781399584>",
  FINISHED = "<a:snallabot_done:1288666730595618868>",
  ERROR = "<:snallabot_error:1288692698320076820>"
}

async function createGameChannels(client: DiscordClient, db: Firestore, token: string, guild_id: string, settings: LeagueSettings, week: number, category: string, author: UserId) {
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
    try {
      const exporter = await exporterForLeague(Number(leagueId), ExportContext.AUTO)
      await exporter.exportSurroundingWeek()
    } catch (e) {
      exportEmoji = SnallabotCommandReactions.ERROR
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
      await fetch(`https://snallabot.herokuapp.com/${guild_id}/export`, {
        method: "POST",
        body: JSON.stringify({
          week: week,
          stage: 1,
        }),
      })
      try {
        weekSchedule = (await MaddenClient.getLatestWeekSchedule(leagueId, week)).sort((g, g2) => g.scheduleId - g2.scheduleId)
      } catch (e) {
        await client.editOriginalInteraction(token, { content: "This week is not exported! Export it via dashboard or companion app" })
        return
      }
    }

    const teams = await MaddenClient.getLatestTeams(leagueId)
    const gameChannels = await Promise.all(weekSchedule.map(async game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId)?.displayName
      const homeTeam = teams.getTeamForId(game.homeTeamId)?.displayName
      const res = await client.requestDiscord(`guilds/${guild_id}/channels`, {
        method: "POST",
        body: {
          type: 0,
          name: `${awayTeam}-at-${homeTeam}`,
          parent_id: category,
        },
      })
      const channel = await res.json() as APIChannel
      return { game: game, scheduleId: game.scheduleId, channel: { id: channel.id, id_type: DiscordIdType.CHANNEL } }
    }))
    await client.editOriginalInteraction(token, {
      content: `Creating Game Channels:
- ${exportEmoji} Exporting
- ${SnallabotCommandReactions.FINISHED} Creating Channels
- ${SnallabotCommandReactions.LOADING} Creating Notification Messages
- ${SnallabotCommandReactions.WAITING} Setting up notifier
- ${SnallabotCommandReactions.WAITING} Creating Scoreboard
- ${SnallabotCommandReactions.WAITING} Logging`
    })
    const assignments = teams.getLatestTeamAssignments(settings.commands.teams?.assignments || {})
    if (!settings.commands.game_channel) {
      return
    }
    const waitPing = settings.commands.game_channel.wait_ping || 12
    const role = settings.commands.game_channel.admin
    const gameChannelsWithMessage = await Promise.all(gameChannels.map(async gameChannel => {
      const channel = gameChannel.channel.id
      const game = gameChannel.game
      const awayTeamId = teams.getTeamForId(game.awayTeamId).teamId
      const homeTeamId = teams.getTeamForId(game.homeTeamId).teamId
      const awayUser = formatTeamMessageName(assignments?.[awayTeamId]?.discord_user?.id, teams.getTeamForId(game.awayTeamId)?.userName)
      const homeUser = formatTeamMessageName(assignments?.[game.homeTeamId]?.discord_user?.id, teams.getTeamForId(game.homeTeamId)?.userName)
      const awayTeamStanding = await MaddenClient.getStandingForTeam(leagueId, awayTeamId)
      const homeTeamStanding = await MaddenClient.getStandingForTeam(leagueId, homeTeamId)
      const usersMessage = `${awayUser} (${formatRecord(awayTeamStanding)}) at ${homeUser} (${formatRecord(homeTeamStanding)})`
      const res = await client.requestDiscord(`channels/${channel}/messages`, { method: "POST", body: { content: notifierMessage(usersMessage, waitPing, role), allowed_mentions: { parse: ["users"] } } })
      const message = await res.json() as APIMessage
      return { message: { id: message.id, id_type: DiscordIdType.MESSAGE }, ...gameChannel }
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
      const { channel: { id: channelId }, message: { id: messageId } } = gameChannel
      await react(client, channelId, messageId, SnallabotReactions.SCHEDULE)
      await react(client, channelId, messageId, SnallabotReactions.GG)
      await react(client, channelId, messageId, SnallabotReactions.HOME)
      await react(client, channelId, messageId, SnallabotReactions.AWAY)
      await react(client, channelId, messageId, SnallabotReactions.SIM)
      const { game, ...rest } = gameChannel
      const createdTime = new Date().getTime()
      return { ...rest, state: GameChannelState.CREATED, notifiedTime: createdTime, channel: { id: channelId, id_type: DiscordIdType.CHANNEL }, message: { id: messageId, id_type: DiscordIdType.MESSAGE } }
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
    const scoreboardMessage = formatScoreboard(week, season, weekSchedule, teams, [], leagueId)
    const res = await client.requestDiscord(`channels/${settings.commands.game_channel?.scoreboard_channel.id}/messages`, { method: "POST", body: { content: scoreboardMessage, allowed_mentions: { parse: [] } } })
    const message = await res.json() as APIMessage
    const weeklyState: WeekState = { week: week, seasonIndex: season, scoreboard: { id: message.id, id_type: DiscordIdType.MESSAGE }, channel_states: channelsMap }
    const weekKey = createWeekKey(season, week)
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
- ${SnallabotCommandReactions.FINISHED} Logging`
    })
    await db.collection("league_settings").doc(guild_id).update({
      [`commands.game_channel.weekly_states.${weekKey}`]: weeklyState
    })
  } catch (e) {
    await client.editOriginalInteraction(token, { content: `Game Channels Create Failed with Error: ${e}` })
  }
}

async function clearGameChannels(client: DiscordClient, db: Firestore, token: string, guild_id: string, settings: LeagueSettings, author: UserId) {
  try {
    await client.editOriginalInteraction(token, { content: `Clearing Game Channels...` })
    const weekStates = settings.commands.game_channel?.weekly_states || {}
    const channelsToClear = Object.entries(weekStates).flatMap(entry => {
      const weekState = entry[1]
      return Object.values(weekState.channel_states)
    }).map(channelStates => {
      return channelStates.channel
    })
    await Promise.all(Object.keys(weekStates).map(async weekKey => {
      db.collection("league_settings").doc(guild_id).update({
        [`commands.game_channel.weekly_states.${weekKey}.channel_states`]: []
      })
    }))
    if (settings.commands.logger?.channel) {
      await client.editOriginalInteraction(token, { content: `Logging Game Channels...` })
      const logger = createLogger(settings.commands.logger)
      await logger.logChannels(channelsToClear, [author], client)
      await logger.logUsedCommand("game_channels clear", author, client)
    } else {
      await Promise.all(channelsToClear.map(async channel => {
        return await client.requestDiscord(`/channels/${channel.id}`, { method: "DELETE" })
      }))
    }
    await client.editOriginalInteraction(token, { content: `Game Channels Cleared` })
  } catch (e) {
    await client.editOriginalInteraction(token, { content: `Game Channels could not be cleared properly, if all game channels are deleted, this is safe to ignore. If you still have game channels, delete them manually. Error: ${e}` })
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
      return await Promise.all(Object.values(weekState.channel_states).map(async channel => {
        await notifier.ping(channel, season, week)
      }))
    }))
    await client.editOriginalInteraction(token, { content: `Game Channels Notified` })
  } catch (e) {
    await client.editOriginalInteraction(token, { content: `Game Channels could not be notified properly Error: ${e}` })
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id, token, member } = command
    const author: UserId = { id: member.user.id, id_type: DiscordIdType.USER }
    if (!command.data.options) {
      throw new Error("game channels command not defined properly")
    }
    const options = command.data.options
    const gameChannelsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = gameChannelsCommand.name
    const doc = await db.collection("league_settings").doc(guild_id).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    if (subCommand === "configure") {
      if (!gameChannelsCommand.options || !gameChannelsCommand.options[0] || !gameChannelsCommand.options[1] || !gameChannelsCommand.options[2] || !gameChannelsCommand.options[3]) {
        throw new Error("game_channels configure command misconfigured")
      }
      const gameChannelCategory = (gameChannelsCommand.options[0] as APIApplicationCommandInteractionDataChannelOption).value
      const scoreboardChannel = (gameChannelsCommand.options[1] as APIApplicationCommandInteractionDataChannelOption).value
      const waitPing = (gameChannelsCommand.options[2] as APIApplicationCommandInteractionDataIntegerOption).value
      const adminRole = (gameChannelsCommand.options[3] as APIApplicationCommandInteractionDataRoleOption).value
      await db.collection("league_settings").doc(guild_id).set({
        commands: {
          game_channel: {
            admin: { id: adminRole, id_type: DiscordIdType.ROLE },
            default_category: { id: gameChannelCategory, id_type: DiscordIdType.CATEGORY },
            scoreboard_channel: { id: scoreboardChannel, id_type: DiscordIdType.CHANNEL },
            wait_ping: waitPing,
            weekly_states: leagueSettings?.commands?.game_channel?.weekly_states || {}
          }
        }
      }, { merge: true })
      respond(ctx, createMessageResponse(`game channels commands are configured! Configuration:

- Admin Role: <@&${adminRole}>
- Game Channel Category: <#${gameChannelCategory}>
- Scoreboard Channel: <#${scoreboardChannel}>
- Notification Period: Every ${waitPing} hour(s)`))
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
      if (!leagueSettings.commands.game_channel?.scoreboard_channel) {
        throw new Error("Game channels are not configured! run /game_channels configure first")
      }
      if (!leagueSettings.commands.madden_league?.league_id) {
        throw new Error("No madden league linked. Setup snallabot with your Madden league first")
      }
      const category = categoryOverride ? categoryOverride : leagueSettings.commands.game_channel.default_category.id
      respond(ctx, deferMessage())
      createGameChannels(client, db, token, guild_id, leagueSettings, week, category, author)
    } else if (subCommand === "clear") {
      respond(ctx, deferMessage())
      clearGameChannels(client, db, token, guild_id, leagueSettings, author)
    } else if (subCommand === "notify") {
      respond(ctx, deferMessage())
      notifyGameChannels(client, token, guild_id, leagueSettings)
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
} as CommandHandler
