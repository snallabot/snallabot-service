import Router from "@koa/router"
import db from "../db/firebase"

const router = new Router({ prefix: "/connect" })

async function setLeague(guild: string, league: string) {
  await db.collection("league_settings").doc(guild).set(
    { commands: { madden_league: { league_id: league } } }, { merge: true }
  )
}

router.post("/discord/:guild/madden/:league", async (ctx) => {
  const { guild, league } = ctx.params
  await setLeague(guild, league)
  ctx.status = 200
}).all("/discord/:guild/:platform/:league/(.*)", async (ctx) => {
  const { guild, league } = ctx.params
  await setLeague(guild, league)
  const redirectPath = ctx.path.replace(`/connect/discord/${guild}`, '')
  ctx.status = 308
  ctx.redirect(redirectPath)
})

export default router
