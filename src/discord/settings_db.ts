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
export type TradeConfiguration = { channel: ChannelId, tradeCommitteeRole: RoleId, requiredApprovals: number }

export type GuildSettings = {
  schemaVersion: 1,
  commands: {
    stream_count?: StreamCountConfiguration,
    broadcast?: BroadcastConfiguration,
    waitlist?: WaitlistConfiguration
  },
  guildId: string
}

export type LeagueSettings = {
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

interface LeagueSettingsDB {
  getAllLeagueSettings(): Promise<LeagueSettings[]>,
  getAllGuildSettings(): Promise<GuildSettings[]>,
  getGuildSettings(guildId: string): Promise<GuildSettings>,
  getLeagueSettings(guildId: string, selectedLeague?: string): Promise<LeagueSettings>,
  configureLogger(guildId: string, loggerSettings: LoggerConfiguration, leagueId?: string): Promise<void>,
  removeLogger(guildId: string, leagueId?: string): Promise<void>,
  configureBroadcast(guildId: string, broadcastSettings: BroadcastConfiguration): Promise<void>,
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
  configureWaitlist(guildId: string, waitlistSettings: WaitlistConfiguration): Promise<void>,
  updateStreamCountConfiguration(guildId: string, streamCountSettings: StreamCountConfiguration): Promise<void>,
  updateTeamConfiguration(guildId: string, teamSettings: TeamConfiguration, leagueId?: string): Promise<void>,
  updateAssignmentUser(guildId: string, teamId: string | number, user: UserId, leagueId?: string): Promise<void>,
  updateAssignment(guildId: string, assignments: TeamAssignments, leagueId?: string): Promise<void>,
  removeAssignment(guildId: string, teamId: number | string, leagueId?: string): Promise<void>,
  removeAllAssignments(guildId: string, leagueId?: string): Promise<void>,
  getLeagueSettingsForLeagueId(leagueId: string): Promise<LeagueSettings[]>,
  deleteLeagueSetting(guildId: string): Promise<void>,
  configurePlayer(guildId: string, playerConfiguration: PlayerConfiguration, leagueId?: string): Promise<void>,
  configureTrade(guildId: string, tradeConfiguration: TradeConfiguration, leagueId?: string): Promise<void>
}

export function createWeekKey(season: number, week: number) {
  return `season${String(season).padStart(2, '0')}_week${String(week).padStart(2, '0')}`
}

type StoredLeagueSettings = LeagueSettings & { leagueName?: string }

const leagueSettingsCollection = db.collection('league_settings')
const discordLeagueConnectionsCollection = db.collection('discord_league_connections')
const discordGuildSettingsCollection = db.collection('discord_guild_settings')

type LegacyCommands = LeagueSettings['commands'] & {
  league_commands?: Record<string, Partial<LeagueSettings['commands']>>,
  team_leagues?: Record<string, TeamConfiguration>
}

function guildCommandsFrom(commands: Partial<LeagueSettings['commands']> | undefined): GuildSettings['commands'] {
  if (!commands) return {}
  return {
    ...(commands.stream_count ? { stream_count: commands.stream_count } : {}),
    ...(commands.broadcast ? { broadcast: commands.broadcast } : {}),
    ...(commands.waitlist ? { waitlist: commands.waitlist } : {})
  }
}

function guildCommandsFromLegacy(settings: StoredLeagueSettings | undefined, leagueId?: string): GuildSettings['commands'] {
  if (!settings) return {}
  const commands = settings.commands as LegacyCommands
  const rootCommands = guildCommandsFrom(commands)
  if (!leagueId) return rootCommands
  const selectedCommands = guildCommandsFrom(commands.league_commands?.[leagueId])
  return commands.madden_league?.league_id === leagueId
    ? { ...rootCommands, ...selectedCommands }
    : selectedCommands
}

function mergeGuildCommands(settings: LeagueSettings, guildSettings: GuildSettings): LeagueSettings {
  return {
    ...settings,
    guildId: guildSettings.guildId,
    commands: { ...settings.commands, ...guildSettings.commands }
  }
}

function createGuildSettings(
  guildId: string,
  canonical: Partial<GuildSettings> | undefined,
  legacy: StoredLeagueSettings | undefined,
  activeLeagueId: string | undefined,
  activeSettings: StoredLeagueSettings | undefined
): GuildSettings {
  // Canonical fields win. The remaining sources preserve all deployed schemas
  // until a separate, audited backfill has populated discord_guild_settings.
  const commands = {
    ...guildCommandsFromLegacy(legacy),
    ...guildCommandsFromLegacy(legacy, activeLeagueId),
    ...guildCommandsFrom(activeSettings?.commands),
    ...guildCommandsFrom(canonical?.commands)
  }
  return { schemaVersion: 1, guildId, commands }
}

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

async function readDiscordLeagueConnection(guildId: string): Promise<DiscordLeagueConnectionConfiguration> {
  const connectionDocument = await discordLeagueConnectionsCollection.doc(guildId).get()
  if (connectionDocument.exists) {
    return connectionDocument.data() as DiscordLeagueConnectionConfiguration
  }

  // Build a temporary view of legacy data until the next connection change
  // persists the dedicated connection document.
  return connectionFromLeagueSettings(guildId, await guildLeagueSettings(guildId))
}

async function readGuildSettings(guildId: string): Promise<GuildSettings> {
  const [canonicalDocument, legacyDocument, connection] = await Promise.all([
    discordGuildSettingsCollection.doc(guildId).get(),
    leagueSettingsCollection.doc(guildId).get(),
    readDiscordLeagueConnection(guildId)
  ])
  const canonical = canonicalDocument.data() as Partial<GuildSettings> | undefined
  const legacy = legacyDocument.data() as StoredLeagueSettings | undefined
  const activeLeagueId = connection.activeLeague?.league_id
  const activeDocument = activeLeagueId
    ? await leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, activeLeagueId)).get()
    : undefined
  const activeSettings = activeDocument?.data() as StoredLeagueSettings | undefined

  return createGuildSettings(guildId, canonical, legacy, activeLeagueId, activeSettings)
}

