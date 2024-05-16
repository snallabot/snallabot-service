import Koa, { ParameterizedContext } from "koa"
import Router from "@koa/router"
import bodyParser from "@koa/bodyparser"
import { RosterExport, TeamExport, StandingExport, SchedulesExport, PuntingExport, TeamStatsExport, PassingExport, KickingExport, RushingExport, DefensiveExport, ReceivingExport } from "./madden_league_types"

const app = new Koa()
const router = new Router()

async function sendEvents(events: Array<any>): Promise<void> {
    await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/batchPost", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            batch: events,
            delivery: "EVENT_SOURCE"
        })
    })

}

router.post("/:platform/:l/leagueteams", async (ctx) => {
    const { platform, l } = ctx.params
    const teamsExport = ctx.request.body as TeamExport
    const events = teamsExport.leagueTeamInfoList.map(team => (
        { key: l, platform: platform, event_type: "MADDEN_TEAM", ...team }
    ))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/standings", async (ctx) => {
    const { platform, l } = ctx.params
    const standingsExport = ctx.request.body as StandingExport
    const events = standingsExport.teamStandingInfoList.map(standing => ({ key: l, platform: platform, event_type: "MADDEN_STANDING", ...standing }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/schedules", async (ctx) => {
    const { platform, l } = ctx.params
    const schedulesExport = ctx.request.body as SchedulesExport
    const events = schedulesExport.gameScheduleInfoList.map(game => ({ key: l, platform: platform, event_type: "MADDEN_SCHEDULE", ...game }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/punting", async (ctx) => {
    const { platform, l } = ctx.params
    const puntingExport = ctx.request.body as PuntingExport
    const events = puntingExport.playerPuntingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_PUNTING_STAT", ...stat }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/teamstats", async (ctx) => {
    const { platform, l } = ctx.params
    const teamStatsExport = ctx.request.body as TeamStatsExport
    const events = teamStatsExport.teamStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_TEAM_STAT", ...stat }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/passing", async (ctx) => {
    const { platform, l } = ctx.params
    const passingStatsExport = ctx.request.body as PassingExport
    const events = passingStatsExport.playerPassingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_PASSING_STAT", ...stat }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/kicking", async (ctx) => {
    const { platform, l } = ctx.params
    const kickingStatsExport = ctx.request.body as KickingExport
    const events = kickingStatsExport.playerKickingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_KICKING_STAT", ...stat }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/rushing", async (ctx) => {
    const { platform, l } = ctx.params
    const rushingStatsExport = ctx.request.body as RushingExport
    const events = rushingStatsExport.playerRushingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_RUSHING_STAT", ...stat }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/defense", async (ctx) => {
    const { platform, l } = ctx.params
    const defensiveStatsExport = ctx.request.body as DefensiveExport
    const events = defensiveStatsExport.playerDefensiveStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_DEFENSIVE_STAT", ...stat }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/receiving", async (ctx) => {
    const { platform, l } = ctx.params
    const receivingStatsExport = ctx.request.body as ReceivingExport
    const events = receivingStatsExport.playerReceivingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_RECEIVING_STAT", ...stat }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/team/:team/roster", async (ctx) => {
    const { platform, l, team } = ctx.params
    const roster = ctx.request.body as RosterExport
    const events = roster.rosterInfoList.map(player => ({ key: l, platform: platform, event_type: "MADDEN_PLAYER", team: team, ...player }))
    await sendEvents(events)
    ctx.status = 200
}).post("/:platform/:l/freeagents/roster", async (ctx) => {
    const { platform, l } = ctx.params
    const roster = ctx.request.body as RosterExport
    const events = roster.rosterInfoList.map(player => ({ key: l, platform: platform, event_type: "MADDEN_PLAYER", ...player }))
    await sendEvents(events)
    ctx.status = 200
})

app
    .use(bodyParser({ enableTypes: ["json"], encoding: "utf-8" }))
    .use(async (ctx, next) => {
        try {
            await next()
        } catch (err: any) {
            console.error(err)
            ctx.status = 500;
            ctx.body = {
                message: err.message
            };
        }
    })
    .use(async (ctx, next) => {
        if (ctx.request?.body?.success) {
            await next()
        } else {
            ctx.status = 200
        }
    })
    .use(router.routes())
    .use(router.allowedMethods())

export default app
