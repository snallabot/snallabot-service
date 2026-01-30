import EventDB, { EventDelivery } from "../db/events_db"
import { MaddenBroadcastEvent } from "../db/events"
import LeagueSettingsDB, { LeagueSettings } from "../discord/settings_db"
import db from "../db/firebase"
import { createClient } from "../discord/discord_utils"
import NodeCache from "node-cache"
import { youtubeNotifierHandler } from "./routes"

const currentlyBroadcasting = new NodeCache()

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
  return (html.match(/"isLive":true/g) || []).length >= 1 && !html.includes("Scheduled for")
}

type YoutubeNotifierStored = {
  servers: Record<string, { enabled: true }>
}
type YoutubeNotifier = {
  servers: Record<string, { enabled: true }>,
  channel_id: string
}

interface YoutubeNotifierStateManager {
  getCurrentState(): YoutubeNotifier[]
}

async function createYoutubeNotifierStateManager(): Promise<YoutubeNotifierStateManager> {
  const collection = db.collection("youtube_notifiers")
  const snapshot = await collection.get();
  let state: YoutubeNotifier[] = snapshot.docs.map(doc => ({ channel_id: doc.id, ...doc.data() as YoutubeNotifierStored }))
  collection.onSnapshot(q => {
    state = q.docs.map(doc => ({ channel_id: doc.id, ...doc.data() as YoutubeNotifierStored }))
  })
  return {
    getCurrentState: function() {
      return state
    }
  }
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
    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(discordServer)
    const configuration = leagueSettings.commands?.broadcast
    if (!configuration) {
    } else {
      const channel = configuration.channel
      const role = configuration.role ? `<@&${configuration.role.id}>` : ""
      try {
        await prodClient.createMessage(channel, `${role} ${broadcastEvent.title}\n\n${broadcastEvent.video}`, ["roles"])
      } catch (e) {
        console.error(e)
      }
    }
  })
})

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
const ONE_DAY_TTL = 3600 * 24 // 1 days in seconds

async function notifyYoutubeBroadcasts() {
  const youtubeState = await createYoutubeNotifierStateManager()
  while (true) {
    try {
      const channelToServers = youtubeState.getCurrentState()
      const currentChannels = [...new Set(channelToServers.map(m => m.channel_id))]
      console.log(`checking ${currentChannels}`)
      const currentServers = [...new Set(channelToServers.flatMap(c => Object.entries(c.servers).filter(e => { const [_, enabled] = e; return enabled }).map(e => e[0])))]
      const channels = await Promise.all(currentChannels
        .map(channel_id =>
          fetch(`https://www.youtube.com/channel/${channel_id}/live`)
            .then(res => res.text())
            .then(t => isStreaming(t) ? [{ channel_id, title: extractTitle(t), video: extractVideo(t) }] : [])
        ))
      const serverTitleKeywords = await Promise.all(currentServers.map(async server => {
        const leagueSettings = await LeagueSettingsDB.getLeagueSettings(server)
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
      console.log(`Currently Live Streaming: ${currentlyLiveStreaming.map(m => m.title)}`)
      const newBroadcasts = currentlyLiveStreaming.filter(c => !(currentlyBroadcasting.get(c.channel_id) as string | undefined)?.includes(c.video))
      currentlyLiveStreaming.forEach(c => {
        currentlyBroadcasting.set(c.channel_id, c.video, ONE_DAY_TTL)
      })
      console.log(`broadcasts that are new: ${JSON.stringify(newBroadcasts)}`)
      const channelTitleMap: { [key: string]: { title: string, video: string } } = Object.fromEntries(newBroadcasts.map(c => [[c.channel_id], { title: c.title, video: c.video }]))
      await Promise.all(channelToServers.flatMap(c => {
        const title = channelTitleMap[c.channel_id]?.title
        return Object.entries(c.servers).flatMap(e => {
          const [discord_server, enabled] = e
          if (title && enabled && title.toLowerCase().includes(serverTitleMap[discord_server].toLowerCase())) {
            return [{ discord_server: discord_server, title: title, video: channelTitleMap[c.channel_id].video }]
          } else {
            return []
          }
        })
      }).map(async c => {
        return await EventDB.appendEvents<MaddenBroadcastEvent>([{ key: c.discord_server, event_type: "MADDEN_BROADCAST", title: c.title, video: c.video }], EventDelivery.EVENT_SOURCE)
      }))
      console.log("Check complete, sleeping for 5 minutes...\n")
      await fetch("https://hc-ping.com/59c94914-bacc-42e1-8ae5-fde17d2e8dcc")
      await sleep(5 * 60 * 1000)
    } catch (e) {
      console.error(e)
    }
  }
}

notifyYoutubeBroadcasts()