async function setGuildCommandConfiguration(
  guildId: string,
  command: keyof GuildSettings['commands'],
  configuration: BroadcastConfiguration | WaitlistConfiguration | StreamCountConfiguration
) {
  await discordGuildSettingsCollection.doc(guildId).set({
    schemaVersion: 1,
    guildId,
    commands: { [command]: configuration }
  }, { merge: true })
}

async function setCommandConfiguration(guildId: string, leagueId: string | undefined, command: string, configuration: unknown) {
  const document = await resolveLeagueSettingsDocument(guildId, leagueId)
  await document.set({ commands: { [command]: configuration }, guildId }, { merge: true })
}

function commandsForLegacyLeague(settings: StoredLeagueSettings, leagueId: string): LeagueSettings['commands'] {
  const commands = settings.commands as LegacyCommands
  const leagueCommands = commands.league_commands?.[leagueId] || {}
  const defaultCommands = !commands.madden_league || commands.madden_league.league_id === leagueId ? commands : {}
  const logger = leagueCommands.logger ?? defaultCommands.logger
  const gameChannel = leagueCommands.game_channel ?? defaultCommands.game_channel
  const teams = commands.team_leagues?.[leagueId] ?? defaultCommands.teams
  const player = leagueCommands.player ?? defaultCommands.player
  return {
    ...(logger ? { logger } : {}),
    ...(gameChannel ? { game_channel: gameChannel } : {}),
    ...(teams ? { teams } : {}),
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
    // Once present, the dedicated connection document is authoritative. This
    // prevents retained legacy source data from reconnecting removed leagues.
    const connection = connectionSnapshot.exists
      ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
      : fallbackConnection
    const connectedLeagueIds = new Set(connection.leagues.map(league => league.leagueId))
    const existingDocuments = new Set(leagueSettingsSnapshot.docs.map(document => document.ref.path))
    legacyLeagueIds.filter(leagueId => connectedLeagueIds.has(leagueId)).forEach(leagueId => {
      const leagueDocument = leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, leagueId))
      if (existingDocuments.has(leagueDocument.path)) return
      transaction.set(
        leagueDocument,
        { guildId, commands: commandsForLegacyLeague(settings, leagueId) },
        { merge: true }
      )
    })
    if (!connectionSnapshot.exists) transaction.set(connectionDocument, connection)
  })
}

