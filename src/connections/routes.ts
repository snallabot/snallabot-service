import Router from "@koa/router"
import EventDB, { EventDelivery } from "../db/events_db"
import { DiscordLeagueConnectionEvent } from "../db/events"
import LeagueSettingsDB from "../discord/settings_db"

const router = new Router({ prefix: "/connect" })

export async function setLeague(guild: string, league: string) {
  await LeagueSettingsDB.connectMaddenLeagueId(guild, league)
  await EventDB.appendEvents<DiscordLeagueConnectionEvent>([{ key: guild, event_type: "DISCORD_LEAGUE_CONNECTION", guildId: guild, leagueId: league }], EventDelivery.EVENT_TRIGGER)
}
export async function removeLeague(guild: string) {
  await LeagueSettingsDB.disconnectMaddenLeagueId(guild)
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
