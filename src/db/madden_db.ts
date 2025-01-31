import { randomUUID } from "crypto"
import { Timestamp, Filter } from "firebase-admin/firestore"
import db from "./firebase"
import EventDB, { EventNotifier, SnallabotEvent, StoredEvent, notifiers } from "./events_db"
import { MaddenGame, Player, Standing, Team } from "../export/madden_league_types"
import { TeamAssignment, TeamAssignments } from "../discord/settings_db"

type HistoryUpdate<ValueType> = { oldValue: ValueType, newValue: ValueType }
type History = { [key: string]: HistoryUpdate<any> }
type StoredHistory = { timestamp: Date } & History


interface MaddenDB {
  appendEvents<Event>(event: SnallabotEvent<Event>[], idFn: (event: Event) => string): Promise<void>
  on<Event>(event_type: string, notifier: EventNotifier<Event>): void,
  getLatestTeams(leagueId: string): Promise<TeamList>,
  getLatestWeekSchedule(leagueId: string, week: number): Promise<MaddenGame[]>,
  getWeekScheduleForSeason(leagueId: string, week: number, season: number): Promise<MaddenGame[]>
  getGameForSchedule(leagueId: string, scheduleId: number): Promise<MaddenGame>,
  getStandingForTeam(leagueId: string, teamId: number): Promise<Standing>,
  getLatestStandings(leagueId: string): Promise<Standing[]>,
  getLatestPlayers(leagueId: string): Promise<Player[]>
}

function convertDate(firebaseObject: any) {
  if (!firebaseObject) return null;

  for (const [key, value] of Object.entries(firebaseObject)) {

    // covert items inside array
    if (value && Array.isArray(value))
      firebaseObject[key] = value.map(item => convertDate(item));

    // convert inner objects
    if (value && typeof value === 'object') {
      firebaseObject[key] = convertDate(value);
    }

    // convert simple properties
    if (value && value.hasOwnProperty('_seconds'))
      firebaseObject[key] = (value as Timestamp).toDate();
  }
  return firebaseObject;
}

function createEventHistoryUpdate(newEvent: Record<string, any>, oldEvent: Record<string, any>): History {
  const change: History = {}
  Object.keys(newEvent).forEach(key => {
    const oldValue = oldEvent[key]
    if (typeof oldValue !== 'object') {
      const newValue = newEvent[key]
      if (newValue !== oldValue) {
        change[key] = {} as HistoryUpdate<any>
        oldValue !== undefined && (change[key].oldValue = oldValue)
        newValue !== undefined && (change[key].newValue = newValue)
      }
    }
  })
  return change
}

export interface TeamList {
  getTeamForId(id: number): Team,
  getLatestTeams(): Team[],
  getLatestTeamAssignments(assignments: TeamAssignments): TeamAssignments
}

function createTeamList(teams: StoredEvent<Team>[]): TeamList {
  const latestTeamMap = new Map<number, Team>()
  const latestTeams: Team[] = []
  Object.entries(Object.groupBy(teams, t => t.divName)).forEach(divisionTeams => {
    const [_, divTeams] = divisionTeams
    if (!divTeams) {
      return
    }
    const matchingTeams = Object.values(Object.groupBy(divTeams, t => t.cityName)).filter((t): t is StoredEvent<Team>[] => !!t)
    const unMatched = matchingTeams.filter(t => t && t.length === 1).flat()
    const matched = matchingTeams.filter(t => t && t.length !== 1)
    matched.forEach(matchedTeams => {
      const latestTeam = matchedTeams.reduce((latest, team) => (team.timestamp > latest.timestamp ? team : latest))
      latestTeams.push(latestTeam)
      matchedTeams.forEach(team => latestTeamMap.set(team.teamId, latestTeam))
    })
    if (unMatched.length > 0) {
      // lets just assume the unmatched are normal teams
      unMatched.forEach(unmatched => {
        latestTeams.push(unmatched)
        latestTeamMap.set(unmatched.teamId, unmatched)
      })
    }
  })
  return {
    getTeamForId: function(id: number): Team {
      const team = latestTeamMap.get(id)
      if (team) {
        return team
      }
      throw new Error("Team not found for id " + id)
    },
    getLatestTeams: function(): Team[] { return latestTeams },
    getLatestTeamAssignments: function(assignments: TeamAssignments): TeamAssignments {
      return Object.fromEntries(Object.entries(assignments).map(entry => {
        const [teamId, assignment] = entry
        const latestTeam = this.getTeamForId(Number(teamId))
        return [latestTeam.teamId + "", assignment]
      }))
    }
  }
}