const LeagueSettingsDB: LeagueSettingsDB = {
  async getAllLeagueSettings(): Promise<LeagueSettings[]> {
    const [snapshot, connectionsSnapshot] = await Promise.all([
      leagueSettingsCollection.get(),
      discordLeagueConnectionsCollection.get()
    ])
    const authoritativeConnections = new Map(connectionsSnapshot.docs.map(document => [
      document.id,
      document.data() as DiscordLeagueConnectionConfiguration
    ]))
    const settingsByLeague = new Map<string, { priority: number, settings: LeagueSettings }>()
    const documents = snapshot.docs.map(document => {
      const settings = document.data() as StoredLeagueSettings
      return { documentId: document.id, settings, guildId: settings.guildId || document.id }
    })
    documents.forEach(({ documentId, settings, guildId }) => {
      const maddenLeague = settings.commands.madden_league as (MaddenLeagueConfiguration & { league_ids?: string[] }) | undefined
      const leagueIds = maddenLeague?.league_ids || (maddenLeague ? [maddenLeague.league_id] : [])
      const authoritativeConnection = authoritativeConnections.get(guildId)
      const connectedLeagueIds = authoritativeConnection
        ? new Set(authoritativeConnection.leagues.map(league => league.leagueId))
        : undefined
      leagueIds.filter(leagueId => !connectedLeagueIds || connectedLeagueIds.has(leagueId)).forEach(leagueId => {
        const dedicatedDocument = documentId === leagueSettingsDocumentId(guildId, leagueId)
        const priority = dedicatedDocument ? 3 : maddenLeague?.league_ids ? 2 : 1
        const key = `${guildId}|${leagueId}`
        if ((settingsByLeague.get(key)?.priority || 0) > priority) return
        settingsByLeague.set(key, {
          priority, settings: {
            guildId,
            commands: dedicatedDocument ? settings.commands : commandsForLegacyLeague(settings, leagueId)
          }
        })
      })
    })
    return [...settingsByLeague.values()].map(value => value.settings)
  },

  async getAllGuildSettings(): Promise<GuildSettings[]> {
    const [canonicalSnapshot, leagueSnapshot, connectionsSnapshot] = await Promise.all([
      discordGuildSettingsCollection.get(),
      leagueSettingsCollection.get(),
      discordLeagueConnectionsCollection.get()
    ])
    const canonicalByGuild = new Map(canonicalSnapshot.docs.map(document => {
      const settings = document.data() as Partial<GuildSettings>
      return [settings.guildId || document.id, settings] as const
    }))
    const leagueDocumentsByGuild = new Map<string, { documentId: string, settings: StoredLeagueSettings }[]>()
    leagueSnapshot.docs.forEach(document => {
      const settings = document.data() as StoredLeagueSettings
      const guildId = settings.guildId || document.id
      const documents = leagueDocumentsByGuild.get(guildId) || []
      documents.push({ documentId: document.id, settings })
      leagueDocumentsByGuild.set(guildId, documents)
    })
    const connectionsByGuild = new Map(connectionsSnapshot.docs.map(document => [
      document.id,
      document.data() as DiscordLeagueConnectionConfiguration
    ]))
    const guildIds = new Set([
      ...canonicalByGuild.keys(),
      ...leagueDocumentsByGuild.keys(),
      ...connectionsByGuild.keys()
    ])

    return [...guildIds].map(guildId => {
      const leagueDocuments = leagueDocumentsByGuild.get(guildId) || []
      const connection = connectionsByGuild.get(guildId)
        || connectionFromLeagueSettings(guildId, leagueDocuments.map(document => document.settings))
      const activeLeagueId = connection.activeLeague?.league_id
      const legacy = leagueDocuments.find(document => document.documentId === guildId)?.settings
      const activeSettings = activeLeagueId
        ? leagueDocuments.find(document => document.documentId === leagueSettingsDocumentId(guildId, activeLeagueId))?.settings
        : undefined
      return createGuildSettings(guildId, canonicalByGuild.get(guildId), legacy, activeLeagueId, activeSettings)
    })
  },

  async getGuildSettings(guildId: string): Promise<GuildSettings> {
    return readGuildSettings(guildId)
  },

  async getLeagueSettings(guildId: string, selectedLeague?: string): Promise<LeagueSettings> {
    const document = await resolveLeagueSettingsDocument(guildId, selectedLeague)
    const [leagueDocument, guildSettings] = await Promise.all([
      document.get(),
      readGuildSettings(guildId)
    ])
    return mergeGuildCommands(
      leagueSettingsFromDocument(leagueDocument.data() as StoredLeagueSettings | undefined, guildId),
      guildSettings
    )
  },

  async configureLogger(guildId: string, loggerSettings: LoggerConfiguration, leagueId?: string): Promise<void> {
    await setCommandConfiguration(guildId, leagueId, 'logger', loggerSettings)
  },

  async removeLogger(guildId: string, leagueId?: string): Promise<void> {
    const document = await resolveLeagueSettingsDocument(guildId, leagueId)
    await document.update({ 'commands.logger': FieldValue.delete() })
  },

  async configureBroadcast(guildId: string, broadcastSettings: BroadcastConfiguration): Promise<void> {
    await setGuildCommandConfiguration(guildId, 'broadcast', broadcastSettings)
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
      const connection = connectionSnapshot.exists
        ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
        : connectionFromLeagueSettings(guildId, storedSettings)
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
      const existingDocuments = new Set(leagueSettingsSnapshot.docs.map(document => document.ref.path))

      if (legacySettings && legacyLeagueIds) {
        leagues.filter(league => legacyLeagueIds.has(league.leagueId)).forEach(league => {
          const legacyLeagueDocument = leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, league.leagueId))
          if (existingDocuments.has(legacyLeagueDocument.path)) return
          transaction.set(
            legacyLeagueDocument,
            { guildId, commands: commandsForLegacyLeague(legacySettings, league.leagueId) },
            { merge: true }
          )
        })
      }
      if (legacySettings && !legacyMaddenLeague && connection.leagues.length === 0 && !existingDocuments.has(leagueDocument.path)) {
        transaction.set(leagueDocument, {
          guildId,
          commands: commandsForLegacyLeague(legacySettings, leagueId)
        }, { merge: true })
      } else if (!legacyLeagueIds?.has(leagueId) && !existingDocuments.has(leagueDocument.path)) {
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
      const connection = connectionSnapshot.exists
        ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
        : connectionFromLeagueSettings(guildId, storedSettings)
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
      const connection = connectionSnapshot.exists
        ? connectionSnapshot.data() as DiscordLeagueConnectionConfiguration
        : connectionFromLeagueSettings(guildId, storedSettings)
      const disconnectedLeague = leagueId || connection.activeLeague?.league_id || connection.leagues[0]?.leagueId
      if (!disconnectedLeague) return

      const remainingLeagues = connection.leagues.filter(league => league.leagueId !== disconnectedLeague)
      const legacyMaddenLeague = legacySettings?.commands?.madden_league as (MaddenLeagueConfiguration & { league_ids?: string[] }) | undefined
      const legacyLeagueIds = new Set(legacyMaddenLeague?.league_ids || (legacyMaddenLeague ? [legacyMaddenLeague.league_id] : []))
      const existingDocuments = new Set(leagueSettingsSnapshot.docs.map(document => document.ref.path))
      if (legacySettings) {
        remainingLeagues.filter(league => legacyLeagueIds.has(league.leagueId)).forEach(league => {
          const legacyLeagueDocument = leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, league.leagueId))
          if (existingDocuments.has(legacyLeagueDocument.path)) return
          transaction.set(
            legacyLeagueDocument,
            { guildId, commands: commandsForLegacyLeague(legacySettings, league.leagueId) },
            { merge: true }
          )
        })
      }
      transaction.delete(leagueSettingsCollection.doc(leagueSettingsDocumentId(guildId, disconnectedLeague)))

      const activeLeague = connection.activeLeague?.league_id === disconnectedLeague
        ? remainingLeagues[0] ? { league_id: remainingLeagues[0].leagueId } : undefined
        : connection.activeLeague
      transaction.set(connectionDocument, {
        guildId,
        leagues: remainingLeagues,
        ...(activeLeague ? { activeLeague } : {})
      } as DiscordLeagueConnectionConfiguration)
    })
  },

  async configureWaitlist(guildId: string, waitlistSettings: WaitlistConfiguration): Promise<void> {
    await setGuildCommandConfiguration(guildId, 'waitlist', waitlistSettings)
  },

  async updateStreamCountConfiguration(guildId: string, streamCountSettings: StreamCountConfiguration): Promise<void> {
    await setGuildCommandConfiguration(guildId, 'stream_count', streamCountSettings)
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
    const settingsByGuild = new Map<string, { priority: number, settings: LeagueSettings }>()
    const documents = new Map([...legacySnapshot.docs, ...leagueSnapshot.docs]
      .map(document => [document.ref.path, document]))
    documents.forEach(document => {
      const settings = document.data() as StoredLeagueSettings
      const guildId = settings.guildId || document.id
      const maddenLeague = settings.commands.madden_league as MaddenLeagueConfiguration & { league_ids?: string[] }
      const dedicatedDocument = document.id === leagueSettingsDocumentId(guildId, leagueId)
      const priority = dedicatedDocument ? 3 : maddenLeague.league_ids ? 2 : 1
      if ((settingsByGuild.get(guildId)?.priority || 0) > priority) return
      settingsByGuild.set(guildId, {
        priority, settings: {
          guildId,
          commands: dedicatedDocument ? settings.commands : commandsForLegacyLeague(settings, leagueId)
        }
      })
    })
    const connectedSettings = await Promise.all([...settingsByGuild.values()].map(async value => {
      const connectionDocument = await discordLeagueConnectionsCollection.doc(value.settings.guildId).get()
      if (connectionDocument.exists) {
        const connection = connectionDocument.data() as DiscordLeagueConnectionConfiguration
        if (!connection.leagues.some(league => league.leagueId === leagueId)) return undefined
      }
      return mergeGuildCommands(value.settings, await readGuildSettings(value.settings.guildId))
    }))
    return connectedSettings.filter((settings): settings is LeagueSettings => Boolean(settings))
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
    batch.delete(discordGuildSettingsCollection.doc(guildId))
    await batch.commit()
  },
  async configurePlayer(guildId: string, configuration: PlayerConfiguration, leagueId?: string) {
    await setCommandConfiguration(guildId, leagueId, 'player', configuration)
  },
  async configureTrade(guildId: string, configuration: TradeConfiguration, leagueId?: string) {
    await setCommandConfiguration(guildId, leagueId, 'trade', configuration)
  }
}

export default LeagueSettingsDB
