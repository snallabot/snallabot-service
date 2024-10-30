type DefaultEventInfo = {
    platform: string,
    key: string,
    id: string,
    timestamp: string
}

export type Team = {
    ovrRating: number,
    injuryCount: number,
    divName: string,
    cityName: string,
    teamId: number,
    logoId: number,
    abbrName: string,
    userName: string,
    nickName: string,
    offScheme: number,
    secondaryColor: number,
    primaryColor: number,
    defScheme: number,
    displayName: string,
    event_type: "MADDEN_TEAM"
} & DefaultEventInfo

export type MaddenGame = {
    status: number,
    awayScore: number,
    awayTeamId: number,
    weekIndex: number,
    homeScore: number,
    homeTeamId: number,
    scheduleId: number,
    seasonIndex: number,
    isGameOfTheWeek: boolean,
    stageIndex: number,
    event_type: "MADDEN_SCHEDULE",
} & DefaultEventInfo

export const MADDEN_SEASON = 2024

export function getMessageForWeek(week: number) {
    if (week < 1 || week > 23 || week === 22) {
        throw new Error("Invalid week number. Valid weeks are week 1-18 and for playoffs: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
    }
    if (week <= 18) {
        return `Week ${week}`
    } else if (week === 19) {
        return "Wildcard Round"
    } else if (week === 20) {
        return "Divisional Round"
    } else if (week === 21) {
        return "Conference Championship Round"
    } else if (week === 23) {
        return "Super Bowl"
    }
    throw new Error("Unknown week " + week)
}
