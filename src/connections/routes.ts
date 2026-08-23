import Router from "@koa/router"
import EventDB, { EventDelivery } from "../db/events_db"
import { DiscordLeagueConnectionEvent } from "../db/events"
import LeagueSettingsDB from "../discord/settings_db"

const router = new Router({ prefix: "/connect" })

async function publishLeagueConnections(guild: string) {
  const leagueIds = await LeagueSettingsDB.getMaddenLeagueIds(guild)
  await EventDB.appendEvents<DiscordLeagueConnectionEvent>(
    [{ key: guild, event_type: "DISCORD_LEAGUE_CONNECTION", guildId: guild, leagueIds }],
    EventDelivery.EVENT_TRIGGER
  )
}

export async function setLeague(guild: string, league: string, leagueName?: string) {
  await LeagueSettingsDB.connectMaddenLeagueId(guild, league, leagueName)
  await publishLeagueConnections(guild)
}
export async function removeLeague(guild: string, league?: string) {
  await LeagueSettingsDB.disconnectMaddenLeagueId(guild, league)
  await publishLeagueConnections(guild)
}
export async function setActiveLeague(guild: string, league: string) {
  await LeagueSettingsDB.setActiveMaddenLeagueId(guild, league)
  await publishLeagueConnections(guild)
}

router.post("/discord/:guild/madden/:league", async (ctx) => {
  const { guild, league } = ctx.params
  await setLeague(guild, league)
  ctx.status = 200
}).post("/discord/:guild/madden/:league/active", async (ctx) => {
  const { guild, league } = ctx.params
  await setActiveLeague(guild, league)
  ctx.status = 200
}).all("/discord/:guild/:platform/:league/(.*)", async (ctx) => {
  const { guild, league } = ctx.params
  await setLeague(guild, league)
  const redirectPath = ctx.path.replace(`/connect/discord/${guild}`, '')
  ctx.status = 308
  ctx.redirect(redirectPath)
})

export default router
