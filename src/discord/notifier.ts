import EventDB, { EventDelivery, SnallabotEvent } from "../db/events_db"
import { DiscordClient, formatTeamMessageName, SnallabotDiscordError, SnallabotReactions } from "./discord_utils"
import LeagueSettingsDB, { ChannelId, GameChannel, GameChannelState, LeagueSettings, MessageId, TeamAssignments, UserId } from "./settings_db"
import createLogger from "./logging"
import MaddenDB from "../db/madden_db"
import { ConfirmedSimV2, SimResult } from "../db/events"
import { ExportContext, Stage, exporterForLeague } from "../dashboard/ea_client"
import { GameResult } from "../export/madden_league_types"

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
      return client.getUsersReacted(`${reaction}`, messageId, channelId)
    } catch (e) {

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
    const game = await MaddenDB.getGameForSchedule(leagueId, gameChannel.scheduleId, week, season)
    const awayTeamId = teams.getTeamForId(game.awayTeamId).teamId
    const homeTeamId = teams.getTeamForId(game.homeTeamId).teamId
    const awayUser = latestAssignents[awayTeamId]?.discord_user
    const homeUser = latestAssignents[homeTeamId]?.discord_user
    const event: SnallabotEvent<ConfirmedSimV2> = { key: leagueId, event_type: "CONFIRMED_SIM", result: result, scheduleId: gameChannel.scheduleId, requestedUsers: requestedUsers, confirmedUsers: confirmedUsers, week: week, seasonIndex: season }
    if (awayUser) {
      event.awayUser = awayUser
    }
    if (homeUser) {
      event.homeUser = homeUser
    }
    await EventDB.appendEvents([event], EventDelivery.EVENT_SOURCE)
  }

  async function gameFinished(reactors: UserId[], gameChannel: GameChannel) {
    try {
      if (settings?.commands?.logger) {
        const logger = createLogger(settings.commands.logger)
        await logger.logChannels([gameChannel.channel], reactors, client)
      } else {
        await client.deleteChannel(gameChannel.channel)
      }
      return true
    } catch (e) {
      if (e instanceof SnallabotDiscordError) {
        if (e.isDeletedChannel()) {
          return true
        }
      }
      return false
    }
  }
  async function deleteTracking(currentState: GameChannel, season: number, week: number) {
    const channelId = currentState.channel
    await LeagueSettingsDB.deleteGameChannel(guildId, week, season, channelId)
  }
  return {
    deleteGameChannel: async function(currentState: GameChannel, season: number, week: number, originators: UserId[]) {
      const result = await gameFinished(originators, currentState)
      if (result) {
        await deleteTracking(currentState, season, week)
      }
    },
    ping: async function(gameChannel: GameChannel, season: number, week: number) {
      const game = await MaddenDB.getGameForSchedule(leagueId, gameChannel.scheduleId, week, season)
      const teams = await MaddenDB.getLatestTeams(leagueId)
      const awayTeam = teams.getTeamForId(game.awayTeamId)
      const homeTeam = teams.getTeamForId(game.homeTeamId)
      const assignments = teams.getLatestTeamAssignments(settings.commands.teams?.assignments || {})
      const awayTag = formatTeamMessageName(assignments[`${awayTeam.teamId}`]?.discord_user?.id, awayTeam.userName)
      const homeTag = formatTeamMessageName(assignments[`${homeTeam.teamId}`]?.discord_user?.id, homeTeam.userName)
      await LeagueSettingsDB.updateGameChannelPingTime(guildId, week, season, gameChannel.channel)
      try {
        await client.createMessage(gameChannel.channel, `${awayTag} ${homeTag} is your game scheduled? Schedule it! or react to my first message to set it as scheduled! Hit the trophy if its done already`, ["users"])
      } catch (e) {
      }
    },
    update: async function(currentState: GameChannel, season: number, week: number) {
      const channelId = currentState.channel
      const messageId = currentState.message
      const messageExists = await client.checkMessageExists(channelId, messageId)
      if (!messageExists) {
        await deleteTracking(currentState, season, week)
        return
      }
      const ggUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.GG)
      const scheduledUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.SCHEDULE)
      const homeUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.HOME)
      const awayUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.AWAY)
      const fwUsers = await getReactedUsers(channelId, messageId, SnallabotReactions.SIM)
      if (ggUsers.length > 0) {
        try {
          const exporter = await exporterForLeague(Number(leagueId), ExportContext.AUTO)
          await exporter.exportSpecificWeeks([{ weekIndex: week - 1, stage: Stage.SEASON }])
        } catch (e) {
        }
        try {
          const game = await MaddenDB.getGameForSchedule(leagueId, currentState.scheduleId, week, season)
          if (game.status !== GameResult.NOT_PLAYED) {
            await this.deleteGameChannel(currentState, season, week, ggUsers)
          }
        } catch (e) {
        }
      }
      if (fwUsers.length > 0) {
        const users = await client.getUsers(guildId)
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

          }
        } else if (currentState.state !== GameChannelState.FORCE_WIN_REQUESTED) {
          const adminRole = settings.commands.game_channel?.admin.id || ""
          const message = `Sim requested <@&${adminRole}> by ${joinUsers(fwUsers)}`
          await LeagueSettingsDB.updateGameChannelState(guildId, week, season, channelId, GameChannelState.FORCE_WIN_REQUESTED)
          try {
            await client.createMessage(channelId, message, ["roles"])
          } catch (e) {
          }
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
