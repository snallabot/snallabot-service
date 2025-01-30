import Router from "@koa/router"
import { getViewCacheStats } from "../db/view"
import { getMaddenCacheStats } from "../export/routes"
const router = new Router({ prefix: "/debug" })


router.get("/cacheStats", async (ctx) => {
  const stats = { madden: getMaddenCacheStats(), view: getViewCacheStats() }
  ctx.status = 200
  ctx.set("Content-Type", "application/json")
  ctx.body = {
    stats: stats
  }
})

export default router
