import Router from "@koa/router"
import { getViewCacheStats } from "../db/view"
import { getMaddenCacheStats } from "../db/madden_hash_storage"
import { contentType, debugCounter, exportQueueSize, maddenHashCacheSize, scrapeMetrics, viewCacheSize } from "./metrics"
import { getQueueSize } from "../dashboard/ea_client"
const router = new Router({ prefix: "/debug" })


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
