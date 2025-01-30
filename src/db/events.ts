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
export type ConfirmedSim = { confirmedUsers: UserId[], requestedUsers: UserId[], result: SimResult, scheduleId: number, seasonIndex: number, week: number, homeUser?: UserId, awayUser?: UserId }
export type DiscordLeagueConnectionEvent = { guildId: string, leagueId: string }
