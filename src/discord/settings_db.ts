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
export type TradeConfiguration = {
  channel: ChannelId;
  tradeCommitteeRole: RoleId;
  requiredApprovals: number;
  acceptedChannel?: ChannelId;
  declinedChannel?: ChannelId;
};

export type StoredLeagueSettings = {
  commands: {
    logger?: LoggerConfiguration,
    game_channel?: GameChannelConfiguration,
    stream_count?: StreamCountConfiguration,
    broadcast?: BroadcastConfiguration,
    teams?: TeamConfiguration,
    waitlist?: WaitlistConfiguration,
    madden_league?: MaddenLeagueConfiguration,
    player?: PlayerConfiguration,
    trade?: TradeConfiguration
  },
  guildId: string
}

interface LeagueSettings {
  get(): Promise<StoredLeagueSettings>,
  guildId(): string,
  configureLogger(loggerSettings: LoggerConfiguration): Promise<void>,
  removeLogger(): Promise<void>,
  configureBroadcast(broadcastSettings: BroadcastConfiguration): Promise<void>,
  configureGameChannel(gameChannelSettings: GameChannelConfiguration): Promise<void>,
  deleteGameChannels(entries: [WeekState, GameChannel][]): Promise<void>,
  updateGameWeekState(week: number, season: number, weekState: WeekState): Promise<void>,
  deleteGameChannel(week: number, season: number, channel: ChannelId): Promise<void>,
  updateGameChannelPingTime(week: number, season: number, channel: ChannelId): Promise<void>,
  updateGameChannelState(week: number, season: number, channel: ChannelId, state: GameChannelState): Promise<void>
  connectMaddenLeagueId(leagueId: string): Promise<void>,
  getMaddenLeagueId(): Promise<string | undefined>,
  disconnectMaddenLeagueId(): Promise<void>,
  configureWaitlist(waitlistSettings: WaitlistConfiguration): Promise<void>,
  updateStreamCountConfiguration(streamCountSettings: StreamCountConfiguration): Promise<void>,
  updateTeamConfiguration(teamSettings: TeamConfiguration): Promise<void>,
  updateAssignmentUser(teamId: string | number, user: UserId): Promise<void>,
  updateAssignment(assignments: TeamAssignments): Promise<void>,
  removeAssignment(teamId: number | string): Promise<void>,
  removeAllAssignments(): Promise<void>,
  configurePlayer(playerConfiguration: PlayerConfiguration): Promise<void>,
  configureTrade(tradeConfiguration: TradeConfiguration): Promise<void>
}

interface LeagueSettingsDB {
  getAllLeagueSettings(): Promise<LeagueSettings[]>,
  getLeagueSettings(guildId: string): LeagueSettings,
  getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]>,
  deleteLeagueSetting(guildId: string): Promise<void>,
}

