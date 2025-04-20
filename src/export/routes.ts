import Router from "@koa/router"
import { ParameterizedContext, Next } from "koa"
import { RosterExport, TeamExport, StandingExport, SchedulesExport, PuntingExport, TeamStatsExport, PassingExport, KickingExport, RushingExport, DefensiveExport, ReceivingExport } from "./madden_league_types"
import { ExportResult, MaddenExportDestination, SnallabotExportDestination } from "./exporter"
import { Stage } from "../dashboard/ea_client"
const router = new Router()

async function maddenExportErrorMiddleware(ctx: ParameterizedContext, next: Next) {
  if (ctx.request?.body?.success === undefined) {
    ctx.status = 400
  } else {
    if (ctx.request.body.success) {
      await next()
    }

  }
}

function toStage(exportStage: string): Stage {
  return exportStage === "reg" ? Stage.SEASON : Stage.PRESEASON
}

router.post("/:platform/:l/leagueteams", maddenExportErrorMiddleware, async (ctx, next) => {
  const { platform, l } = ctx.params
  const teamsExport = ctx.request.body as TeamExport
  await SnallabotExportDestination.leagueTeams(platform, l, teamsExport)
  ctx.status = 200
}).post("/:platform/:l/standings", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l } = ctx.params
  const standingsExport = ctx.request.body as StandingExport
  await SnallabotExportDestination.standings(platform, l, standingsExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/schedules", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const schedulesExport = ctx.request.body as SchedulesExport
  await SnallabotExportDestination.schedules(platform, l, Number.parseInt(week), toStage(stage), schedulesExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/punting", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const puntingExport = ctx.request.body as PuntingExport
  await SnallabotExportDestination.punting(platform, l, Number.parseInt(week), toStage(stage), puntingExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/teamstats", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const teamStatsExport = ctx.request.body as TeamStatsExport
  await SnallabotExportDestination.teamStats(platform, l, Number.parseInt(week), toStage(stage), teamStatsExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/passing", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const passingStatsExport = ctx.request.body as PassingExport
  await SnallabotExportDestination.passing(platform, l, Number.parseInt(week), toStage(stage), passingStatsExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/kicking", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const kickingStatsExport = ctx.request.body as KickingExport
  await SnallabotExportDestination.kicking(platform, l, Number.parseInt(week), toStage(stage), kickingStatsExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/rushing", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const rushingStatsExport = ctx.request.body as RushingExport
  await SnallabotExportDestination.rushing(platform, l, Number.parseInt(week), toStage(stage), rushingStatsExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/defense", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const defensiveStatsExport = ctx.request.body as DefensiveExport
  await SnallabotExportDestination.defense(platform, l, Number.parseInt(week), toStage(stage), defensiveStatsExport)
  ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/receiving", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, week, stage } = ctx.params
  const receivingStatsExport = ctx.request.body as ReceivingExport
  await SnallabotExportDestination.receiving(platform, l, Number.parseInt(week), toStage(stage), receivingStatsExport)
  ctx.status = 200
}).post("/:platform/:l/freeagents/roster", async (ctx) => {
  const { platform, l } = ctx.params
  const roster = ctx.request.body as RosterExport
  await SnallabotExportDestination.freeagents(platform, l, roster)
  ctx.status = 200
}).post("/:platform/:l/team/:team/roster", maddenExportErrorMiddleware, async (ctx) => {
  const { platform, l, team } = ctx.params
  const roster = ctx.request.body as RosterExport
  await SnallabotExportDestination.teamRoster(platform, l, team, roster)
  ctx.status = 200
})

export default router
