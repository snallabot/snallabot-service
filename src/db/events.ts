export type MaddenBroadcastEvent = { title: string, video: string }
export type YoutubeBroadcastEvent = { video: string }
export type BroadcastConfigurationEvent = { channel_id: string, role?: string, id: string, timestamp: string, title_keyword: string }
export type AddChannelEvent = { channel_id: string, discord_server: string }
export type RemoveChannelEvent = { channel_id: string, discord_server: string }
