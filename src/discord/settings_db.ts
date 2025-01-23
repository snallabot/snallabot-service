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
export type GameChannelConfiguration = { admin: RoleId, default_category: CategoryId, scoreboard_channel: ChannelId, wait_ping: number, weekly_states: { [key: SeasonWeekIndex]: WeekState } }

export type UserStreamCount = { user: UserId, count: number }
export type StreamCountConfiguration = { channel: ChannelId, message: MessageId, counts: UserStreamCount[] }

export type TeamAssignment = { discord_user?: UserId, discord_role?: RoleId }
export type TeamAssignments = { [key: string]: TeamAssignment }
export type TeamConfiguration = { channel: ChannelId, messageId: MessageId, useRoleUpdates: boolean, assignments: TeamAssignments }


export type LeagueSettings = {
  commands: {
    logger?: LoggerConfiguration,
    game_channel?: GameChannelConfiguration,
    stream_count?: StreamCountConfiguration,
    broadcast?: BroadcastConfiguration,
    teams?: TeamConfiguration,
    waitlist?: WaitlistConfiguration,
    madden_league?: MaddenLeagueConfiguration
  }
}
