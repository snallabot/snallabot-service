import NodeCache from "node-cache"
import EventDB, { SnallabotEvent } from "./events_db"
import MaddenDB from "./madden_db"
import { Team } from "../export/madden_league_types"

const TTL = 0

abstract class View<T> {
  id: string
  constructor(id: string) {
    this.id = id
  }
  abstract createView(key: string): Promise<T>
}

const viewCache = new NodeCache()

abstract class CachedUpdatingView<T> extends View<T> {
  view: View<T>

  constructor(view: View<T>) {
    super(view.id)
    this.view = view
  }

  createCacheKey(key: string) {
    return "key|" + this.id
  }

  async createView(key: string) {
    const cachedView = viewCache.get(this.createCacheKey(key)) as T | undefined
    if (cachedView) {
      return cachedView
    }
    const view = await this.view.createView(key)
    viewCache.set(this.createCacheKey(key), view, TTL)
    return view
  }

  abstract update(event: { [key: string]: any[] }, currentView: T): T

  listen(...event_types: string[]) {
    event_types.forEach(event_type => {
      EventDB.on(event_type, async events => {
        const key = events.map(e => e.key)[0]
        const currentView = await this.createView(key)
        const newView = this.update({ event_type: events }, currentView)
        viewCache.set(this.createCacheKey(key), newView, TTL)
        console.log(newView)
        console.log(viewCache.getStats())
      })
    })
  }
}
type TeamSearch = {
  [key: string]: {
    cityName: string,
    abbrName: string,
    nickName: string,
    displayName: string,
    id: number
  }
}
class TeamSearchIndex extends View<TeamSearch> {
  constructor() {
    super("team_search_index")
  }
  async createView(key: string) {
    const teams = await MaddenDB.getLatestTeams(key)
    return Object.fromEntries(teams.getLatestTeams().map(t => { return [`${t.teamId}`, { cityName: t.cityName, abbrName: t.abbrName, nickName: t.nickName, displayName: t.displayName, id: t.teamId }] }))
  }
}

class CacheableTeamSearchIndex extends CachedUpdatingView<TeamSearch> {
  constructor() {
    super(new TeamSearchIndex())
  }

  update(event: { [key: string]: any[] }, currentView: TeamSearch): TeamSearch {
    if (event["MADDEN_TEAM"]) {
      const updatedTeams = event["MADDEN_TEAM"] as SnallabotEvent<Team>[]
      updatedTeams.forEach(t => {
        currentView[t.teamId] = { cityName: t.cityName, abbrName: t.abbrName, nickName: t.nickName, displayName: t.displayName, id: t.teamId }
      })
    }
    return currentView
  }
}

export const teamSearchView = new CacheableTeamSearchIndex()
teamSearchView.listen("MADDEN_TEAM")




