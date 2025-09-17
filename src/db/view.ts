import NodeCache from "node-cache"
import EventDB, { SnallabotEvent } from "./events_db"
import MaddenDB, { MaddenEvents } from "./madden_db"
import { Player, Team } from "../export/madden_league_types"
import LeagueSettingsDB from "../discord/settings_db"
import { DiscordLeagueConnectionEvent } from "./events"
import FileHandler, { defaultSerializer } from "../file_handlers"

const TTL = 10800 // 3 hours in seconds

abstract class View<T> {
  id: string
  constructor(id: string) {
    this.id = id
  }
  abstract createView(key: string): Promise<T | undefined>
}

const viewCache = new NodeCache()

export function getViewCacheStats() {
  return viewCache.getStats()
}

abstract class CachedUpdatingView<T> extends View<T> {
  view: View<T>

  constructor(view: View<T>) {
    super(view.id)
    this.view = view
  }

  createCacheKey(key: string) {
    return key + "|" + this.id
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
        if (currentView) {
          const newView = this.update({ [event_type]: events }, currentView)
          viewCache.set(this.createCacheKey(key), newView, TTL)
        }
      })
    })
  }
}

abstract class StorageBackedCachedView<T> extends View<T> {
  view: View<T>

  constructor(view: View<T>) {
    super(view.id)
    this.view = view
  }

  createCacheKey(key: string) {
    return key + "|" + this.id
  }

  createStorageDirectory(key: string) {
    return `madden_views/${key}/${this.id}`
  }

  async createView(key: string) {
    const cachedView = viewCache.get(this.createCacheKey(key)) as T | undefined
    if (cachedView) {
      return cachedView
    }
    const viewFile = this.createStorageDirectory(key)
    try {
      const storedView = await FileHandler.readFile<T>(viewFile, defaultSerializer<T>())
      viewCache.set(this.createCacheKey(key), storedView, TTL)
      return storedView
    } catch (e) {
      console.log("doing a full recompute on a stored view")
      const view = await this.view.createView(key)
      if (view) {
        viewCache.set(this.createCacheKey(key), view, TTL)
        try {
          await FileHandler.writeFile<T>(view, viewFile, defaultSerializer<T>())
        }
        catch (e2) {
        }
      }
      return view
    }
  }

  abstract update(event: { [key: string]: any[] }, currentView: T): T

  listen(...event_types: string[]) {
    event_types.forEach(event_type => {
      EventDB.on(event_type, async events => {
        const key = events.map(e => e.key)[0]
        const currentView = await this.createView(key)
        if (currentView) {
          const newView = this.update({ [event_type]: events }, currentView)
          viewCache.set(this.createCacheKey(key), newView, TTL)
          await FileHandler.writeFile<T>(newView, this.createStorageDirectory(key), defaultSerializer<T>())
        }
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
    if (event[MaddenEvents.MADDEN_TEAM]) {
      const updatedTeams = event[MaddenEvents.MADDEN_TEAM] as SnallabotEvent<Team>[]
      updatedTeams.forEach(t => {
        currentView[t.teamId] = { cityName: t.cityName, abbrName: t.abbrName, nickName: t.nickName, displayName: t.displayName, id: t.teamId }
      })
    }
    return currentView
  }
}

export const teamSearchView = new CacheableTeamSearchIndex()
teamSearchView.listen(MaddenEvents.MADDEN_TEAM)


class DiscordLeagueConnection extends View<DiscordLeagueConnectionEvent> {
  constructor() {
    super("discord_league_connection")
  }
  async createView(key: string) {
    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(key)
    const leagueId = leagueSettings?.commands?.madden_league?.league_id
    if (leagueId) {
      return { guildId: key, leagueId: leagueId }
    }
  }
}

class CacheableDiscordLeagueConnection extends CachedUpdatingView<DiscordLeagueConnectionEvent> {
  constructor() {
    super(new DiscordLeagueConnection())
  }
  update(event: { [key: string]: any[] }, currentView: DiscordLeagueConnectionEvent) {
    if (event["DISCORD_LEAGUE_CONNECTION"]) {
      const leagueEvents = event["DISCORD_LEAGUE_CONNECTION"] as SnallabotEvent<DiscordLeagueConnectionEvent>[]
      return leagueEvents[0]
    }
    return currentView
  }
}
export const discordLeagueView = new CacheableDiscordLeagueConnection()
discordLeagueView.listen("DISCORD_LEAGUE_CONNECTION")

type PlayerSearch = {
  [key: string]: {
    rosterId: number,
    firstName: string,
    lastName: string,
    teamId: number,
    position: string,
  }
}
class PlayerSearchIndex extends View<PlayerSearch> {
  constructor() {
    super("player_search_index")
  }
  async createView(key: string) {
    const players = await MaddenDB.getLatestPlayers(key)
    return Object.fromEntries(players.map(p => [p.rosterId + "", { rosterId: p.rosterId, firstName: p.firstName, lastName: p.lastName, teamId: p.teamId, position: p.position }]))
  }
}

class CacheablePlayerSearchIndex extends StorageBackedCachedView<PlayerSearch> {
  constructor() {
    super(new PlayerSearchIndex())
  }
  update(event: { [key: string]: any[] }, currentView: PlayerSearch) {
    if (event[MaddenEvents.MADDEN_PLAYER]) {
      const playerUpdates = event[MaddenEvents.MADDEN_PLAYER] as SnallabotEvent<Player>[]
      playerUpdates.forEach(p => {
        currentView[p.rosterId] = { rosterId: p.rosterId, firstName: p.firstName, lastName: p.lastName, teamId: p.teamId, position: p.position }
      })
    }
    return currentView
  }
}
export const playerSearchIndex = new CacheablePlayerSearchIndex()
playerSearchIndex.listen(MaddenEvents.MADDEN_PLAYER)
