import EventDB, { EventDelivery, SnallabotEvent } from "../db/events_db"
import { DiscordClient, SNALLABOT_TEST_USER, SNALLABOT_USER, formatTeamMessageName, createWeekKey, SnallabotReactions } from "./discord_utils"
import { ChannelId, DiscordIdType, GameChannel, GameChannelState, LeagueSettings, MessageId, TeamAssignments, UserId } from "./settings_db"
import createLogger from "./logging"
import MaddenDB from "../db/madden_db"
import { APIGuildMember, APIUser } from "discord-api-types/v10"
import db from "../db/firebase"
import { FieldValue } from "firebase-admin/firestore"
import { ConfirmedSim, SimResult } from "../db/events"

interface SnallabotNotifier {
  update(currentState: GameChannel, season: number, week: number,): Promise<void>
  deleteGameChannel(currentState: GameChannel, season: number, week: number, origin: UserId[]): Promise<void>
  ping(currentState: GameChannel, season: number, week: number): Promise<void>
}



function decideResult(homeUsers: UserId[], awayUsers: UserId[]) {
  if (homeUsers.length > 0 && awayUsers.length > 0) {
    return SimResult.FAIR_SIM
  }
  if (homeUsers.length > 0) {
    return SimResult.FORCE_WIN_HOME
  }
  if (awayUsers.length > 0) {
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
  async function getReactedUsers(channelId: ChannelId, messageId: MessageId, reaction: SnallabotReactions): Promise<UserId[]> {
    try {
      const res = await client.requestDiscord(
        `channels/${channelId.id}/messages/${messageId.id}/reactions/${reaction}`,
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
    const assignments = settings.commands.teams?.assignments || {} as TeamAssignments
    const leagueId = settings.commands.madden_league?.league_id
    if (!leagueId) {
      return
    }
    const teams = await MaddenDB.getLatestTeams(leagueId)
    const latestAssignents = teams.getLatestTeamAssignments(assignments)
    const game = await MaddenDB.getGameForSchedule(leagueId, gameChannel.scheduleId)
    const awayTeamId = teams.getTeamForId(game.awayTeamId).teamId
    const homeTeamId = teams.getTeamForId(game.homeTeamId).teamId
    const awayUser = latestAssignents[awayTeamId]?.discord_user
    const homeUser = latestAssignents[homeTeamId]?.discord_user
    const event: SnallabotEvent<ConfirmedSim> = { key: guildId, event_type: "CONFIRMED_SIM", result: result, scheduleId: gameChannel.scheduleId, requestedUsers: requestedUsers, confirmedUsers: confirmedUsers, week: week, seasonIndex: season, leagueId: leagueId }
    if (awayUser) {
      event.awayUser = awayUser
    }
    if (homeUser) {
      event.homeUser = homeUser
    }
    await EventDB.appendEvents([event], EventDelivery.EVENT_SOURCE)
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
    deleteGameChannel: async function(currentState: GameChannel, season: number, week: number, originators: UserId[]) {
      const channelId = currentState.channel
      const weekKey = createWeekKey(season, week)
      await db.collection("league_settings").doc(guildId).update({
        [`commands.game_channel.weekly_states.${weekKey}.channel_states.${channelId.id}`]: FieldValue.delete()
      })
      await gameFinished(originators, currentState)
    },
    ping: async function ping(gameChannel: GameChannel, season: number, week: number) {
      const game = await MaddenDB.getGameForSchedule(leagueId, gameChannel.scheduleId)
      const teams = await MaddenDB.getLatestTeams(leagueId)
      const awayTeam = game.awayTeamId
      const homeTeam = game.homeTeamId
      const awayTag = formatTeamMessageName(settings.commands.teams?.assignments?.[`${awayTeam}`]?.discord_user?.id, teams.getTeamForId(awayTeam).userName)
      const homeTag = formatTeamMessageName(settings.commands.teams?.assignments?.[`${homeTeam}`]?.discord_user?.id, teams.getTeamForId(homeTeam).userName)
      const weekKey = createWeekKey(season, week)
      await db.collection("league_settings").doc(guildId).update({
        [`commands.game_channel.weekly_states.${weekKey}.channel_states.${gameChannel.channel.id}.notifiedTime`]: new Date().getTime()
      })
      await client.requestDiscord(`channels/${gameChannel.channel.id}/messages`, {
        method: "POST",
        body: {
          content: `${awayTag} ${homeTag} is your game scheduled? Schedule it! or react to my first message to set it as scheduled! Hit the trophy if its done already`,
        },
      })
    },
    update: async function(currentState: GameChannel, season: number, week: number) {
      const channelId = currentState.channel
      const messageId = currentState.message
      try {
        await client.requestDiscord(`channels/${channelId.id}`, {
          method: "GET",
        })
        await client.requestDiscord(`channels/${channelId.id}/messages/${messageId.id}`, {
          method: "GET",
        })
      } catch (e) {
        console.warn("could not update channel or message " + e)
        return
      }
      const weekKey = createWeekKey(season, week)
      const ggUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.GG)
      const scheduledUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.SCHEDULE)
      const homeUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.HOME)
      const awayUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.AWAY)
      const fwUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.SIM)
      if (ggUsers.length > 0) {
        await this.deleteGameChannel(currentState, season, week, ggUsers)
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
            await this.deleteGameChannel(currentState, season, week, requestedUsers.concat(confirmedUsers))
          } catch (e) {
            console.warn(`FW requested but no home or away option chosen. Doing nothing ${guildId}, ${channelId.id}: ${e}`)
          }
        } else if (currentState.state !== GameChannelState.FORCE_WIN_REQUESTED) {
          const adminRole = settings.commands.game_channel?.admin.id || ""
          const message = `Sim requested <@&${adminRole}> by ${joinUsers(fwUsers)}`
          await db.collection("league_settings").doc(guildId).update({
            [`commands.game_channel.weekly_states.${weekKey}.channel_states.${channelId.id}.state`]: GameChannelState.FORCE_WIN_REQUESTED
          })
          await client.requestDiscord(`channels/${channelId.id}/messages`, {
            method: "POST",
            body: {
              content: message,
              allowed_mentions: {
                parse: ["roles"],
              },
            },
          })
        }
      } else if (scheduledUsers.length === 0 && currentState.state !== GameChannelState.FORCE_WIN_REQUESTED) {
        const waitPing = settings.commands.game_channel?.wait_ping || 12
        const now = new Date()
        const last = new Date(currentState.notifiedTime)
        const hoursSince = (now.getTime() - last.getTime()) / 36e5
        if (hoursSince > waitPing) {
          await this.ping(currentState, season, week)
        }
      }
    }
  }
}

export default createNotifier
