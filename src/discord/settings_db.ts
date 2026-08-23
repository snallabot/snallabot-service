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
export type ActiveLeagueConfiguration = { league_id: string }
export type ConnectedLeagueConfiguration = { leagueId: string, leagueName: string }
export type DiscordLeagueConnectionConfiguration = {
  guildId: string,
  leagues: ConnectedLeagueConfiguration[],
  activeLeague?: ActiveLeagueConfiguration
}
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
  getLeagueSettings(guildId: string, selectedLeague?: string): Promise<LeagueSettings>,
  configureLogger(guildId: string, loggerSettings: LoggerConfiguration, leagueId?: string): Promise<void>,
  removeLogger(guildId: string, leagueId?: string): Promise<void>,
  configureBroadcast(guildId: string, broadcastSettings: BroadcastConfiguration, leagueId?: string): Promise<void>,
  configureGameChannel(guildId: string, gameChannelSettings: GameChannelConfiguration, leagueId?: string): Promise<void>,
  deleteGameChannels(guildId: string, entries: [WeekState, GameChannel][], leagueId?: string): Promise<void>,
  updateGameWeekState(guildId: string, week: number, season: number, weekState: WeekState, leagueId?: string): Promise<void>,
  deleteGameChannel(guildId: string, week: number, season: number, channel: ChannelId, leagueId?: string): Promise<void>,
  updateGameChannelPingTime(guildId: string, week: number, season: number, channel: ChannelId, leagueId?: string): Promise<void>,
  updateGameChannelState(guildId: string, week: number, season: number, channel: ChannelId, state: GameChannelState, leagueId?: string): Promise<void>
  connectMaddenLeagueId(guildId: string, leagueId: string, leagueName?: string): Promise<void>,
  setActiveMaddenLeagueId(guildId: string, leagueId: string): Promise<void>,
  getMaddenLeagueId(guildId: string): Promise<string | undefined>,
  getMaddenLeagueIds(guildId: string): Promise<string[]>,
  getMaddenLeagueNames(guildId: string): Promise<Record<string, string>>,
  getDiscordLeagueConnection(guildId: string): Promise<DiscordLeagueConnectionConfiguration>,
  disconnectMaddenLeagueId(guildId: string, leagueId?: string): Promise<void>,
  configureWaitlist(guildId: string, waitlistSettings: WaitlistConfiguration, leagueId?: string): Promise<void>,
  updateStreamCountConfiguration(guildId: string, streamCountSettings: StreamCountConfiguration, leagueId?: string): Promise<void>,
  updateTeamConfiguration(guildId: string, teamSettings: TeamConfiguration, leagueId?: string): Promise<void>,
  updateAssignmentUser(guildId: string, teamId: string | number, user: UserId, leagueId?: string): Promise<void>,
  updateAssignment(guildId: string, assignments: TeamAssignments, leagueId?: string): Promise<void>,
  removeAssignment(guildId: string, teamId: number | string, leagueId?: string): Promise<void>,
  removeAllAssignments(guildId: string, leagueId?: string): Promise<void>,
  getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]>,
  deleteLeagueSetting(guildId: string): Promise<void>,
  configurePlayer(guildId: string, playerConfiguration: PlayerConfiguration, leagueId?: string): Promise<void>
}

export function createWeekKey(season: number, week: number) {
  return `season${String(season).padStart(2, '0')}_week${String(week).padStart(2, '0')}`
}

type StoredLeagueSettings = LeagueSettings & { leagueName?: string }

const leagueSettingsCollection = db.collection('league_settings')
const discordLeagueConnectionsCollection = db.collection('discord_league_connections')

function leagueSettingsDocumentId(guildId: string, leagueId: string) {
  return `${guildId}-${leagueId}`
}

function leagueSettingsFromDocument(data: StoredLeagueSettings | undefined, guildId: string): LeagueSettings {
  if (!data) return { commands: {}, guildId }
  return { ...data, guildId }
}

async function resolveLeagueSettingsDocument(guildId: string, leagueId?: string) {
  const connection = leagueId ? undefined : await readDiscordLeagueConnection(guildId)
  const resolvedLeague = leagueId || connection?.activeLeague?.league_id
  if (!resolvedLeague) return leagueSettingsCollection.doc(guildId)

  const leagueDocument = leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, resolvedLeague))
  if ((await leagueDocument.get()).exists) return leagueDocument

  const legacyDocument = leagueSettingsCollection.doc(guildId)
  const legacySettings = (await legacyDocument.get()).data() as StoredLeagueSettings | undefined
  const legacyMaddenLeague = legacySettings?.commands?.madden_league as (MaddenLeagueConfiguration & { league_ids?: string[] }) | undefined
  const legacyLeagueIds = legacyMaddenLeague?.league_ids || (legacyMaddenLeague ? [legacyMaddenLeague.league_id] : [])
  if (legacySettings && legacyLeagueIds.includes(resolvedLeague)) {
    await migrateLegacyLeagueSettings(guildId)
  }
  return leagueDocument
}

