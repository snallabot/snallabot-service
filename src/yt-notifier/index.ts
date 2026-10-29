import EventDB, { EventDelivery } from "../db/events_db"
import { MaddenBroadcastEvent } from "../db/events"
import LeagueSettingsDB from "../discord/settings_db"
import db from "../db/firebase"
import { createClient } from "../discord/discord_utils"
import { promises as fs } from "fs"
import { broadcastsSentCount, channelsStreamingCount, pushMetrics, youtubeCheckCycleDuration, youtubeCheckLastCompleted } from "../debug/metrics_push"

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

async function getYoutubeNotifiers(): Promise<YoutubeNotifier[]> {
  const snapshot = await db.collection("youtube_notifiers").get()
  return snapshot.docs.map(doc => ({ channel_id: doc.id, ...doc.data() as YoutubeNotifierStored }))
}

// ---- File-backed "currently broadcasting" state ----

const ONE_DAY_MS = 24 * 3600 * 1000 // 1 day in milliseconds

type BroadcastState = Record<string, { video: string, expiresAt: number }>

if (!process.env.BROADCAST_STATE_FILE) {
  throw new Error("No BROADCAST_STATE_FILE passed for broadcast state storage")
}
const STATE_FILE = process.env.BROADCAST_STATE_FILE

async function loadState(): Promise<BroadcastState> {
  let raw: string
  try {
    raw = await fs.readFile(STATE_FILE, "utf-8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return {}
    }
    throw e
  }
  let parsed: BroadcastState
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.error(`State file ${STATE_FILE} is corrupt, starting fresh`, e)
    return {}
  }
  // Drop expired entries (replaces the TTL NodeCache used to provide)
  const now = Date.now()
  return Object.fromEntries(Object.entries(parsed).filter(([_, v]) => v.expiresAt > now))
}

async function saveState(state: BroadcastState) {
  // Write to a temp file then rename so a crash can't leave a half-written state file
  const tmp = `${STATE_FILE}.tmp`
  await fs.writeFile(tmp, JSON.stringify(state), "utf-8")
  await fs.rename(tmp, STATE_FILE)
}

// ---- Discord setup ----

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
  await Promise.all(events.map(async broadcastEvent => {
    const discordServer = broadcastEvent.key
    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(discordServer)
    const configuration = leagueSettings.commands?.broadcast
    if (configuration) {
      const channel = configuration.channel
      const role = configuration.role ? `<@&${configuration.role.id}>` : ""
      try {
        await prodClient.createMessage(channel, `${role} ${broadcastEvent.title}\n\n${broadcastEvent.video}`, ["roles"])
      } catch (e) {
        console.error(e)
      }
    }
  }))
})

// ---- Single check run ----

async function notifyYoutubeBroadcasts() {
  const cycleStart = Date.now()
  const channelToServers = await getYoutubeNotifiers()
  const broadcastState = await loadState()

  const currentChannels = [...new Set(channelToServers.map(m => m.channel_id))]
  const currentServers = [...new Set(channelToServers.flatMap(c => Object.entries(c.servers).filter(e => { const [_, enabled] = e; return enabled }).map(e => e[0])))]
  const channels = await Promise.all(currentChannels
    .map(channel_id =>
      fetch(`https://www.youtube.com/channel/${channel_id}/live`, { signal: AbortSignal.timeout(30 * 1000) })
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

  const newBroadcasts = currentlyLiveStreaming.filter(c => broadcastState[c.channel_id]?.video !== c.video)
  const expiresAt = Date.now() + ONE_DAY_MS
  currentlyLiveStreaming.forEach(c => {
    broadcastState[c.channel_id] = { video: c.video, expiresAt }
  })
  await saveState(broadcastState)
  console.log(`broadcasts that are new: ${JSON.stringify(newBroadcasts)}`)

  const channelTitleMap: { [key: string]: { title: string, video: string } } = Object.fromEntries(newBroadcasts.map(c => [c.channel_id, { title: c.title, video: c.video }]))
  const sentBroadcasts = channelToServers.flatMap(c => {
    const title = channelTitleMap[c.channel_id]?.title
    return Object.entries(c.servers).flatMap(e => {
      const [discord_server, enabled] = e
      if (title && enabled && serverTitleMap[discord_server] && title.toLowerCase().includes(serverTitleMap[discord_server].toLowerCase())) {
        return [{ discord_server: discord_server, title: title, video: channelTitleMap[c.channel_id].video }]
      } else {
        return []
      }
    })
  })
  await Promise.all(sentBroadcasts.map(async c => {
    return await EventDB.appendEvents<MaddenBroadcastEvent>([{ key: c.discord_server, event_type: "MADDEN_BROADCAST", title: c.title, video: c.video }], EventDelivery.EVENT_SOURCE)
  }))

  const cycleDuration = (Date.now() - cycleStart) / 1000
  channelsStreamingCount.set(currentlyLiveStreaming.length)
  broadcastsSentCount.set(sentBroadcasts.length)
  youtubeCheckCycleDuration.set(cycleDuration)
  youtubeCheckLastCompleted.set(Math.floor(Date.now() / 1000))
  await pushMetrics('yt-notifier')

  console.log("Check complete")
}

notifyYoutubeBroadcasts()
  .then(() => process.exit(0)) // Firebase/Discord clients can keep the event loop alive, so exit explicitly
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