function createLeagueSettingForGuild(guildId: string, data?: StoredLeagueSettings): LeagueSettings {
  const doc = db.collection('league_settings').doc(guildId)
  return {
    async get(): Promise<StoredLeagueSettings> {
      if (data) {
        return data
      }
      const docData = await doc.get()
      if (docData.exists) {
        return { guildId: docData.id, ...docData.data() } as StoredLeagueSettings
      } else {
        return { commands: {}, guildId: guildId }
      }
    },
    guildId() {
      return guildId
    },
    async configureLogger(loggerSettings: LoggerConfiguration): Promise<void> {
      await doc.set({
        commands: {
          logger: loggerSettings
        },
      }, { merge: true })
    },

    async removeLogger(): Promise<void> {
      await doc.update({
        'commands.logger': FieldValue.delete()
      })
    },

    async configureBroadcast(broadcastSettings: BroadcastConfiguration): Promise<void> {
      await doc.set({
        commands: {
          broadcast: broadcastSettings
        }
      }, { merge: true })
    },

    async configureGameChannel(gameChannelSettings: GameChannelConfiguration): Promise<void> {
      await doc.set({
        commands: {
          game_channel: gameChannelSettings
        }
      }, { merge: true })
    },

    async deleteGameChannels(entries: [WeekState, GameChannel][]): Promise<void> {
      if (entries.length > 0) {
        await doc.update(
          Object.fromEntries(entries.map(e => {
            const seasonWeekKey = createWeekKey(e[0].seasonIndex, e[0].week)
            return [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${e[1].channel.id}`, FieldValue.delete()]
          }))
        )
      }
    },

    async updateGameWeekState(week: number, season: number, weekState: WeekState): Promise<void> {
      const seasonWeekKey = createWeekKey(season, week)
      await doc.set({
        commands: {
          game_channel: {
            weekly_states: {
              [seasonWeekKey]: weekState
            }
          }
        }
      }, { merge: true })
    },

    async deleteGameChannel(week: number, season: number, channel: ChannelId): Promise<void> {
      const seasonWeekKey = createWeekKey(season, week)
      const channelKey = channel.id
      await doc.update({
        [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channelKey}`]: FieldValue.delete()
      })
    },

    async updateGameChannelPingTime(week: number, season: number, channel: ChannelId): Promise<void> {
      const seasonWeekKey = createWeekKey(season, week)
      const channelKey = channel.id
      await doc.update({
        [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channelKey}.notifiedTime`]: new Date().getTime()
      })
    },

    async updateGameChannelState(week: number, season: number, channel: ChannelId, state: GameChannelState): Promise<void> {
      const seasonWeekKey = createWeekKey(season, week)
      const channelKey = channel.id
      await doc.update({
        [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channelKey}.state`]: state
      })
    },
    async connectMaddenLeagueId(leagueId: string) {
      await db.collection("league_settings").doc(guildId).set(
        { commands: { madden_league: { league_id: leagueId } } }, { merge: true }
      )
    },
    async getMaddenLeagueId(): Promise<string | undefined> {
      const data = await this.get()
      return data.commands.madden_league?.league_id
    },

    async disconnectMaddenLeagueId(): Promise<void> {
      await doc.update({
        'commands.madden_league': FieldValue.delete()
      })
    },

    async configureWaitlist(waitlistSettings: WaitlistConfiguration): Promise<void> {
      await doc.set({
        commands: {
          waitlist: waitlistSettings
        },
        guildId
      }, { merge: true })
    },

    async updateStreamCountConfiguration(streamCountSettings: StreamCountConfiguration): Promise<void> {
      await doc.set({
        commands: {
          stream_count: streamCountSettings
        },
        guildId
      }, { merge: true })
    },

    async updateTeamConfiguration(teamSettings: TeamConfiguration): Promise<void> {
      await doc.set({
        commands: {
          teams: teamSettings
        },
        guildId
      }, { merge: true })
    },
    async updateAssignmentUser(teamId: string | number, user: UserId): Promise<void> {
      await doc.update({
        [`commands.teams.assignments.${teamId}.discord_user`]: user
      })
    },
    async updateAssignment(assignments: TeamAssignments): Promise<void> {
      await doc.update({
        'commands.teams.assignments': assignments
      })
    },

    async removeAssignment(teamId: number | string): Promise<void> {
      await doc.update({
        [`commands.teams.assignments.${teamId}`]: FieldValue.delete()
      })
    },

    async removeAllAssignments(): Promise<void> {
      await doc.update({
        'commands.teams.assignments': {}
      })
    },
    async configurePlayer(configuration: PlayerConfiguration) {
      await doc.set({
        commands: {
          player: configuration
        },
      }, { merge: true })
    },
    async configureTrade(configuration: TradeConfiguration) {
      await doc.set({
        commands: { trade: configuration },
      }, { merge: true })
    }
  }
}

export function createWeekKey(season: number, week: number) {
  return `season${String(season).padStart(2, '0')}_week${String(week).padStart(2, '0')}`
}

const LeagueSettingsDB: LeagueSettingsDB = {
  async getAllLeagueSettings(): Promise<LeagueSettings[]> {
    const snapshot = await db.collection('league_settings').get()
    return snapshot.docs.map(doc => createLeagueSettingForGuild(doc.id, { guildId: doc.id, ...doc.data() } as StoredLeagueSettings))
  },
  getLeagueSettings(guildId: string): LeagueSettings {
    return createLeagueSettingForGuild(guildId)
  },
  async deleteLeagueSetting(guildId: string): Promise<void> {
    await db.collection('league_settings').doc(guildId).delete()
  },
  async getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]> {
    const snapshot = await db.collection('league_settings')
      .where('commands.madden_league.league_id', '==', leagueId)
      .get()
    return snapshot.docs.map(doc => createLeagueSettingForGuild(doc.id, { guildId: doc.id, ...doc.data() } as StoredLeagueSettings))
  }
}

export default LeagueSettingsDB
