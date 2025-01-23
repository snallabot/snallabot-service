import EventDB, { EventDelivery, StoredEvent } from "../db/events_db"

//TODO remove duplicate code when old bot is taken off
type AddChannelEvent = { key: "yt_channels", id: string, timestamp: string, event_type: "ADD_CHANNEL", channel_id: string, discord_server: string }
type RemoveChannelEvent = { key: "yt_channels", id: string, timestamp: string, event_type: "REMOVE_CHANNEL", channel_id: string, discord_server: string }

export function extractChannelId(html: string) {
  const linkTagIndex = html.indexOf('<link rel="canonical" href="')
  const sliced = html.slice(linkTagIndex)
  const linkTag = sliced.slice(0, sliced.indexOf(">"))
  return linkTag.replace('<link rel="canonical" href="', "").replace('>', "").replace('"', "").replace("https://www.youtube.com/channel/", "")
}

async function retrieveCurrentState(): Promise<Array<{ channel_id: string, discord_server: string }>> {
  const addEvents = await EventDB.queryEvents<AddChannelEvent>("yt_channels", "ADD_CHANNEL", new Date(0), {}, 10000)
  const removeEvents = await EventDB.queryEvents<RemoveChannelEvent>("yt_channels", "REMOVE_CHANNEL", new Date(0), {}, 10000)

  //TODO: Replace with Object.groupBy
  let state = {} as { [key: string]: Array<StoredEvent<AddChannelEvent>> }
  addEvents.forEach(a => {
    const k = `${a.channel_id}|${a.discord_server}`
    if (!state[k]) {
      state[k] = [a]
    } else {
      state[k].push(a)
      state[k] = state[k].sort((a: StoredEvent<AddChannelEvent>, b: StoredEvent<AddChannelEvent>) => (b.timestamp.getTime() - a.timestamp.getTime())) // reverse chronologically order
    }
  })
  removeEvents.forEach(a => {
    const k = `${a.channel_id}|${a.discord_server}`
    if (state?.[k]?.[0]) {
      if (a.timestamp > state[k][0].timestamp) {
        delete state[k]
      }
    }

  })
  return Object.keys(state).map(k => {
    const [channel_id, discord_server] = k.split("|")
    return { channel_id, discord_server }
  })

}

interface YoutubeNotifierHandler {
  addYoutubeChannel(discordServer: string, youtubeUrl: string): Promise<void>,
  removeYoutubeChannel(discordServer: string, youtubeUrl: string): Promise<void>,
  listYoutubeChannels(discordServer: string): Promise<string[]>
}

export const youtubeNotifierHandler: YoutubeNotifierHandler = {
  addYoutubeChannel: async (discordServer: string, youtubeUrl: string) => {
    const channelId = await fetch(youtubeUrl).then(r => r.text()).then(t => extractChannelId(t))
    if (channelId) {
      await EventDB.appendEvents([{ key: "yt_channels", event_type: "ADD_CHANNEL", delivery: "EVENT_SOURCE", channel_id: channelId, discord_server: discordServer }], EventDelivery.EVENT_SOURCE)
    } else {
      throw new Error("could not find valid channel id")
    }
  },
  removeYoutubeChannel: async (discordServer: string, youtubeUrl: string) => {
    const channelId = await fetch(youtubeUrl).then(r => r.text()).then(t => extractChannelId(t))
    if (channelId) {
      await EventDB.appendEvents([{ key: "yt_channels", event_type: "REMOVE_CHANNEL", delivery: "EVENT_SOURCE", channel_id: channelId, discord_server: discordServer }], EventDelivery.EVENT_SOURCE)
    } else {
      throw new Error("could not find valid channel id")
    }
  },
  listYoutubeChannels: async (discordServer: string) => {
    const state = await retrieveCurrentState()
    return state.filter(c => c.discord_server === discordServer).map(c => c.channel_id)
      .map(channel => `https://www.youtube.com/channel/${channel}`)
  }
}
