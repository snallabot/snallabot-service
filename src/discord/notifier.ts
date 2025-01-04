import EventDB, { EventDelivery } from "../db/events_db"
import { DiscordClient, SNALLABOT_TEST_USER, SNALLABOT_USER, formatTeamMessageName, createWeekKey } from "./discord_utils"
import { ChannelId, DiscordIdType, GameChannel, GameChannelState, LeagueSettings, MessageId, UserId } from "./settings_db"
import createLogger from "./logging"
import MaddenDB from "../db/madden_db"
import { APIGuildMember, APIUser } from "discord-api-types/v10"
import db from "../db/firebase"
import { FieldValue } from "firebase-admin/firestore"

interface SnallabotNotifier {
    update(currentState: GameChannel, week: number, season: number): Promise<void>
}

enum SimResult {
    FORCE_WIN_AWAY = "FORCE_WIN_AWAY",
    FORCE_WIN_HOME = "FORCE_WIN_HOME",
    FAIR_SIM = "FAIR_SIM"
}

enum Reactions {
    SCHEDULE = "%E2%8F%B0",
    GG = "%F0%9F%8F%86",
    HOME = "%F0%9F%8F%A0",
    AWAY = "%F0%9F%9B%AB",
    SIM = "%E2%8F%AD%EF%B8%8F",
}


function decideResult(homeUsers: UserId[], awayUsers: UserId[]) {
    if (homeUsers.length > 1 && awayUsers.length > 1) {
        return SimResult.FAIR_SIM
    }
    if (homeUsers.length > 1) {
        return SimResult.FORCE_WIN_HOME
    }
    if (awayUsers.length > 1) {
        return SimResult.FORCE_WIN_AWAY
    }
    throw Error("we should not have gotten here!")
}

function joinUsers(users: UserId[]) {
    return users.map((uId) => `<@${uId.id}>`).join("")
}

