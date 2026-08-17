import db from "../db/firebase"
import { FieldValue } from "firebase-admin/firestore"
import { selectedLeagueForGuild } from "./league_context"

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
// league_id remains the active/default league for backwards compatibility with
// commands and existing Firestore documents. league_ids contains every league
// connected to the guild.
export type MaddenLeagueConfiguration = { league_id: string, league_ids?: string[], league_names?: Record<string, string> }
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
    team_leagues?: Record<string, TeamConfiguration>,
    waitlist?: WaitlistConfiguration,
    madden_league?: MaddenLeagueConfiguration,
    player?: PlayerConfiguration
    league_commands?: Record<string, {
      logger?: LoggerConfiguration,
      game_channel?: GameChannelConfiguration,
      stream_count?: StreamCountConfiguration,
      broadcast?: BroadcastConfiguration,
      waitlist?: WaitlistConfiguration,
      player?: PlayerConfiguration
    }>
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
  deleteGameChannels(guildId: string, entries: [WeekState, GameChannel][]): Promise<void>,
  updateGameWeekState(guildId: string, week: number, season: number, weekState: WeekState): Promise<void>,
  deleteGameChannel(guildId: string, week: number, season: number, channel: ChannelId): Promise<void>,
  updateGameChannelPingTime(guildId: string, week: number, season: number, channel: ChannelId): Promise<void>,
  updateGameChannelState(guildId: string, week: number, season: number, channel: ChannelId, state: GameChannelState): Promise<void>
  connectMaddenLeagueId(guildId: string, leagueId: string, leagueName?: string): Promise<void>,
  setActiveMaddenLeagueId(guildId: string, leagueId: string): Promise<void>,
  getMaddenLeagueId(guildId: string): Promise<string | undefined>,
  getMaddenLeagueIds(guildId: string): Promise<string[]>,
  getMaddenLeagueNames(guildId: string): Promise<Record<string, string>>,
  disconnectMaddenLeagueId(guildId: string, leagueId?: string): Promise<void>,
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
    const settings = { guildId: doc.id, ...doc.data() } as LeagueSettings
    const selectedLeague = selectedLeagueForGuild(guildId)
    if (selectedLeague && settings.commands.madden_league) {
      const defaultLeague = settings.commands.madden_league.league_id
      const selectedCommands = settings.commands.league_commands?.[selectedLeague] || {}
      const legacyCommands = selectedLeague === defaultLeague ? settings.commands : {}
      const selectedTeams = settings.commands.team_leagues?.[selectedLeague]
        || (selectedLeague === defaultLeague ? settings.commands.teams : undefined)
      return {
        ...settings,
        commands: {
          ...settings.commands,
          logger: selectedCommands.logger || legacyCommands.logger,
          game_channel: selectedCommands.game_channel || legacyCommands.game_channel,
          stream_count: selectedCommands.stream_count || legacyCommands.stream_count,
          broadcast: selectedCommands.broadcast || legacyCommands.broadcast,
          waitlist: selectedCommands.waitlist || legacyCommands.waitlist,
          player: selectedCommands.player || legacyCommands.player,
          madden_league: { ...settings.commands.madden_league, league_id: selectedLeague },
          teams: selectedTeams
        }
      }
    }
    return settings
  },

  async configureLogger(guildId: string, loggerSettings: LoggerConfiguration): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const path = leagueId ? `commands.league_commands.${leagueId}.logger` : 'commands.logger'
    await db.collection('league_settings').doc(guildId).update({ [path]: loggerSettings })
  },

  async removeLogger(guildId: string): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const path = leagueId ? `commands.league_commands.${leagueId}.logger` : 'commands.logger'
    await db.collection('league_settings').doc(guildId).update({
      [path]: FieldValue.delete()
    })
  },

  async configureBroadcast(guildId: string, broadcastSettings: BroadcastConfiguration): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const path = leagueId ? `commands.league_commands.${leagueId}.broadcast` : 'commands.broadcast'
    await db.collection('league_settings').doc(guildId).update({ [path]: broadcastSettings })
  },

  async configureGameChannel(guildId: string, gameChannelSettings: GameChannelConfiguration): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const path = leagueId ? `commands.league_commands.${leagueId}.game_channel` : 'commands.game_channel'
    await db.collection('league_settings').doc(guildId).update({ [path]: gameChannelSettings })
  },

  async deleteGameChannels(guildId: string, entries: [WeekState, GameChannel][]): Promise<void> {
    if (entries.length > 0) {
      const leagueId = selectedLeagueForGuild(guildId)
      const basePath = leagueId ? `commands.league_commands.${leagueId}.game_channel` : 'commands.game_channel'
      await db.collection('league_settings').doc(guildId).update(
        Object.fromEntries(entries.map(e => {
          const seasonWeekKey = createWeekKey(e[0].seasonIndex, e[0].week)
          return [`${basePath}.weekly_states.${seasonWeekKey}.channel_states.${e[1].channel.id}`, FieldValue.delete()]
        }))
      )
    }
  },

  async updateGameWeekState(guildId: string, week: number, season: number, weekState: WeekState): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.league_commands.${leagueId}.game_channel` : 'commands.game_channel'
    await db.collection('league_settings').doc(guildId).update({ [`${basePath}.weekly_states.${seasonWeekKey}`]: weekState })
  },

  async deleteGameChannel(guildId: string, week: number, season: number, channel: ChannelId): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const channelKey = channel.id
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.league_commands.${leagueId}.game_channel` : 'commands.game_channel'
    await db.collection('league_settings').doc(guildId).update({
      [`${basePath}.weekly_states.${seasonWeekKey}.channel_states.${channelKey}`]: FieldValue.delete()
    })
  },

  async updateGameChannelPingTime(guildId: string, week: number, season: number, channel: ChannelId): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const channelKey = channel.id
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.league_commands.${leagueId}.game_channel` : 'commands.game_channel'
    await db.collection('league_settings').doc(guildId).update({
      [`${basePath}.weekly_states.${seasonWeekKey}.channel_states.${channelKey}.notifiedTime`]: new Date().getTime()
    })
  },

  async updateGameChannelState(guildId: string, week: number, season: number, channel: ChannelId, state: GameChannelState): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const channelKey = channel.id
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.league_commands.${leagueId}.game_channel` : 'commands.game_channel'
    await db.collection('league_settings').doc(guildId).update({
      [`${basePath}.weekly_states.${seasonWeekKey}.channel_states.${channelKey}.state`]: state
    })
  },
  async connectMaddenLeagueId(guildId: string, leagueId: string, leagueName?: string) {
    const maddenLeague: Record<string, unknown> = {
      league_id: leagueId,
      league_ids: FieldValue.arrayUnion(leagueId)
    }
    if (leagueName) maddenLeague.league_names = { [leagueId]: leagueName }
    await db.collection("league_settings").doc(guildId).set(
      { commands: { madden_league: maddenLeague } }, { merge: true }
    )
  },
  async setActiveMaddenLeagueId(guildId: string, leagueId: string): Promise<void> {
    const leagueIds = await this.getMaddenLeagueIds(guildId)
    if (!leagueIds.includes(leagueId)) {
      throw new Error(`League ${leagueId} is not connected to Discord server ${guildId}`)
    }
    await db.collection('league_settings').doc(guildId).update({
      'commands.madden_league.league_id': leagueId
    })
  },
  async getMaddenLeagueId(guildId: string): Promise<string | undefined> {
    const doc = await db.collection('league_settings').doc(guildId).get()
    if (!doc.exists) {
      return undefined
    }
    const data = doc.data() as LeagueSettings
    return data.commands.madden_league?.league_id
  },
  async getMaddenLeagueIds(guildId: string): Promise<string[]> {
    const settings = await this.getLeagueSettings(guildId)
    const configuration = settings.commands.madden_league
    if (!configuration) return []
    return [...new Set([...(configuration.league_ids || []), configuration.league_id].filter(Boolean))]
  },
  async getMaddenLeagueNames(guildId: string): Promise<Record<string, string>> {
    const settings = await this.getLeagueSettings(guildId)
    return settings.commands.madden_league?.league_names || {}
  },

  async disconnectMaddenLeagueId(guildId: string, leagueId?: string): Promise<void> {
    if (leagueId) {
      const settings = await this.getLeagueSettings(guildId)
      const configuration = settings.commands.madden_league
      if (!configuration) return
      const remaining = [...new Set([...(configuration.league_ids || []), configuration.league_id])]
        .filter(id => id && id !== leagueId)
      if (remaining.length) {
        await db.collection('league_settings').doc(guildId).update({
          'commands.madden_league': {
            league_id: configuration.league_id === leagueId ? remaining[0] : configuration.league_id,
            league_ids: remaining,
            league_names: Object.fromEntries(Object.entries(configuration.league_names || {}).filter(([id]) => id !== leagueId))
          }
        })
        return
      }
    }
    await db.collection('league_settings').doc(guildId).update({
      'commands.madden_league': FieldValue.delete()
    })
  },

  async configureWaitlist(guildId: string, waitlistSettings: WaitlistConfiguration): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const path = leagueId ? `commands.league_commands.${leagueId}.waitlist` : 'commands.waitlist'
    await db.collection('league_settings').doc(guildId).update({ [path]: waitlistSettings, guildId })
  },

  async updateStreamCountConfiguration(guildId: string, streamCountSettings: StreamCountConfiguration): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const path = leagueId ? `commands.league_commands.${leagueId}.stream_count` : 'commands.stream_count'
    await db.collection('league_settings').doc(guildId).update({ [path]: streamCountSettings, guildId })
  },

  async updateTeamConfiguration(guildId: string, teamSettings: TeamConfiguration): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    if (leagueId) {
      await db.collection('league_settings').doc(guildId).set({
        commands: { team_leagues: { [leagueId]: teamSettings } },
        guildId
      }, { merge: true })
      return
    }
    await db.collection('league_settings').doc(guildId).set({
      commands: {
        teams: teamSettings
      },
      guildId
    }, { merge: true })
  },
  async updateAssignmentUser(guildId: string, teamId: string | number, user: UserId): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.team_leagues.${leagueId}` : 'commands.teams'
    await db.collection('league_settings').doc(guildId).update({
      [`${basePath}.assignments.${teamId}.discord_user`]: user
    })
  },
  async updateAssignment(guildId: string, assignments: TeamAssignments): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.team_leagues.${leagueId}` : 'commands.teams'
    await db.collection('league_settings').doc(guildId).update({
      [`${basePath}.assignments`]: assignments
    })
  },

  async removeAssignment(guildId: string, teamId: number | string): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.team_leagues.${leagueId}` : 'commands.teams'
    await db.collection('league_settings').doc(guildId).update({
      [`${basePath}.assignments.${teamId}`]: FieldValue.delete()
    })
  },

  async removeAllAssignments(guildId: string): Promise<void> {
    const leagueId = selectedLeagueForGuild(guildId)
    const basePath = leagueId ? `commands.team_leagues.${leagueId}` : 'commands.teams'
    await db.collection('league_settings').doc(guildId).update({
      [`${basePath}.assignments`]: {}
    })
  },

  async getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]> {
    // Query both schemas so pre-migration documents continue to work.
    const [activeSnapshot, connectedSnapshot] = await Promise.all([
      db.collection('league_settings').where('commands.madden_league.league_id', '==', leagueId).get(),
      db.collection('league_settings').where('commands.madden_league.league_ids', 'array-contains', leagueId).get()
    ])
    const docs = new Map([...activeSnapshot.docs, ...connectedSnapshot.docs].map(doc => [doc.id, doc]))
    return [...docs.values()].map(doc => {
      const settings = { guildId: doc.id, ...doc.data() } as LeagueSettings
      const selectedCommands = settings.commands.league_commands?.[leagueId] || {}
      const isDefault = settings.commands.madden_league?.league_id === leagueId
      const legacyCommands = isDefault ? settings.commands : {}
      return {
        ...settings,
        commands: {
          ...settings.commands,
          logger: selectedCommands.logger || legacyCommands.logger,
          game_channel: selectedCommands.game_channel || legacyCommands.game_channel,
          stream_count: selectedCommands.stream_count || legacyCommands.stream_count,
          broadcast: selectedCommands.broadcast || legacyCommands.broadcast,
          waitlist: selectedCommands.waitlist || legacyCommands.waitlist,
          player: selectedCommands.player || legacyCommands.player,
          teams: settings.commands.team_leagues?.[leagueId] || (isDefault ? settings.commands.teams : undefined),
          madden_league: settings.commands.madden_league
            ? { ...settings.commands.madden_league, league_id: leagueId }
            : undefined
        }
      }
    })
  },
  async deleteLeagueSetting(guildId: string): Promise<void> {
    await db.collection('league_settings').doc(guildId).delete()
  },
  async configurePlayer(guildId: string, configuration: PlayerConfiguration) {
    const leagueId = selectedLeagueForGuild(guildId)
    const path = leagueId ? `commands.league_commands.${leagueId}.player` : 'commands.player'
    await db.collection('league_settings').doc(guildId).update({ [path]: configuration })
  }
}

export default LeagueSettingsDB
