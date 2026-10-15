import MaddenDB, { SmallPlayerIndex, createPlayerKey, createRetiredPlayerCheck } from "./madden_db"
import EventDB, { EventDelivery } from "./events_db"
import { EventTypes, RetiredPlayersEvent } from "./events"
import { RosterExport } from "../export/madden_league_types"

// Records which rosters EA sent during one export, and which players were on them.
// Afterwards, a stored player is retired if their team's roster came back but they were not on it
// (or on any other roster, which covers trades).
// Players whose team EA did not send are skipped and checked on a later export.
export class RosterSweep {
  // Team ids (0 for free agents) whose roster came back
  private loadedTeamIds = new Set<string>()
  // Every player on any roster EA sent
  private seenPlayerKeys = new Set<string>()

  add(teamId: number, roster: RosterExport) {
    const players = roster?.rosterInfoList ?? []
    // An empty roster is treated as not sent
    if (players.length > 0) {
      this.loadedTeamIds.add(`${teamId}`)
      players.forEach(player => this.seenPlayerKeys.add(createPlayerKey(player)))
    }
  }

  findRetiredPlayers(players: SmallPlayerIndex[], isRetired: (player: SmallPlayerIndex) => boolean) {
    return players.filter(player => this.loadedTeamIds.has(player.teamId) && !this.seenPlayerKeys.has(createPlayerKey(player)) && !isRetired(player))
  }

  // Never throws, a failure to retire players should not fail the export
  async retireMissingPlayers(leagueId: string) {
    try {
      const [players, isRetired] = await Promise.all([MaddenDB.getLatestPlayers(leagueId), createRetiredPlayerCheck(leagueId)])
      const newlyRetired = this.findRetiredPlayers(players, isRetired)
      if (newlyRetired.length === 0) {
        return
      }
      const retiredPlayers = newlyRetired.map(p => ({ presentationId: p.presentationId, birthYear: p.birthYear, birthMonth: p.birthMonth, birthDay: p.birthDay, rosterId: p.rosterId }))
      await EventDB.appendEvents<RetiredPlayersEvent>([{ key: leagueId, event_type: EventTypes.RETIRED_PLAYERS, retiredPlayers }], EventDelivery.EVENT_SOURCE)
      console.log(`League ${leagueId}: retired ${retiredPlayers.length} players`)
    } catch (e) {
      console.error(`League ${leagueId}: could not retire players, ${e}`)
    }
  }
}
