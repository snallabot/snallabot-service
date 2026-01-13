import db from "../db/firebase"
import { FieldValue } from "firebase-admin/firestore"

export enum DiscordIdType {
  ROLE = "ROLE",
  CHANNEL = "CHANNEL",
  CATEGORY = "CATEGORY",
  USER = "USER",
  GUILD = "GUILD",
  MESSAGE = "MESSAGE"
}
type DiscordId = { id: string, id_type: DiscordIdType }
export type ChannelId = { id: string, id_type: DiscordIdType.CHANNEL }
export type RoleId = { id: string, id_type: DiscordIdType.ROLE }
export type CategoryId = { id: string, id_type: DiscordIdType.CATEGORY }
export type MessageId = { id: string, id_type: DiscordIdType.MESSAGE }
export type UserId = { id: string, id_type: DiscordIdType.USER }
export type LoggerConfiguration = { channel: ChannelId }
export type WaitlistConfiguration = { current_waitlist: UserId[] }
export type MaddenLeagueConfiguration = { league_id: string }
export type BroadcastConfiguration = { role?: RoleId, channel: ChannelId, title_keyword: string }
export enum GameChannelState {
  CREATED = "CREATED",
  FORCE_WIN_REQUESTED = "FORCE_WIN_REQUESTED"
}
export type GameChannel = { channel: ChannelId, message: MessageId, scheduleId: number, state: GameChannelState, notifiedTime: number }
export type ChannelIdKey = string
export type WeekState = { week: number, seasonIndex: number, scoreboard: MessageId, channel_states: { [key: ChannelIdKey]: GameChannel } }
type SeasonWeekIndex = string
export type GameChannelConfiguration = { admin: RoleId, default_category: CategoryId, scoreboard_channel: ChannelId, wait_ping: number, private_channels?: boolean, weekly_states: { [key: SeasonWeekIndex]: WeekState } }

export type UserStreamCount = { user: UserId, count: number }
export type StreamCountConfiguration = { channel: ChannelId, message: MessageId, counts: UserStreamCount[] }

export type TeamAssignment = { discord_user?: UserId, discord_role?: RoleId }
export type TeamAssignments = { [key: string]: TeamAssignment }
export type TeamConfiguration = { channel: ChannelId, messageId: MessageId, useRoleUpdates: boolean, assignments: TeamAssignments }
export type PlayerConfiguration = { useHiddenDevs: boolean }

export type LeagueSettings = {
  commands: {
    logger?: LoggerConfiguration,
    game_channel?: GameChannelConfiguration,
    stream_count?: StreamCountConfiguration,
    broadcast?: BroadcastConfiguration,
    teams?: TeamConfiguration,
    waitlist?: WaitlistConfiguration,
    madden_league?: MaddenLeagueConfiguration,
    player?: PlayerConfiguration
  },
  guildId: string
}

interface LeagueSettingsDB {
  getAllLeagueSettings(): Promise<LeagueSettings[]>,
  getLeagueSettings(guildId: string): Promise<LeagueSettings>,
  configureLogger(guildId: string, loggerSettings: LoggerConfiguration): Promise<void>,
  removeLogger(guildId: string): Promise<void>,
  configureBroadcast(guildId: string, broadcastSettings: BroadcastConfiguration): Promise<void>,
  configureGameChannel(guildId: string, gameChannelSettings: GameChannelConfiguration): Promise<void>,
  deleteGameChannels(guildId: string, week: number, season: number): Promise<void>,
  updateGameWeekState(guildId: string, week: number, season: number, weekState: WeekState): Promise<void>,
  deleteGameChannel(guildId: string, week: number, season: number, channel: ChannelId): Promise<void>,
  updateGameChannelPingTime(guildId: string, week: number, season: number, channel: ChannelId): Promise<void>,
  updateGameChannelState(guildId: string, week: number, season: number, channel: ChannelId, state: GameChannelState): Promise<void>
  connectMaddenLeagueId(guildId: string, leagueId: string): Promise<void>,
  getMaddenLeagueId(guildId: string): Promise<string | undefined>,
  disconnectMaddenLeagueId(guildId: string): Promise<void>,
  configureWaitlist(guildId: string, waitlistSettings: WaitlistConfiguration): Promise<void>,
  updateStreamCountConfiguration(guildId: string, streamCountSettings: StreamCountConfiguration): Promise<void>,
  updateTeamConfiguration(guildId: string, teamSettings: TeamConfiguration): Promise<void>,
  updateAssignmentUser(guildId: string, teamId: string | number, user: UserId): Promise<void>,
  updateAssignment(guildId: string, assignments: TeamAssignments): Promise<void>,
  removeAssignment(guildId: string, teamId: number | string): Promise<void>,
  removeAllAssignments(guildId: string): Promise<void>,
  getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]>,
  deleteLeagueSetting(guildId: string): Promise<void>,
  configurePlayer(guildId: string, playerConfiguration: PlayerConfiguration): Promise<void>
}

export function createWeekKey(season: number, week: number) {
  return `season${String(season).padStart(2, '0')}_week${String(week).padStart(2, '0')}`
}

