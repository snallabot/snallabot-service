import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, deferMessage } from "../discord_utils"
import { APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataRoleOption, APIApplicationCommandInteractionDataSubcommandOption, APIChannel, APIMessage, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { FieldValue, Firestore } from "firebase-admin/firestore"
import { DiscordIdType, GameChannel, LeagueSettings, MaddenLeagueConfiguration, TeamAssignments, UserId, WeekState } from "../settings_db"
import MaddenClient, { TeamList } from "../../db/madden_db"
import { getMessageForWeek, MaddenGame, Team } from "../../export/madden_league_types"
import createLogger from "../logging"

const SNALLABOT_USER = "970091866450198548"
enum SnallabotReactions {
    SCHEDULE = "SCHEDULE",
    GAME_FINISHED = "GAME_FINISHED",
    FW_HOME = "FORCE_WIN_HOME",
    FW_AWAY = "FORCE_WIN_AWAY",
    FORCE_WIN = "FORCE_WIN"
}

const reactions = {
    [SnallabotReactions.SCHEDULE]: "%E2%8F%B0",
    [SnallabotReactions.GAME_FINISHED]: "%F0%9F%8F%86",
    [SnallabotReactions.FW_HOME]: "%F0%9F%8F%A0",
    [SnallabotReactions.FW_AWAY]: "%F0%9F%9B%AB",
    [SnallabotReactions.FORCE_WIN]: "%E2%8F%AD%EF%B8%8F",
}
async function react(client: DiscordClient, channel: string, message: string, reaction: SnallabotReactions) {
    await client.requestDiscord(`channels/${channel}/messages/${message}/reactions/${reactions[reaction]}/@me`, { method: "PUT" })
}

function notifierMessage(users: string): string {
    return `${users}\nTime to schedule your game! Once your game is scheduled, hit the ⏰. Otherwise, You will be notified again.\nWhen you're done playing, let me know with 🏆.\nNeed to sim this game? React with ⏭ AND the home/away to force win. Choose both home and away to fair sim!`
}

function formatTeamMessageName(discordId: string | undefined, gamerTag: string | undefined) {
    if (discordId) {
        return `<@${discordId}>`
    }
    if (gamerTag) {
        return gamerTag
    }
    return "CPU"
}

function formatScoreboard(week: number, seasonIndex: number, games: MaddenGame[], teams: TeamList, assignments: TeamAssignments) {
    const scoreboardGames = games.sort((g1, g2) => g1.scheduleId - g2.scheduleId).map(game => {
        const awayTeamName = teams.getTeamForId(game.awayTeamId)?.displayName
        const homeTeamName = teams.getTeamForId(game.homeTeamId)?.displayName
        const awayDiscordUser = assignments?.[game.awayTeamId]?.discord_user?.id
        const homeDiscordUser = assignments?.[game.homeTeamId]?.discord_user?.id
        const awayUser = (awayDiscordUser ? `<@${awayDiscordUser}>` : "") || teams.getTeamForId(game.awayTeamId)?.userName || "CPU"
        const homeUser = (homeDiscordUser ? `<@${homeDiscordUser}>` : "") || teams.getTeamForId(game.homeTeamId)?.userName || "CPU"
        const awayTeam = `${awayUser} ${awayTeamName}`
        const homeTeam = `${homeUser} ${homeTeamName}`
        if (game.awayScore == 0 && game.homeScore == 0) {
            return `${awayTeam} vs ${homeTeam}`
        } else {
            if (game.awayScore > game.homeScore) {
                return `**__${awayTeam} ${game.awayScore
                    }__** vs ${game.homeScore} ${homeTeam} FINAL`
            } else if (game.homeScore > game.awayScore) {
                return `${awayTeam} ${game.awayScore
                    } vs **__${game.homeScore} ${homeTeam}__** FINAL`
            }
            return `${awayTeam} ${game.awayScore} vs ${game.homeScore
                } ${homeTeam} FINAL`
        }
    }).join("\n")

    return `# ${seasonIndex + 2024} Season ${getMessageForWeek(week)} Scoreboard\n${scoreboardGames}`
}

async function createGameChannels(client: DiscordClient, db: Firestore, token: string, guild_id: string, settings: LeagueSettings, week: number, category: string, author: UserId) {
    try {
        const leagueId = (settings.commands.madden_league as Required<MaddenLeagueConfiguration>).league_id
        await client.editOriginalInteraction(token, {
            content: `Creating Game Channels:
- <a:snallabot_loading:1288662414191104111> Creating Channels
- <a:snallabot_waiting:1288664321781399584> Creating Notification Messages
- <a:snallabot_waiting:1288664321781399584> Setting up notifier
- <a:snallabot_waiting:1288664321781399584> Creating Scoreboard
- <a:snallabot_waiting:1288664321781399584> Exporting
- <a:snallabot_waiting:1288664321781399584> Logging`})
        let weekSchedule;
        try {
            weekSchedule = (await MaddenClient.getLatestWeekSchedule(leagueId, week)).sort((g, g2) => g.scheduleId - g2.scheduleId)
        } catch (e) {
            await client.editOriginalInteraction(token, {
                content: `Creating Game Channels:
- <a:snallabot_loading:1288662414191104111> Creating Channels, automatically retrieving the week for you! Please wait..
- <a:snallabot_waiting:1288664321781399584> Creating Notification Messages
- <a:snallabot_waiting:1288664321781399584> Setting up notifier
- <a:snallabot_waiting:1288664321781399584> Creating Scoreboard
- <a:snallabot_waiting:1288664321781399584> Exporting
- <a:snallabot_waiting:1288664321781399584> Logging`})
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
                console.error(e)
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
- <a:snallabot_done:1288666730595618868> Creating Channels
- <a:snallabot_waiting:1288664321781399584> Creating Notification Messages
- <a:snallabot_waiting:1288664321781399584> Setting up notifier
- <a:snallabot_waiting:1288664321781399584> Creating Scoreboard
- <a:snallabot_waiting:1288664321781399584> Exporting
- <a:snallabot_waiting:1288664321781399584> Logging`})
        const assignments = settings.commands.teams?.assignments || {}
        const gameChannelsWithMessage = await Promise.all(gameChannels.map(async gameChannel => {
            const channel = gameChannel.channel.id
            const game = gameChannel.game
            const awayUser = formatTeamMessageName(assignments?.[game.awayTeamId]?.discord_user?.id, teams.getTeamForId(game.awayTeamId)?.userName)
            const homeUser = formatTeamMessageName(assignments?.[game.homeTeamId]?.discord_user?.id, teams.getTeamForId(game.homeTeamId)?.userName)
            const res = await client.requestDiscord(`channels/${channel}/messages`, { method: "POST", body: { content: notifierMessage(`${awayUser} at ${homeUser}`) } })
            const message = await res.json() as APIMessage
            return { message: { id: message.id, id_type: DiscordIdType.MESSAGE }, ...gameChannel }
        }))
        await client.editOriginalInteraction(token, {
            content: `Creating Game Channels:
- <a:snallabot_done:1288666730595618868> Creating Channels
- <a:snallabot_done:1288666730595618868> Creating Notification Messages
- <a:snallabot_waiting:1288664321781399584> Setting up notifier
- <a:snallabot_waiting:1288664321781399584> Creating Scoreboard
- <a:snallabot_waiting:1288664321781399584> Exporting
- <a:snallabot_waiting:1288664321781399584> Logging`})
        const finalGameChannels: GameChannel[] = await Promise.all(gameChannelsWithMessage.map(async gameChannel => {
            const { channel: { id: channelId }, message: { id: messageId } } = gameChannel
            await react(client, channelId, messageId, SnallabotReactions.SCHEDULE)
            await react(client, channelId, messageId, SnallabotReactions.GAME_FINISHED)
            await react(client, channelId, messageId, SnallabotReactions.FW_HOME)
            await react(client, channelId, messageId, SnallabotReactions.FW_AWAY)
            await react(client, channelId, messageId, SnallabotReactions.FORCE_WIN)
            const { game, ...rest } = gameChannel
            const createdTime = new Date().getTime()
            return { ...rest, state: "CREATED", notifiedTime: createdTime, channel: { id: channelId, id_type: DiscordIdType.CHANNEL }, message: { id: messageId, id_type: DiscordIdType.MESSAGE } }
        }))
        const channelsMap = {} as { [key: string]: GameChannel }
        finalGameChannels.forEach(g => channelsMap[g.channel.id] = g)
        await client.editOriginalInteraction(token, {
            content: `Creating Game Channels:
- <a:snallabot_done:1288666730595618868> Creating Channels
- <a:snallabot_done:1288666730595618868> Creating Notification Messages
- <a:snallabot_done:1288666730595618868> Setting up notifier
- <a:snallabot_waiting:1288664321781399584> Creating Scoreboard
- <a:snallabot_waiting:1288664321781399584> Exporting
- <a:snallabot_waiting:1288664321781399584> Logging`})

        const season = weekSchedule[0].seasonIndex
        const scoreboardMessage = formatScoreboard(week, season, weekSchedule, teams, assignments)
        const res = await client.requestDiscord(`channels/${settings.commands.game_channel?.scoreboard_channel.id}/messages`, { method: "POST", body: { content: scoreboardMessage, allowed_mentions: { parse: [] } } })
        const message = await res.json() as APIMessage
        const weeklyState: WeekState = { week: week, seasonIndex: season, scoreboard: { id: message.id, id_type: DiscordIdType.MESSAGE }, channel_states: channelsMap }
        const weekKey = `season${season}_week${week}`
        await client.editOriginalInteraction(token, {
            content: `Creating Game Channels:
- <a:snallabot_done:1288666730595618868> Creating Channels
- <a:snallabot_done:1288666730595618868> Creating Notification Messages
- <a:snallabot_done:1288666730595618868> Setting up notifier
- <a:snallabot_done:1288666730595618868> Creating Scoreboard
- <a:snallabot_waiting:1288664321781399584> Exporting
- <a:snallabot_waiting:1288664321781399584> Logging`})
        const eres = await fetch(`https://snallabot.herokuapp.com/${guild_id}/export`, {
            method: "POST",
            body: JSON.stringify({
                week: 102,
                stage: -1,
                auto: true,
            }),
        })
        const exportEmoji = eres.ok ? "<a:snallabot_done:1288666730595618868>" : "<:snallabot_error:1288692698320076820>"
        await client.editOriginalInteraction(token, {
            content: `Creating Game Channels:
- <a:snallabot_done:1288666730595618868> Creating Channels
- <a:snallabot_done:1288666730595618868> Creating Notification Messages
- <a:snallabot_done:1288666730595618868> Setting up notifier
- <a:snallabot_done:1288666730595618868> Creating Scoreboard
- ${exportEmoji} Exporting
- <a:snallabot_waiting:1288664321781399584> Logging`})
        if (settings?.commands?.logger) {
            const logger = createLogger(settings.commands.logger)
            await logger.logUsedCommand("game_channels create", author, client)
        }
        await client.editOriginalInteraction(token, {
            content: `Game Channels Successfully Created :
- <a:snallabot_done:1288666730595618868> Creating Channels
- <a:snallabot_done:1288666730595618868> Creating Notification Messages
- <a:snallabot_done:1288666730595618868> Setting up notifier
- <a:snallabot_done:1288666730595618868> Creating Scoreboard
- ${exportEmoji} Exporting
- <a:snallabot_done:1288666730595618868> Logging`})
        await db.collection("league_settings").doc(guild_id).update({
            [`commands.game_channel.weekly_states.${weekKey}`]: weeklyState
        })
    } catch (e) {
        console.error(e)
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
            await logger.logChannels(channelsToClear, client)
            await logger.logUsedCommand("game_channels clear", author, client)
        } else {
            await Promise.all(channelsToClear.map(async channel => {
                return await client.requestDiscord(`/channels/${channel.id}`, { method: "DELETE" })
            }))
        }
        await client.editOriginalInteraction(token, { content: `Game Channels Cleared` })
    } catch (e) {
        await client.editOriginalInteraction(token, { content: `Game Channels could not be cleared properly, Error: ${e}` })
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
                    const week = (gameChannelsCommand.options[0] as APIApplicationCommandInteractionDataIntegerOption).value
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
                            description: "the week number to clear",
                            required: false,
                        }
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
            ]
        }
    }
} as CommandHandler
