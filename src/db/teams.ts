import { TeamAssignments } from "../discord/settings_db"
import { Team } from "../export/madden_league_types"
import type { StoredEvent } from "./events_db"

// A franchise keeps the same low bits of teamId across syncs (sync bases are
// multiples of 65536, offsets 0-34 in alphabetical default-team order).
// 64 is the smallest power of 2 that holds all 35 offsets.
const SLOT_MODULUS = 64
const slotOf = (t: Team) => t.teamId % SLOT_MODULUS

export interface TeamList {
  getTeamForId(id: number): Team,
  getLatestTeams(): Team[],
  getLatestTeamAssignments(assignments: TeamAssignments): TeamAssignments
}

export function createTeamList(teams: StoredEvent<Team>[]): TeamList {
  const latestTeamMap = new Map<number, Team>()
  const latestTeams: Team[] = []

  Object.values(Object.groupBy(teams, slotOf)).forEach(slotTeams => {
    if (!slotTeams) {
      return
    }
    // same slot means same franchise, even if city, name, logo, or user changed
    const latest = slotTeams.reduce((latest, team) => (team.timestamp > latest.timestamp ? team : latest))
    latestTeams.push(latest)
    slotTeams.forEach(team => latestTeamMap.set(team.teamId, latest))
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
        try {
          const latestTeam = this.getTeamForId(Number(teamId))
          return [latestTeam.teamId + "", assignment]
        } catch (e) {
          return []
        }
      }).filter(e => e.length !== 0))
    }
  }
}
