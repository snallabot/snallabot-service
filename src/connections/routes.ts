import Router from "@koa/router"
import db from "../db/firebase"
import EventDB, { EventDelivery } from "../db/events_db"
import { DiscordLeagueConnectionEvent } from "../db/events"
import { FieldValue } from "firebase-admin/firestore"

const router = new Router({ prefix: "/connect" })

export async function setLeague(guild: string, league: string) {
  await db.collection("league_settings").doc(guild).set(
    { commands: { madden_league: { league_id: league } } }, { merge: true }
  )
  await EventDB.appendEvents<DiscordLeagueConnectionEvent>([{ key: guild, event_type: "DISCORD_LEAGUE_CONNECTION", guildId: guild, leagueId: league }], EventDelivery.EVENT_TRIGGER)
}
export async function removeLeague(guild: string) {
  await db.collection("league_settings").doc(guild).update(
    { ["commands.madden_league"]: FieldValue.delete() }
  )
  //TODO(snallapa) new event?
  await EventDB.appendEvents<DiscordLeagueConnectionEvent>([{ key: guild, event_type: "DISCORD_LEAGUE_CONNECTION", guildId: guild, leagueId: "" }], EventDelivery.EVENT_TRIGGER)
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
