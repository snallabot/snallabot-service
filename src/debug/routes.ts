import Router from "@koa/router"
import { getViewCacheStats } from "../db/view"
import { getMaddenCacheStats } from "../db/madden_hash_storage"
import { contentType, debugCounter, scrapeMetrics } from "./metrics"
const router = new Router({ prefix: "/debug" })


router.get("/cacheStats", async (ctx) => {
  const stats = { madden: getMaddenCacheStats(), view: getViewCacheStats() }
  ctx.status = 200
  ctx.set("Content-Type", "application/json")
  ctx.body = {
    stats: stats
  }
})
  .get("/memoryUsage", async (ctx) => {
    ctx.status = 200
    ctx.set("Content-Type", "application/json")
    ctx.body = {
      stats: process.memoryUsage()
    }
  })
  .get("/metrics", async (ctx) => {
    const metrics = await scrapeMetrics()
    console.log(contentType)
    ctx.set("Content-Type", contentType)
    ctx.body = metrics
    ctx.status = 200
  })
  .get("/testMetrics", async (ctx) => {
    debugCounter.inc()
    ctx.status = 200
  })

export default router
