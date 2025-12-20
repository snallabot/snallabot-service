import NodeCache from "node-cache"
import EventDB, { SnallabotEvent, StoredEvent } from "./events_db"
import MaddenDB, { MaddenEvents } from "./madden_db"
import { Team } from "../export/madden_league_types"
import LeagueSettingsDB from "../discord/settings_db"
import { DiscordLeagueConnectionEvent, TeamLogoCustomizedEvent } from "./events"
import FileHandler, { defaultSerializer } from "../file_handlers"

const TTL = 10800 // 3 hours in seconds

export abstract class View<T> {
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

export abstract class CachedUpdatingView<T> extends View<T> {
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

export abstract class StorageBackedCachedView<T> extends View<T> {
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

export type LeagueLogos = {
  [key: string]: TeamLogoCustomizedEvent
}
class CustomTeamLogosView extends View<LeagueLogos> {
  constructor() {
    super("custom_team_logos")
  }
  async createView(key: string) {
    const events = await EventDB.queryEvents<TeamLogoCustomizedEvent>(key, "CUSTOM_LOGO", new Date(0), {}, 100)
    return Object.fromEntries(
      Object.values(
        events.reduce((acc, e) => {
          if (!acc[e.teamAbbr] || e.timestamp > acc[e.teamAbbr].timestamp) {
            acc[e.teamAbbr] = e
          }
          return acc
        }, {} as Record<string, StoredEvent<TeamLogoCustomizedEvent>>)
      ).map(e => [e.teamAbbr, e]))
  }
}
export const leagueLogosView = new CustomTeamLogosView()