function createNotifier(client: DiscordClient, guildId: string, settings: LeagueSettings): SnallabotNotifier {
    if (!settings.commands.madden_league?.league_id) {
        throw new Error("somehow channels being pinged without a league id")
    }
    const leagueId = settings.commands.madden_league.league_id
    async function getReactedUsers(channelId: ChannelId, messageId: MessageId, reaction: Reactions): Promise<UserId[]> {
        try {
            const res = await client.requestDiscord(
                `channels/${channelId}/messages/${messageId}/reactions/${reaction}`,
                { method: "GET" }
            )
            const reactedUsers = await res.json() as APIUser[]
            return reactedUsers.filter(u => u.id !== SNALLABOT_USER && u.id !== SNALLABOT_TEST_USER).map(u => ({ id: u.id, id_type: DiscordIdType.USER }))
        } catch (e) {
            console.error(
                `get reaction failed for ${channelId}, ${messageId}, and ${reaction}`
            )
            throw e
        }
    }
    async function forceWin(
        result: SimResult,
        requestedUsers: UserId[],
        confirmedUsers: UserId[],
        gameChannel: GameChannel,
        season: number,
        week: number
    ) {
        if (settings?.commands?.logger) {
            const logger = createLogger(settings.commands.logger)
            await logger.logChannels([gameChannel.channel], requestedUsers.concat(confirmedUsers), client)
        } else {
            await client.requestDiscord(`channels/${gameChannel.channel.id}`, { method: "DELETE" })
        }
        const event = { key: guildId, event_type: "CONFIRMED_SIM", result: SimResult, scheduleId: gameChannel.scheduleId, requestedUsers: requestedUsers, confirmedUsers: confirmedUsers, week: week, seasonIndex: season }
        await EventDB.appendEvents([event], EventDelivery.EVENT_SOURCE)
    }
    async function ping(gameChannel: GameChannel) {
        const game = await MaddenDB.getGameForSchedule(leagueId, gameChannel.scheduleId)
        const teams = await MaddenDB.getLatestTeams(leagueId)
        const awayTeam = game.awayTeamId
        const homeTeam = game.homeTeamId
        const awayTag = formatTeamMessageName(settings.commands.teams?.assignments?.[`${awayTeam}`].discord_user?.id, teams.getTeamForId(awayTeam).userName)
        const homeTag = formatTeamMessageName(settings.commands.teams?.assignments?.[`${homeTeam}`].discord_user?.id, teams.getTeamForId(homeTeam).userName)

        await client.requestDiscord(`channels/${gameChannel}/messages`, {
            method: "POST",
            body: {
                content: `${awayTag}${homeTag} is your game scheduled? Schedule it! or react to my first message to set it as scheduled! Hit the trophy if its done already`,
            },
        })
    }

    async function gameFinished(reactors: UserId[], gameChannel: GameChannel) {
        if (settings?.commands?.logger) {
            const logger = createLogger(settings.commands.logger)
            await logger.logChannels([gameChannel.channel], reactors, client)
        } else {
            await client.requestDiscord(`channels/${gameChannel.channel.id}`, { method: "DELETE" })
        }
        // TODO: replace with new exporter
        await fetch(
            `https://nallapareddy.com/.netlify/functions/snallabot-ea-connector`,
            {
                method: "POST",
                body: JSON.stringify({
                    path: "export",
                    guild: guildId,
                    exporter_body: {
                        week: 101,
                        stage: -1,
                        auto: true,
                    },
                }),
            }
        )
    }
    return {
        update: async function(currentState: GameChannel, season: number, week: number) {
            const channelId = currentState.channel
            const messageId = currentState.message
            const weekKey = createWeekKey(season, week)
            const ggUsers = await getReactedUsers(channelId, messageId, Reactions.GG)
            const scheduledUsers = await getReactedUsers(channelId, messageId, Reactions.SCHEDULE)
            const homeUsers = await getReactedUsers(channelId, messageId, Reactions.HOME)
            const awayUsers = await getReactedUsers(channelId, messageId, Reactions.AWAY)
            const fwUsers = await getReactedUsers(channelId, messageId, Reactions.SIM)
            if (ggUsers.length > 0) {
                await gameFinished(ggUsers, currentState)
                await db.collection("league_settings").doc(guildId).update({
                    [`commands.game_channel.weekly_states.${weekKey}.channel_states.${channelId.id}`]: FieldValue.delete()
                })
            } else if (fwUsers.length > 0) {
                const res = await client.requestDiscord(
                    `guilds/${guildId}/members?limit=1000`,
                    {
                        method: "GET",
                    }
                )
                const users = await res.json() as APIGuildMember[]
                const adminRole = settings.commands.game_channel?.admin.id || ""
                const admins = users.map((u) => ({ id: u.user.id, roles: u.roles })).filter(u => u.roles.includes(adminRole)).map(u => u.id)
                const confirmedUsers = fwUsers.filter(u => admins.includes(u.id))
                if (confirmedUsers.length >= 1) {
                    try {
                        const result = decideResult(homeUsers, awayUsers)
                        const requestedUsers = fwUsers.filter(u => !admins.includes(u.id))
                        await forceWin(result, requestedUsers, confirmedUsers, currentState, season, week)
                        await db.collection("league_settings").doc(guildId).update({
                            [`commands.game_channel.weekly_states.${weekKey}.channel_states.${channelId.id}`]: FieldValue.delete()
                        })
                    } catch (e) {
                        console.warn(`FW requested but no home or away option chosen. Doing nothing ${guildId}, ${channelId.id}: ${e}`)
                    }
                } else if (currentState.state !== GameChannelState.FORCE_WIN_REQUESTED) {
                    const adminRole = settings.commands.game_channel?.admin.id || ""
                    const message = `Sim requested <@&${adminRole}> by ${joinUsers(fwUsers)}`
                    await client.requestDiscord(`channels/${channelId.id}/messages`, {
                        method: "POST",
                        body: {
                            content: message,
                            allowed_mentions: {
                                parse: ["roles"],
                            },
                        },
                    })
                    await db.collection("league_settings").doc(guildId).update({
                        [`commands.game_channel.weekly_states.${weekKey}.channel_states.${channelId}.state`]: GameChannelState.FORCE_WIN_REQUESTED
                    })
                }
            } else if (scheduledUsers.length === 0 && currentState.state !== GameChannelState.FORCE_WIN_REQUESTED) {
                const waitPing = settings.commands.game_channel?.wait_ping || 12
                const now = new Date()
                const last = new Date(currentState.notifiedTime)
                const hoursSince = (now.getTime() - last.getTime()) / 36e5
                if (hoursSince > waitPing) {
                    await ping(currentState)
                    await db.collection("league_settings").doc(guildId).update({
                        [`commands.game_channel.weekly_states.${weekKey}.channel_states.${channelId.id}.notifiedTime`]: new Date().getTime()
                    })
                }
            }
        }
    }
}

export default createNotifier
