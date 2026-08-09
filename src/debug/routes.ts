import Router from "@koa/router"
import NodeCache from "node-cache"
import { getViewCacheStats } from "../db/view"
import { getMaddenCacheStats } from "../db/madden_hash_storage"
import { contentType, debugCounter, exportQueueSize, maddenHashCacheSize, scrapeMetrics, twitchChannelsGauge, viewCacheSize, youtubeChannelsGauge } from "./metrics"
import { getQueueSize } from "../dashboard/ea_client"
import { youtubeNotifierHandler } from "../yt-notifier/routes"
import { twitchNotifierHandler } from "../twitch-notifier/routes"
const router = new Router({ prefix: "/debug" })

// only update number of channels once an hour
const TTL = 3600
const broadcastCache = new NodeCache()
const CACHE_KEY = "COUNTS"

async function getBroadcastCounts() {
  let counts = broadcastCache.get(CACHE_KEY) as { ytCount: number, twitchCount: number }
  if (!counts) {
    try {
      const [ytChannels, twitchChannels] = await Promise.all([youtubeNotifierHandler.listAllYoutubeChannels(), twitchNotifierHandler.listAllTwitchChannels()])
      counts = { ytCount: ytChannels.length, twitchCount: twitchChannels.length }
      broadcastCache.set(CACHE_KEY, counts, TTL)
    } catch (e) {
      console.error("failed to get channels", e)
      return { ytCount: 0, twitchCount: 0 }
    }
  }
  return counts
}

router
  .get("/memoryUsage", async (ctx) => {
    ctx.status = 200
    ctx.set("Content-Type", "application/json")
    ctx.body = {
      stats: process.memoryUsage()
    }
  })
  .get("/metrics", async (ctx) => {
    const stats = { madden: getMaddenCacheStats(), view: getViewCacheStats() }
    viewCacheSize.set(stats.view.ksize + stats.view.vsize)
    maddenHashCacheSize.set(stats.madden.ksize + stats.madden.vsize)
    exportQueueSize.set(getQueueSize())
    const broadcastCounts = await getBroadcastCounts()
    youtubeChannelsGauge.set(broadcastCounts.ytCount)
    twitchChannelsGauge.set(broadcastCounts.twitchCount)
    const metrics = await scrapeMetrics()
    ctx.set("Content-Type", contentType)
    ctx.body = metrics
    ctx.status = 200
  })
  .get("/testMetrics", async (ctx) => {
    debugCounter.inc()
    ctx.status = 200
  })

export default router