const LeagueSettingsDB: LeagueSettingsDB = {
  async getAllLeagueSettings(): Promise<LeagueSettings[]> {
    const snapshot = await db.collection('league_settings').get()
    return snapshot.docs.map(doc => ({ guildId: doc.id, ...doc.data() } as LeagueSettings))
  },
  async getLeagueSettings(guildId: string): Promise<LeagueSettings> {
    const doc = await db.collection('league_settings').doc(guildId).get()
    if (!doc.exists) {
      // Return default settings if none exist
      return {
        commands: {},
        guildId
      }
    }
    return { guildId: doc.id, ...doc.data() } as LeagueSettings
  },

  async configureLogger(guildId: string, loggerSettings: LoggerConfiguration): Promise<void> {
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        logger: loggerSettings
      },
    }, { merge: true })
  },

  async removeLogger(guildId: string): Promise<void> {
    await db.collection('league_settings').doc(guildId).update({
      'commands.logger': FieldValue.delete()
    })
  },

  async configureBroadcast(guildId: string, broadcastSettings: BroadcastConfiguration): Promise<void> {
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        broadcast: broadcastSettings
      }
    }, { merge: true })
  },

  async configureGameChannel(guildId: string, gameChannelSettings: GameChannelConfiguration): Promise<void> {
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        game_channel: gameChannelSettings
      }
    }, { merge: true })
  },

  async deleteGameChannels(guildId: string, week: number, season: number): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    await db.collection('league_settings').doc(guildId).update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states`]: FieldValue.delete()
    })
  },

  async updateGameWeekState(guildId: string, week: number, season: number, weekState: WeekState): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    await db.collection('league_settings').doc(guildId).update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}`]: weekState
    })
  },

  async deleteGameChannel(guildId: string, week: number, season: number, channel: ChannelId): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const channelKey = channel.id
    await db.collection('league_settings').doc(guildId).update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channelKey}`]: FieldValue.delete()
    })
  },

  async updateGameChannelPingTime(guildId: string, week: number, season: number, channel: ChannelId): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const channelKey = channel.id
    await db.collection('league_settings').doc(guildId).update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channelKey}.notifiedTime`]: new Date().getTime()
    })
  },

  async updateGameChannelState(guildId: string, week: number, season: number, channel: ChannelId, state: GameChannelState): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const channelKey = channel.id
    await db.collection('league_settings').doc(guildId).update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channelKey}.state`]: state
    })
  },
  async connectMaddenLeagueId(guildId: string, leagueId: string) {
    await db.collection("league_settings").doc(guildId).set(
      { commands: { madden_league: { league_id: leagueId } } }, { merge: true }
    )
  },
  async getMaddenLeagueId(guildId: string): Promise<string | undefined> {
    const doc = await db.collection('league_settings').doc(guildId).get()
    if (!doc.exists) {
      return undefined
    }
    const data = doc.data() as LeagueSettings
    return data.commands.madden_league?.league_id
  },

  async disconnectMaddenLeagueId(guildId: string): Promise<void> {
    await db.collection('league_settings').doc(guildId).update({
      'commands.madden_league': FieldValue.delete()
    })
  },

  async configureWaitlist(guildId: string, waitlistSettings: WaitlistConfiguration): Promise<void> {
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        waitlist: waitlistSettings
      },
      guildId
    }, { merge: true })
  },

  async updateStreamCountConfiguration(guildId: string, streamCountSettings: StreamCountConfiguration): Promise<void> {
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        stream_count: streamCountSettings
      },
      guildId
    }, { merge: true })
  },

  async updateTeamConfiguration(guildId: string, teamSettings: TeamConfiguration): Promise<void> {
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        teams: teamSettings
      },
      guildId
    }, { merge: true })
  },
  async updateAssignmentUser(guildId: string, teamId: string | number, user: UserId): Promise<void> {
    await db.collection('league_settings').doc(guildId).update({
      [`commands.teams.assignments.${teamId}.discord_user`]: user
    })
  },
  async updateAssignment(guildId: string, assignments: TeamAssignments): Promise<void> {
    await db.collection('league_settings').doc(guildId).update({
      'commands.teams.assignments': assignments
    })
  },

  async removeAssignment(guildId: string, teamId: number | string): Promise<void> {
    await db.collection('league_settings').doc(guildId).update({
      [`commands.teams.assignments.${teamId}`]: FieldValue.delete()
    })
  },

  async removeAllAssignments(guildId: string): Promise<void> {
    await db.collection('league_settings').doc(guildId).update({
      'commands.teams.assignments': {}
    })
  },

  async getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]> {
    const snapshot = await db.collection('league_settings')
      .where('commands.madden_league.league_id', '==', leagueId)
      .get()
    return snapshot.docs.map(doc => ({ guildId: doc.id, ...doc.data() }) as LeagueSettings)
  },
  async deleteLeagueSetting(guildId: string): Promise<void> {
    await db.collection('league_settings').doc(guildId).delete()
  },
  async configurePlayer(guildId: string, configuration: PlayerConfiguration) {
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        player: configuration
      },
    }, { merge: true })
  }
}

export default LeagueSettingsDB
