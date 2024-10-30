import { MaddenGame, Team } from "./madden_types";

interface MaddenClient {
    getLatestTeams(leagueId: string): Promise<Array<Team>>,
    getLatestWeekSchedule(leagueId: string, week: number): Promise<Array<MaddenGame>>,
    getWeekScheduleForSeason(leagueId: string, week: number, season: number): Promise<Array<MaddenGame>>
}

function eventSorter(a1: { timestamp: string }, b1: { timestamp: string }) {
    return new Date(b1.timestamp).getTime() - new Date(a1.timestamp).getTime()
}

function getLatestEvents(a: Array<Array<{ timestamp: string }> | undefined>) {
    return a.flatMap(a => a ? [a.sort(eventSorter)[0]] : [])
}

export default {
    getLatestTeams: async function(leagueId: string) {
        const res = await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/query", {
            method: "POST",
            body: JSON.stringify({ event_types: ["MADDEN_TEAM"], key: leagueId, after: 0, limit: 10000 }),
            headers: {
                "Content-Type": "application/json"
            }
        })
        if (!res.ok) {
            const t = await res.text()
            throw new Error("Could not retrieve events " + t)
        }
        const teamsData = await res.json() as { "MADDEN_TEAM": Array<Team> }
        return getLatestEvents(Object.values(Object.groupBy(teamsData.MADDEN_TEAM, team => team.teamId)))

    },
    getLatestWeekSchedule: async function(leagueId: string, week: number) {
        const res = await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/query", {
            method: "POST",
            body: JSON.stringify({ event_types: ["MADDEN_SCHEDULE"], key: leagueId, after: 0, filter: { weekIndex: week - 1, stageIndex: 1 }, limit: 10000 }),
            headers: {
                "Content-Type": "application/json"
            }
        })
        if (!res.ok) {
            const t = await res.text()
            throw new Error("Could not retrieve events " + t)
        }
        const schedulesData = await res.json() as { "MADDEN_SCHEDULE": Array<MaddenGame> | undefined }
        if (!schedulesData.MADDEN_SCHEDULE) {
            throw new Error("Missing schedule for week " + week)
        }
        const bySeason = Object.groupBy(schedulesData.MADDEN_SCHEDULE, s => s.seasonIndex)
        const latestSeason = Math.max(...(Object.keys(bySeason).map(i => Number(i))))
        const latestSeasonSchedule = bySeason[latestSeason]
        if (latestSeasonSchedule) {
            return getLatestEvents(Object.values(Object.groupBy(latestSeasonSchedule, w => w.scheduleId)))
        }
        throw new Error("Missing schedule for week " + week)
    },
    getWeekScheduleForSeason: async function(leagueId: string, week: number, season: number) {
        const res = await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/query", {
            method: "POST",
            body: JSON.stringify({ event_types: ["MADDEN_SCHEDULE"], key: leagueId, after: 0, filter: { weekIndex: week - 1, seasonIndex: season, stageIndex: 1 }, limit: 10000 }),
            headers: {
                "Content-Type": "application/json"
            }
        })
        if (!res.ok) {
            const t = await res.text()
            throw new Error("Could not retrieve events " + t)
        }
        const schedulesData = await res.json() as { "MADDEN_SCHEDULE": Array<MaddenGame> | undefined }
        if (!schedulesData.MADDEN_SCHEDULE) {
            throw new Error("Missing schedule for week " + week)
        }
        return getLatestEvents(Object.values(Object.groupBy(schedulesData.MADDEN_SCHEDULE, w => w.scheduleId)))
    }
} as MaddenClient
