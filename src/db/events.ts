import { UserId } from "../discord/settings_db"
export enum SimResult {
  FORCE_WIN_AWAY = "FORCE_WIN_AWAY",
  FORCE_WIN_HOME = "FORCE_WIN_HOME",
  FAIR_SIM = "FAIR_SIM"
}

export type MaddenBroadcastEvent = { title: string, video: string }
export type YoutubeBroadcastEvent = { video: string }
export type AddChannelEvent = { channel_id: string, discord_server: string }
export type RemoveChannelEvent = { channel_id: string, discord_server: string }
export type ConfirmedSimV2 = { confirmedUsers: UserId[], requestedUsers: UserId[], result: SimResult, scheduleId: number, seasonIndex: number, week: number, homeUser?: UserId, awayUser?: UserId }
export type DiscordLeagueConnectionEvent = { guildId: string, leagueId: string }
export type TeamLogoCustomizedEvent = { emoji_id: string, emoji_name: string, teamAbbr: string, teamLogoPath: string }
// TODO: will I regret this? only time will tell. Making this a list of players instead of just one
export type RetiredPlayer = { retiredPlayers: [{ presentationId: number, birthYear: number, birthMonth: number, birthDay: number, rosterId: number }] }