async function guildLeagueSettings(guildId: string): Promise<StoredLeagueSettings[]> {
  const [leagueDocuments, legacyDocument] = await Promise.all([
    leagueSettingsCollection.where('guildId', '==', guildId).get(),
    leagueSettingsCollection.doc(guildId).get()
  ])
  const documents: Array<typeof legacyDocument> = [...leagueDocuments.docs]
  if (legacyDocument.exists && !documents.some(document => document.ref.path === legacyDocument.ref.path)) {
    documents.push(legacyDocument)
  }
  return documents
    .map(document => document.data() as StoredLeagueSettings)
    .filter(settings => Boolean(settings.commands?.madden_league?.league_id))
}

function connectionFromLeagueSettings(guildId: string, settings: StoredLeagueSettings[]): DiscordLeagueConnectionConfiguration {
  const leagues = new Map<string, string>()
  let activeLeague: ActiveLeagueConfiguration | undefined
  settings.forEach(configuration => {
    const maddenLeague = configuration.commands.madden_league as MaddenLeagueConfiguration & {
      league_ids?: string[], league_names?: Record<string, string>
    } | undefined
    if (!maddenLeague) return
    activeLeague ||= { league_id: maddenLeague.league_id }
    const leagueIds = maddenLeague.league_ids || [maddenLeague.league_id]
    leagueIds.forEach(leagueId => leagues.set(
      leagueId,
      maddenLeague.league_names?.[leagueId] || configuration.leagueName || leagueId
    ))
  })
  return {
    guildId,
    leagues: [...leagues].map(([leagueId, leagueName]) => ({ leagueId, leagueName })),
    ...(activeLeague ? { activeLeague } : {})
  }
}

function mergeLegacyConnection(connection: DiscordLeagueConnectionConfiguration, settings?: StoredLeagueSettings): DiscordLeagueConnectionConfiguration {
  if (!settings) return connection
  const legacyConnection = connectionFromLeagueSettings(connection.guildId, [settings])
  const leagues = new Map(connection.leagues.map(league => [league.leagueId, league]))
  legacyConnection.leagues.forEach(league => {
    if (!leagues.has(league.leagueId)) leagues.set(league.leagueId, league)
  })
  const activeLeague = connection.activeLeague || legacyConnection.activeLeague
  return {
    guildId: connection.guildId,
    leagues: [...leagues.values()],
    ...(activeLeague ? { activeLeague } : {})
  }
}

async function readDiscordLeagueConnection(guildId: string): Promise<DiscordLeagueConnectionConfiguration> {
  const connectionDocument = await discordLeagueConnectionsCollection.doc(guildId).get()
  if (connectionDocument.exists) {
    return connectionDocument.data() as DiscordLeagueConnectionConfiguration
  }

  // Build a temporary view of legacy data until the next connection change
  // persists the dedicated connection document.
  return connectionFromLeagueSettings(guildId, await guildLeagueSettings(guildId))
}

async function setCommandConfiguration(guildId: string, leagueId: string | undefined, command: string, configuration: unknown) {
  const document = await resolveLeagueSettingsDocument(guildId, leagueId)
  await document.set({ commands: { [command]: configuration }, guildId }, { merge: true })
}

function commandsForLegacyLeague(settings: StoredLeagueSettings, leagueId: string): LeagueSettings['commands'] {
  const commands = settings.commands as LeagueSettings['commands'] & {
    league_commands?: Record<string, Partial<LeagueSettings['commands']>>,
    team_leagues?: Record<string, TeamConfiguration>
  }
  const leagueCommands = commands.league_commands?.[leagueId] || {}
  const defaultCommands = commands.madden_league?.league_id === leagueId ? commands : {}
  const logger = leagueCommands.logger ?? defaultCommands.logger
  const gameChannel = leagueCommands.game_channel ?? defaultCommands.game_channel
  const streamCount = leagueCommands.stream_count ?? defaultCommands.stream_count
  const broadcast = leagueCommands.broadcast ?? defaultCommands.broadcast
  const teams = commands.team_leagues?.[leagueId] ?? defaultCommands.teams
  const waitlist = leagueCommands.waitlist ?? defaultCommands.waitlist
  const player = leagueCommands.player ?? defaultCommands.player
  return {
    ...(logger ? { logger } : {}),
    ...(gameChannel ? { game_channel: gameChannel } : {}),
    ...(streamCount ? { stream_count: streamCount } : {}),
    ...(broadcast ? { broadcast } : {}),
    ...(teams ? { teams } : {}),
    ...(waitlist ? { waitlist } : {}),
    madden_league: { league_id: leagueId },
    ...(player ? { player } : {})
  }
}