const MaddenDB: MaddenDB = {
  async appendEvents<Event>(events: SnallabotEvent<Event>[], idFn: (event: Event) => string) {
    const batch = db.batch()
    const timestamp = new Date()
    await Promise.all(events.map(async event => {
      const eventId = idFn(event)
      const doc = db.collection("league_data").doc(event.key).collection(event.event_type).doc(eventId)
      const fetchedDoc = await doc.get()
      if (fetchedDoc.exists) {
        const { timestamp: oldTimestamp, id, ...oldEvent } = fetchedDoc.data() as StoredEvent<Event>
        const change = createEventHistoryUpdate(event, oldEvent)
        if (Object.keys(change).length > 0) {
          const changeId = randomUUID()
          const historyDoc = db.collection("league_data").doc(event.key).collection(event.event_type).doc(eventId).collection("history").doc(changeId)
          batch.set(historyDoc, { ...change, timestamp: timestamp })
        }
      }
      batch.set(doc, { ...event, timestamp: timestamp, id: eventId })
    }))
    let retryCount = 0
    while (retryCount < 10) {
      try {
        await batch.commit()
        break
      } catch (e) {
        retryCount = retryCount + 1
        await new Promise((r) => setTimeout(r, 1000))
        console.log("errored, slept and retrying")
      }
    }
    Object.entries(Object.groupBy(events, e => e.event_type)).map(async entry => {
      const [eventType, specificTypeEvents] = entry
      if (specificTypeEvents) {
        const eventTypeNotifiers = notifiers[eventType]
        if (eventTypeNotifiers) {
          await Promise.all(eventTypeNotifiers.map(async notifier => {
            try {
              await notifier(specificTypeEvents)
            } catch (e) {
              console.log("could not send event to notifier " + e)
            }
          }))
        }
      }
    })
  },
  on<Event>(event_type: string, notifier: EventNotifier<Event>) {
    EventDB.on(event_type, notifier)
  },
  getLatestTeams: async function(leagueId: string): Promise<TeamList> {
    const teamDocs = await db.collection("league_data").doc(leagueId).collection("MADDEN_TEAM").get()
    return createTeamList(teamDocs.docs.filter(d => d.id !== "leagueteams").map(d => d.data() as StoredEvent<Team>))
  },
  getLatestWeekSchedule: async function(leagueId: string, week: number) {
    const weekDocs = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").where("weekIndex", "==", week - 1)
      .where("stageIndex", "==", 1).get()
    const maddenSchedule = weekDocs.docs.filter(d => !d.id.startsWith("schedules")).map(d => d.data() as SnallabotEvent<MaddenGame>)
    if (maddenSchedule.length === 0) {
      throw new Error("Missing schedule for week " + week)
    }
    const bySeason = Object.groupBy(maddenSchedule, s => s.seasonIndex)
    const latestSeason = Math.max(...(Object.keys(bySeason).map(i => Number(i))))
    const latestSeasonSchedule = bySeason[latestSeason]
    if (latestSeasonSchedule) {
      return latestSeasonSchedule
    }
    throw new Error("Missing schedule for week " + week)
  },
  getWeekScheduleForSeason: async function(leagueId: string, week: number, season: number) {
    const weekDocs = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").where("weekIndex", "==", week - 1).where("seasonIndex", "==", season)
      .where("stageIndex", "==", 1).get()
    const maddenSchedule = weekDocs.docs.filter(d => !d.id.startsWith("schedules")).map(d => d.data() as SnallabotEvent<MaddenGame>)
    if (maddenSchedule.length === 0) {
      throw new Error("Missing schedule for week " + week)
    }
    return maddenSchedule
  },
  getGameForSchedule: async function(leagueId: string, scheduleId: number) {
    const schedule = await db.collection("league_data").doc(leagueId).collection("MADDEN_SCHEDULE").doc(`${scheduleId}`).get()
    if (!schedule.exists) {
      throw new Error("Schedule not found for id " + scheduleId)
    }
    return schedule.data() as MaddenGame
  },
  getStandingForTeam: async function(leagueId: string, teamId: number) {
    const standing = await db.collection("league_data").doc(leagueId).collection("MADDEN_STANDING").doc(`${teamId}`).get()
    if (!standing.exists) {
      throw new Error("standing not found for id " + teamId)
    }
    return standing.data() as Standing
  },
  getLatestStandings: async function(leagueId: string) {
    const standingSnapshot = await db.collection("league_data").doc(leagueId).collection("MADDEN_STANDING").get()
    return standingSnapshot.docs.filter(d => d.id !== "standings").map(doc => {
      return doc.data() as SnallabotEvent<Standing>
    })
  },
  getLatestPlayers: async function(leagueId: string) {
    const playerSnapshot = await db.collection("league_data").doc(leagueId).collection("MADDEN_PLAYER").get()
    return playerSnapshot.docs.filter(d => !d.id.startsWith("roster")).map(doc => {
      return doc.data() as SnallabotEvent<Player>
    })
  }
}

export default MaddenDB
