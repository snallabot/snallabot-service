import EventDB, { EventDelivery, StoredEvent } from "../db/events_db"
import { MaddenBroadcastEvent, YoutubeBroadcastEvent, AddChannelEvent, RemoveChannelEvent } from "../db/events"
import { LeagueSettings } from "../discord/settings_db"
import db from "../db/firebase"
import { createClient } from "../discord/discord_utils"

function extractTitle(html: string) {
  const titleTagIndex = html.indexOf('[{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":')
  const sliced = html.slice(titleTagIndex)
  const titleTag = sliced.slice(0, sliced.indexOf("}"))
  return titleTag.replace('[{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":', "").replace('}', "").replaceAll('"', "")
}

function extractVideo(html: string) {
  const linkTagIndex = html.indexOf('{"status":"LIKE","target":{"videoId":')
  const sliced = html.slice(linkTagIndex)
  const linkTag = sliced.slice(0, sliced.indexOf("}"))
  return "https://www.youtube.com/watch?v=" + linkTag.replace('{"status":"LIKE","target":{"videoId":', "").replace('}', "").replaceAll('"', "")
}

function isStreaming(html: string) {
  return (html.match(/"isLive":true/g) || []).length == 1 && !html.includes("Scheduled for")
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

if (!process.env.PUBLIC_KEY) {
  throw new Error("No Public Key passed for interaction verification")
}

if (!process.env.DISCORD_TOKEN) {
  throw new Error("No Discord Token passed for interaction verification")
}
if (!process.env.APP_ID) {
  throw new Error("No App Id passed for interaction verification")
}

const prodSettings = { publicKey: process.env.PUBLIC_KEY, botToken: process.env.DISCORD_TOKEN, appId: process.env.APP_ID }

const prodClient = createClient(prodSettings)

EventDB.on<MaddenBroadcastEvent>("MADDEN_BROADCAST", async (events) => {
  events.map(async broadcastEvent => {
    const discordServer = broadcastEvent.key
    const doc = await db.collection("league_settings").doc(discordServer).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    const configuration = leagueSettings.commands?.broadcast
    if (!configuration) {
    } else {
      const channel = configuration.channel
      const role = configuration.role ? `<@&${configuration.role.id}>` : ""
      try {
        await prodClient.createMessage(channel, `${role} ${broadcastEvent.title}\n\n${broadcastEvent.video}`, ["roles"])
      } catch (e) {

      }
    }
  })
})

async function notifyYoutubeBroadcasts() {
  const currentChannelServers = await retrieveCurrentState()
  const currentChannels = [...new Set(currentChannelServers.map(c => c.channel_id))]
  const currentServers = [...new Set(currentChannelServers.map(c => c.discord_server))]
  const channels = await Promise.all(currentChannels
    .map(channel_id =>
      fetch(`https://www.youtube.com/channel/${channel_id}/live`)
        .then(res => res.text())
        .then(t => isStreaming(t) ? [{ channel_id, title: extractTitle(t), video: extractVideo(t) }] : [])
    ))
  const serverTitleKeywords = await Promise.all(currentServers.map(async server => {
    const doc = await db.collection("league_settings").doc(server).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    const configuration = leagueSettings.commands?.broadcast
    if (!configuration) {
      console.error(`${server} is not configured for Broadcasts`)
      return []
    } else {
      return [[server, configuration.title_keyword]]
    }
  }))
  const serverTitleMap: { [key: string]: string } = Object.fromEntries(serverTitleKeywords.flat())
  const currentlyLiveStreaming = channels.flat()
  const startTime = new Date()
  startTime.setDate(startTime.getDate() - 1)
  const pastBroadcasts = await Promise.all(currentlyLiveStreaming.map(async c => {
    const pastVideos = await EventDB.queryEvents<YoutubeBroadcastEvent>(c.channel_id, "YOUTUBE_BROADCAST", startTime, {}, 2)
    return { [c.channel_id]: pastVideos.map(p => p.video) }
  }))
  const channelToPastBroadcastMap: { [key: string]: Array<string> } = pastBroadcasts.reduce((prev, curr) => {
    Object.assign(prev, curr)
    return prev
  }, {})

  const newBroadcasts = currentlyLiveStreaming.filter(c => !channelToPastBroadcastMap[c.channel_id]?.includes(c.video))
  console.log(`broadcasts that are new: ${JSON.stringify(newBroadcasts)}`)
  await Promise.all(newBroadcasts.map(async b => {
    return await EventDB.appendEvents<YoutubeBroadcastEvent>([{ key: b.channel_id, event_type: "YOUTUBE_BROADCAST", video: b.video }], EventDelivery.EVENT_SOURCE)
  }
  ))
  const channelTitleMap: { [key: string]: { title: string, video: string } } = Object.fromEntries(newBroadcasts.map(c => [[c.channel_id], { title: c.title, video: c.video }]))
  console.log(channelTitleMap)
  await Promise.all(currentChannelServers.filter(c => channelTitleMap[c.channel_id] && channelTitleMap[c.channel_id].title.toLowerCase().includes(serverTitleMap[c.discord_server].toLowerCase())).map(async c => {
    return await EventDB.appendEvents<MaddenBroadcastEvent>([{ key: c.discord_server, event_type: "MADDEN_BROADCAST", title: channelTitleMap[c.channel_id].title, video: channelTitleMap[c.channel_id].video }], EventDelivery.EVENT_SOURCE)
  }))
}

notifyYoutubeBroadcasts()