async function migrateLegacyLeagueSettings(guildId: string): Promise<void> {
  const connectionDocument = discordLeagueConnectionsCollection.doc(guildId)
  const legacyDocument = leagueSettingsCollection.doc(guildId)
  const leagueSettingsQuery = leagueSettingsCollection.where('guildId', '==', guildId)
  await db.runTransaction(async transaction => {
    const [connectionSnapshot, legacySnapshot, leagueSettingsSnapshot] = await Promise.all([
      transaction.get(connectionDocument),
      transaction.get(legacyDocument),
      transaction.get(leagueSettingsQuery)
    ])
    const settings = legacySnapshot.data() as StoredLeagueSettings | undefined
    const maddenLeague = settings?.commands.madden_league as (MaddenLeagueConfiguration & {
      league_ids?: string[], league_names?: Record<string, string>
    }) | undefined
    if (!settings || !maddenLeague) return

    const legacyLeagueIds = maddenLeague.league_ids || [maddenLeague.league_id]
    const storedSettings = leagueSettingsSnapshot.docs.map(document => document.data() as StoredLeagueSettings)
    if (!storedSettings.includes(settings)) storedSettings.push(settings)
    const fallbackConnection = connectionFromLeagueSettings(guildId, storedSettings)
    const connection = mergeLegacyConnection(
      connectionSnapshot.exists
        ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
        : fallbackConnection,
      settings
    )
    const connectedLeagueIds = new Set(connection.leagues.map(league => league.leagueId))
    legacyLeagueIds.filter(leagueId => connectedLeagueIds.has(leagueId)).forEach(leagueId => {
      transaction.set(
        leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, leagueId)),
        { guildId, commands: commandsForLegacyLeague(settings, leagueId) },
        { merge: true }
      )
    })
    transaction.set(connectionDocument, connection)
    transaction.delete(legacyDocument)
  })
}

