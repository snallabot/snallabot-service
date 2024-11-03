import { MaddenGame, Team } from "./madden_types";
import EventDB from "../../db/events_db"

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
        const teamsData = await EventDB.queryEvents<Team>(leagueId, "MADDEN_TEAM", new Date(0), {}, 10000)
        return getLatestEvents(Object.values(Object.groupBy(teamsData, team => team.teamId)))
    },
    getLatestWeekSchedule: async function(leagueId: string, week: number) {
        const maddenSchedule = await EventDB.queryEvents<MaddenGame>(leagueId, "MADDEN_SCHEDULE", new Date(0), { weekIndex: week - 1, stageIndex: 1 }, 10000)
        if (maddenSchedule.length === 0) {
            throw new Error("Missing schedule for week " + week)
        }
        const bySeason = Object.groupBy(maddenSchedule, s => s.seasonIndex)
        const latestSeason = Math.max(...(Object.keys(bySeason).map(i => Number(i))))
        const latestSeasonSchedule = bySeason[latestSeason]
        if (latestSeasonSchedule) {
            return getLatestEvents(Object.values(Object.groupBy(latestSeasonSchedule, w => w.scheduleId)))
        }
        throw new Error("Missing schedule for week " + week)
    },
    getWeekScheduleForSeason: async function(leagueId: string, week: number, season: number) {
        const maddenSchedule = await EventDB.queryEvents<MaddenGame>(leagueId, "MADDEN_SCHEDULE", new Date(0), { weekIndex: week - 1, seasonIndex: season, stageIndex: 1 }, 10000)
        if (maddenSchedule.length === 0) {
            throw new Error("Missing schedule for week " + week)
        }
        return getLatestEvents(Object.values(Object.groupBy(maddenSchedule, w => w.scheduleId)))
    }
} as MaddenClient
