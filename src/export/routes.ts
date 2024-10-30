import Router from "@koa/router"
import { ParameterizedContext, Next } from "koa"
import { RosterExport, TeamExport, StandingExport, SchedulesExport, PuntingExport, TeamStatsExport, PassingExport, KickingExport, RushingExport, DefensiveExport, ReceivingExport } from "./madden_league_types"
import db from "./../db/firebase"
const hash: (a: any) => string = require("object-hash")

const router = new Router()


type Node = {
    hash: string,
    children: Array<Node>
}

type MerkleTree = {
    headNode: Node
}

function flatten(tree: MerkleTree): Array<Node> {
    return tree.headNode.children.concat(tree.headNode.children.flatMap(n => flatten({ headNode: n })))
}

function findDifferences(incoming: MerkleTree, old: MerkleTree): Array<string> {
    if (incoming.headNode.hash === old.headNode.hash) {
        return []
    } else {
        const oldHashes = Object.fromEntries(old.headNode.children.map(h => [h.hash, h]))
        return incoming.headNode.children.flatMap(c => {
            if (oldHashes[c.hash]) {
                return []
            }
            return [c.hash].concat(flatten({ headNode: c }).map(n => n.hash))
        })
    }
}

function createTwoLayer(nodes: Array<Node>): MerkleTree {
    const topHash = hash(nodes.map(c => c.hash))
    return { headNode: { hash: topHash, children: nodes } }
}

async function retrieveTree(league: string, request_type: string): Promise<MerkleTree> {
    const doc = await db.collection("madden_league_trees").doc(league).collection(request_type).doc("mtree").get()
    if (doc.exists) {
        const d = doc.data()
        return d as MerkleTree
    }
    return { headNode: { children: [], hash: hash("") } }
}


async function writeTree(league: string, request_type: string, tree: MerkleTree): Promise<void> {
    await db.collection("madden_league_trees").doc(league).collection(request_type).doc("mtree").set(tree, { merge: true })
}


async function sendEvents<T>(league: string, request_type: string, events: Array<T>, identifier: (e: T) => number): Promise<void> {
    const oldTree = await retrieveTree(league, request_type)
    const hashToEvent = new Map(events.map(e => [hash(e), e]))
    const newNodes = events.sort(e => identifier(e)).map(e => ({ hash: hash(e), children: [] }))

    const newTree = createTwoLayer(newNodes)
    const hashDifferences = findDifferences(newTree, oldTree)
    if (hashDifferences.length > 0) {
        writeTree(league, request_type, newTree)
        console.log(request_type + " found these many differences " + hashDifferences.length)
        // if (hashDifferences.length > 0) {
        // console.log(newNodes)
        // }
        const finalEvents = hashDifferences.map(h => hashToEvent.get(h)).filter(e => e)
        console.log(request_type + " sending these amount of events " + finalEvents.length)
        await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/batchPost", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                batch: finalEvents,
                delivery: "EVENT_SOURCE"
            })
        })
    }
    // else {
    //     console.debug("skipped writing!")
    // }
}

async function maddenExportErrorMiddleware(ctx: ParameterizedContext, next: Next) {
    if (ctx.request?.body?.success === undefined) {
        ctx.status = 400
    } else {
        if (ctx.request.body.success) {
            await next()
        }

    }
}


router.post("/:platform/:l/leagueteams", maddenExportErrorMiddleware, async (ctx, next) => {
    const { platform, l } = ctx.params
    const teamsExport = ctx.request.body as TeamExport
    const events = teamsExport.leagueTeamInfoList.map(team => (
        { key: l, platform: platform, event_type: "MADDEN_TEAM", ...team }
    ))
    await sendEvents(l, "leagueteams", events, e => e.teamId)
    ctx.status = 200
}).post("/:platform/:l/standings", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l } = ctx.params
    const standingsExport = ctx.request.body as StandingExport
    const events = standingsExport.teamStandingInfoList.map(standing => ({ key: l, platform: platform, event_type: "MADDEN_STANDING", ...standing }))
    await sendEvents(l, "standings", events, e => e.teamId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/schedules", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const schedulesExport = ctx.request.body as SchedulesExport
    const events = schedulesExport.gameScheduleInfoList.map(game => ({ key: l, platform: platform, event_type: "MADDEN_SCHEDULE", ...game }))
    await sendEvents(l, `schedules${stage}-${week}`, events, e => e.scheduleId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/punting", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const puntingExport = ctx.request.body as PuntingExport
    const events = puntingExport.playerPuntingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_PUNTING_STAT", ...stat }))
    await sendEvents(l, `punting${stage}-${week}`, events, e => e.statId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/teamstats", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const teamStatsExport = ctx.request.body as TeamStatsExport
    const events = teamStatsExport.teamStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_TEAM_STAT", ...stat }))
    await sendEvents(l, `teamstats${stage}-${week}`, events, e => e.statId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/passing", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const passingStatsExport = ctx.request.body as PassingExport
    const events = passingStatsExport.playerPassingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_PASSING_STAT", ...stat }))
    await sendEvents(l, `passing${stage}-${week}`, events, e => e.statId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/kicking", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const kickingStatsExport = ctx.request.body as KickingExport
    const events = kickingStatsExport.playerKickingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_KICKING_STAT", ...stat }))
    await sendEvents(l, `kicking${stage}-${week}`, events, e => e.statId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/rushing", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const rushingStatsExport = ctx.request.body as RushingExport
    const events = rushingStatsExport.playerRushingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_RUSHING_STAT", ...stat }))
    await sendEvents(l, `rushing${stage}-${week}`, events, e => e.statId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/defense", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const defensiveStatsExport = ctx.request.body as DefensiveExport
    const events = defensiveStatsExport.playerDefensiveStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_DEFENSIVE_STAT", ...stat }))
    await sendEvents(l, `defense${stage}-${week}`, events, e => e.statId)
    ctx.status = 200
}).post("/:platform/:l/week/:stage/:week/receiving", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, week, stage } = ctx.params
    const receivingStatsExport = ctx.request.body as ReceivingExport
    const events = receivingStatsExport.playerReceivingStatInfoList.map(stat => ({ key: l, platform: platform, event_type: "MADDEN_RECEIVING_STAT", ...stat }))
    await sendEvents(l, `receiving${stage}-${week}`, events, e => e.statId)
    ctx.status = 200
}).post("/:platform/:l/freeagents/roster", async (ctx) => {
    const { platform, l } = ctx.params
    const roster = ctx.request.body as RosterExport
    const events = roster.rosterInfoList.map(player => ({ key: l, platform: platform, event_type: "MADDEN_PLAYER", ...player }))
    await sendEvents(l, `rosterfreeagents`, events, e => e.rosterId)
    ctx.status = 200
}).post("/:platform/:l/team/:team/roster", maddenExportErrorMiddleware, async (ctx) => {
    const { platform, l, team } = ctx.params
    const roster = ctx.request.body as RosterExport
    const events = roster.rosterInfoList.map(player => ({ key: l, platform: platform, event_type: "MADDEN_PLAYER", team: team, ...player }))
    await sendEvents(l, `roster${team}`, events, e => e.rosterId)
    ctx.status = 200
})

export default router