const LeagueSettingsDB: LeagueSettingsDB = {
  async getAllLeagueSettings(): Promise<LeagueSettings[]> {
    const snapshot = await leagueSettingsCollection.get()
    const settingsByLeague = new Map<string, LeagueSettings>()
    const documents = snapshot.docs.map(document => {
      const settings = document.data() as StoredLeagueSettings
      return { settings, guildId: settings.guildId || document.id }
    })
    // Add legacy documents first so an already-migrated per-league document
    // wins when both temporarily exist.
    documents.sort((a, b) => {
      const aLegacy = Boolean((a.settings.commands.madden_league as MaddenLeagueConfiguration & { league_ids?: string[] } | undefined)?.league_ids)
      const bLegacy = Boolean((b.settings.commands.madden_league as MaddenLeagueConfiguration & { league_ids?: string[] } | undefined)?.league_ids)
      return Number(bLegacy) - Number(aLegacy)
    })
    documents.forEach(({ settings, guildId }) => {
      const maddenLeague = settings.commands.madden_league as (MaddenLeagueConfiguration & { league_ids?: string[] }) | undefined
      const leagueIds = maddenLeague?.league_ids || (maddenLeague ? [maddenLeague.league_id] : [])
      if (leagueIds.length === 0) {
        settingsByLeague.set(`${guildId}|`, leagueSettingsFromDocument(settings, guildId))
      } else {
        leagueIds.forEach(leagueId => settingsByLeague.set(`${guildId}|${leagueId}`, {
          guildId,
          commands: maddenLeague?.league_ids ? commandsForLegacyLeague(settings, leagueId) : settings.commands
        }))
      }
    })
    return [...settingsByLeague.values()]
  },

  async getLeagueSettings(guildId: string, selectedLeague?: string): Promise<LeagueSettings> {
    const document = await resolveLeagueSettingsDocument(guildId, selectedLeague)
    return leagueSettingsFromDocument((await document.get()).data() as StoredLeagueSettings | undefined, guildId)
  },

  async configureLogger(guildId: string, loggerSettings: LoggerConfiguration, leagueId?: string): Promise<void> {
    await setCommandConfiguration(guildId, leagueId, 'logger', loggerSettings)
  },

  async removeLogger(guildId: string, leagueId?: string): Promise<void> {
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({ 'commands.logger': FieldValue.delete() })
  },

  async configureBroadcast(guildId: string, broadcastSettings: BroadcastConfiguration, leagueId?: string): Promise<void> {
    await setCommandConfiguration(guildId, leagueId, 'broadcast', broadcastSettings)
  },

  async configureGameChannel(guildId: string, gameChannelSettings: GameChannelConfiguration, leagueId?: string): Promise<void> {
    await setCommandConfiguration(guildId, leagueId, 'game_channel', gameChannelSettings)
  },

  async deleteGameChannels(guildId: string, entries: [WeekState, GameChannel][], leagueId?: string): Promise<void> {
    if (entries.length === 0) return
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update(Object.fromEntries(entries.map(([weekState, gameChannel]) => {
      const seasonWeekKey = createWeekKey(weekState.seasonIndex, weekState.week)
      return [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${gameChannel.channel.id}`, FieldValue.delete()]
    })))
  },

  async updateGameWeekState(guildId: string, week: number, season: number, weekState: WeekState, leagueId?: string): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.set({
      commands: { game_channel: { weekly_states: { [seasonWeekKey]: weekState } } },
      guildId
    }, { merge: true })
  },

  async deleteGameChannel(guildId: string, week: number, season: number, channel: ChannelId, leagueId?: string): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channel.id}`]: FieldValue.delete()
    })
  },

  async updateGameChannelPingTime(guildId: string, week: number, season: number, channel: ChannelId, leagueId?: string): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channel.id}.notifiedTime`]: new Date().getTime()
    })
  },

  async updateGameChannelState(guildId: string, week: number, season: number, channel: ChannelId, state: GameChannelState, leagueId?: string): Promise<void> {
    const seasonWeekKey = createWeekKey(season, week)
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({
      [`commands.game_channel.weekly_states.${seasonWeekKey}.channel_states.${channel.id}.state`]: state
    })
  },

  async connectMaddenLeagueId(guildId: string, leagueId: string, leagueName?: string): Promise<void> {
    const leagueDocument = leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, leagueId))
    const legacyDocument = leagueSettingsCollection.doc(guildId)
    const connectionDocument = discordLeagueConnectionsCollection.doc(guildId)
    const leagueSettingsQuery = leagueSettingsCollection.where('guildId', '==', guildId)
    await db.runTransaction(async transaction => {
      const [connectionSnapshot, legacySnapshot, leagueSettingsSnapshot] = await Promise.all([
        transaction.get(connectionDocument),
        transaction.get(legacyDocument),
        transaction.get(leagueSettingsQuery)
      ])
      const legacySettings = legacySnapshot.data() as StoredLeagueSettings | undefined
      const storedSettings = leagueSettingsSnapshot.docs.map(document => document.data() as StoredLeagueSettings)
      if (legacySettings) storedSettings.push(legacySettings)
      const connection = mergeLegacyConnection(
        connectionSnapshot.exists
          ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
          : connectionFromLeagueSettings(guildId, storedSettings),
        legacySettings
      )
      const storedName = leagueName
        || connection.leagues.find(connectedLeague => connectedLeague.leagueId === leagueId)?.leagueName
        || leagueId
      const leagues = connection.leagues
        .filter(connectedLeague => connectedLeague.leagueId !== leagueId)
        .concat([{ leagueId, leagueName: storedName }])
      const legacyMaddenLeague = legacySettings?.commands?.madden_league as (MaddenLeagueConfiguration & { league_ids?: string[] }) | undefined
      const legacyLeagueIds = legacyMaddenLeague
        ? new Set(legacyMaddenLeague.league_ids || [legacyMaddenLeague.league_id])
        : undefined

      if (legacySettings && legacyLeagueIds) {
        leagues.filter(league => legacyLeagueIds.has(league.leagueId)).forEach(league => {
          transaction.set(
            leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, league.leagueId)),
            { guildId, commands: commandsForLegacyLeague(legacySettings, league.leagueId) },
            { merge: true }
          )
        })
        transaction.delete(legacyDocument)
      }
      if (legacySettings && !legacyMaddenLeague) {
        transaction.set(leagueDocument, {
          guildId,
          commands: {
            ...legacySettings.commands,
            madden_league: { league_id: leagueId }
          }
        }, { merge: true })
        transaction.delete(legacyDocument)
      } else if (!legacyLeagueIds?.has(leagueId)) {
        transaction.set(leagueDocument, {
          guildId,
          commands: { madden_league: { league_id: leagueId } }
        }, { merge: true })
      }

      transaction.set(connectionDocument, {
        guildId,
        leagues,
        activeLeague: connection.activeLeague || { league_id: leagueId }
      } as DiscordLeagueConnectionConfiguration)
    })
  },

  async setActiveMaddenLeagueId(guildId: string, leagueId: string): Promise<void> {
    const connectionDocument = discordLeagueConnectionsCollection.doc(guildId)
    const legacyDocument = leagueSettingsCollection.doc(guildId)
    const leagueSettingsQuery = leagueSettingsCollection.where('guildId', '==', guildId)
    await db.runTransaction(async transaction => {
      const [connectionSnapshot, legacySnapshot, leagueSettingsSnapshot] = await Promise.all([
        transaction.get(connectionDocument),
        transaction.get(legacyDocument),
        transaction.get(leagueSettingsQuery)
      ])
      const legacySettings = legacySnapshot.data() as StoredLeagueSettings | undefined
      const storedSettings = leagueSettingsSnapshot.docs.map(document => document.data() as StoredLeagueSettings)
      if (legacySettings) storedSettings.push(legacySettings)
      const connection = mergeLegacyConnection(
        connectionSnapshot.exists
          ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
          : connectionFromLeagueSettings(guildId, storedSettings),
        legacySettings
      )
      if (!connection.leagues.some(league => league.leagueId === leagueId)) {
        throw new Error(`League ${leagueId} is not connected to Discord server ${guildId}`)
      }
      transaction.set(connectionDocument, {
        ...connection,
        activeLeague: { league_id: leagueId }
      } as DiscordLeagueConnectionConfiguration)
    })
  },

  async getMaddenLeagueId(guildId: string): Promise<string | undefined> {
    return (await readDiscordLeagueConnection(guildId)).activeLeague?.league_id
  },

  async getMaddenLeagueIds(guildId: string): Promise<string[]> {
    return (await readDiscordLeagueConnection(guildId)).leagues.map(league => league.leagueId)
  },

  async getMaddenLeagueNames(guildId: string): Promise<Record<string, string>> {
    return Object.fromEntries((await readDiscordLeagueConnection(guildId)).leagues
      .map(league => [league.leagueId, league.leagueName]))
  },

  async getDiscordLeagueConnection(guildId: string): Promise<DiscordLeagueConnectionConfiguration> {
    return readDiscordLeagueConnection(guildId)
  },

  async disconnectMaddenLeagueId(guildId: string, leagueId?: string): Promise<void> {
    const connectionDocument = discordLeagueConnectionsCollection.doc(guildId)
    const legacyDocument = leagueSettingsCollection.doc(guildId)
    const leagueSettingsQuery = leagueSettingsCollection.where('guildId', '==', guildId)
    await db.runTransaction(async transaction => {
      const [connectionSnapshot, legacySnapshot, leagueSettingsSnapshot] = await Promise.all([
        transaction.get(connectionDocument),
        transaction.get(legacyDocument),
        transaction.get(leagueSettingsQuery)
      ])
      const legacySettings = legacySnapshot.data() as StoredLeagueSettings | undefined
      const storedSettings = leagueSettingsSnapshot.docs.map(document => document.data() as StoredLeagueSettings)
      if (legacySettings) storedSettings.push(legacySettings)
      const connection = mergeLegacyConnection(
        connectionSnapshot.exists
          ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
          : connectionFromLeagueSettings(guildId, storedSettings),
        legacySettings
      )
      const disconnectedLeague = leagueId || connection.activeLeague?.league_id || connection.leagues[0]?.leagueId
      if (!disconnectedLeague) return

      const remainingLeagues = connection.leagues.filter(league => league.leagueId !== disconnectedLeague)
      const legacyMaddenLeague = legacySettings?.commands?.madden_league as (MaddenLeagueConfiguration & { league_ids?: string[] }) | undefined
      const legacyLeagueIds = new Set(legacyMaddenLeague?.league_ids || (legacyMaddenLeague ? [legacyMaddenLeague.league_id] : []))
      if (legacySettings) {
        remainingLeagues.filter(league => legacyLeagueIds.has(league.leagueId)).forEach(league => {
          transaction.set(
            leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, league.leagueId)),
            { guildId, commands: commandsForLegacyLeague(legacySettings, league.leagueId) },
            { merge: true }
          )
        })
        transaction.delete(legacyDocument)
      }
      transaction.delete(leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, disconnectedLeague)))

      if (remainingLeagues.length === 0) {
        transaction.delete(connectionDocument)
      } else {
        const activeLeague = connection.activeLeague?.league_id === disconnectedLeague
          ? { league_id: remainingLeagues[0].leagueId }
          : connection.activeLeague
        transaction.set(connectionDocument, {
          guildId,
          leagues: remainingLeagues,
          ...(activeLeague ? { activeLeague } : {})
        } as DiscordLeagueConnectionConfiguration)
      }
    })
  },

  async configureWaitlist(guildId: string, waitlistSettings: WaitlistConfiguration, leagueId?: string): Promise<void> {
    await setCommandConfiguration(guildId, leagueId, 'waitlist', waitlistSettings)
  },

  async updateStreamCountConfiguration(guildId: string, streamCountSettings: StreamCountConfiguration, leagueId?: string): Promise<void> {
    await setCommandConfiguration(guildId, leagueId, 'stream_count', streamCountSettings)
  },

  async updateTeamConfiguration(guildId: string, teamSettings: TeamConfiguration, leagueId?: string): Promise<void> {
    await setCommandConfiguration(guildId, leagueId, 'teams', teamSettings)
  },

  async updateAssignmentUser(guildId: string, teamId: string | number, user: UserId, leagueId?: string): Promise<void> {
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({ [`commands.teams.assignments.${teamId}.discord_user`]: user })
  },

  async updateAssignment(guildId: string, assignments: TeamAssignments, leagueId?: string): Promise<void> {
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({ 'commands.teams.assignments': assignments })
  },

  async removeAssignment(guildId: string, teamId: number | string, leagueId?: string): Promise<void> {
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({ [`commands.teams.assignments.${teamId}`]: FieldValue.delete() })
  },

  async removeAllAssignments(guildId: string, leagueId?: string): Promise<void> {
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({ 'commands.teams.assignments': {} })
  },

  async getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]> {
    const [leagueSnapshot, legacySnapshot] = await Promise.all([
      leagueSettingsCollection.where('commands.madden_league.league_id', '==', leagueId).get(),
      leagueSettingsCollection.where('commands.madden_league.league_ids', 'array-contains', leagueId).get()
    ])
    const settingsByGuild = new Map<string, LeagueSettings>()
    const documents = new Map([...legacySnapshot.docs, ...leagueSnapshot.docs]
      .map(document => [document.ref.path, document]))
    const orderedDocuments = [...documents.values()].sort((a, b) => {
      const aLegacy = Boolean((a.data().commands?.madden_league as { league_ids?: string[] } | undefined)?.league_ids)
      const bLegacy = Boolean((b.data().commands?.madden_league as { league_ids?: string[] } | undefined)?.league_ids)
      return Number(bLegacy) - Number(aLegacy)
    })
    orderedDocuments.forEach(document => {
      const settings = document.data() as StoredLeagueSettings
      const guildId = settings.guildId || document.id
      const maddenLeague = settings.commands.madden_league as MaddenLeagueConfiguration & { league_ids?: string[] }
      settingsByGuild.set(guildId, {
        guildId,
        commands: maddenLeague.league_ids ? commandsForLegacyLeague(settings, leagueId) : settings.commands
      })
    })
    return [...settingsByGuild.values()]
  },

  async deleteLeagueSetting(guildId: string): Promise<void> {
    const [leagueDocuments, legacyDocument] = await Promise.all([
      leagueSettingsCollection.where('guildId', '==', guildId).get(),
      leagueSettingsCollection.doc(guildId).get()
    ])
    const documents = new Map(leagueDocuments.docs.map(document => [document.ref.path, document.ref]))
    if (legacyDocument.exists) documents.set(legacyDocument.ref.path, legacyDocument.ref)
    const batch = db.batch()
    documents.forEach(document => batch.delete(document))
    batch.delete(discordLeagueConnectionsCollection.doc(guildId))
    await batch.commit()
  },

  async configurePlayer(guildId: string, configuration: PlayerConfiguration, leagueId?: string) {
    await setCommandConfiguration(guildId, leagueId, 'player', configuration)
  }
}

export default LeagueSettingsDB
