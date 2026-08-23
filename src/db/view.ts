import NodeCache from "node-cache"
import EventDB, { SnallabotEvent, StoredEvent } from "./events_db"
import LeagueSettingsDB from "../discord/settings_db"
import { DiscordLeagueConnectionEvent, TeamLogoCustomizedEvent } from "./events"
import FileHandler, { defaultSerializer } from "../file_handlers"
import { viewCacheHits, viewCacheTotalRequests } from "../debug/metrics"
import fastq from 'fastq'
import type { queueAsPromised } from 'fastq'

const TTL = 36000 // 10 hours in seconds

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
    viewCacheTotalRequests.inc({ view_id: this.view.id })
    if (cachedView) {
      viewCacheHits.inc({ view_id: this.view.id })
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

type UpdateTask = {
  key: string
  event_type: string
  events: any[]
}


export abstract class StorageBackedCachedView<T> extends View<T> {
  view: View<T>
  private updateQueues: Map<string, queueAsPromised<UpdateTask>>

  constructor(view: View<T>) {
    super(view.id)
    this.view = view
    this.updateQueues = new Map()
  }

  private getQueue(key: string): queueAsPromised<UpdateTask> {
    if (!this.updateQueues.has(key)) {
      const queue = fastq.promise(this, this.processUpdate, 1)
      this.updateQueues.set(key, queue)
    }
    return this.updateQueues.get(key)!
  }

  private async processUpdate(task: UpdateTask): Promise<void> {
    const { key, event_type, events } = task
    const currentView = await this.createView(key)
    if (currentView) {
      const newView = this.update({ [event_type]: events }, currentView)
      viewCache.set(this.createCacheKey(key), newView, TTL)
      await FileHandler.writeFile<T>(newView, this.createStorageDirectory(key), defaultSerializer<T>())
    }
  }

  createCacheKey(key: string) {
    return key + "|" + this.id
  }

  createStorageDirectory(key: string) {
    return `madden_views/${key}/${this.id}`
  }

  async createView(key: string) {
    const cachedView = viewCache.get(this.createCacheKey(key)) as T | undefined
    viewCacheTotalRequests.inc({ view_id: this.view.id })
    if (cachedView) {
      viewCacheHits.inc({ view_id: this.view.id })
      return cachedView
    }
    const viewFile = this.createStorageDirectory(key)
    try {
      const storedView = await FileHandler.readFile<T>(viewFile, defaultSerializer<T>())
      viewCache.set(this.createCacheKey(key), storedView, TTL)
      return storedView
    } catch (e) {
      const view = await this.view.createView(key)
      if (view) {
        viewCache.set(this.createCacheKey(key), view, TTL)
        try {
          await FileHandler.writeFile<T>(view, viewFile, defaultSerializer<T>())
        }
        catch (e2) {
          console.error(e2)
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
        const queue = this.getQueue(key)

        // Push task to queue - it will be processed sequentially
        await queue.push({
          key,
          event_type,
          events
        })
      })
    })
  }
}


class DiscordLeagueConnection extends View<DiscordLeagueConnectionEvent> {
  constructor() {
    super("discord_league_connection")
  }
  async createView(key: string) {
    if (key) {
      const [leagueIds, leagueNames] = await Promise.all([
        LeagueSettingsDB.getMaddenLeagueIds(key),
        LeagueSettingsDB.getMaddenLeagueNames(key)
      ])
      return {
        guildId: key,
        leagues: leagueIds.map(leagueId => ({ leagueId, leagueName: leagueNames[leagueId] || leagueId }))
      }
    }
  }
}

export type SelectedDiscordLeagueConnection = { guildId: string, leagueId: string }

class CacheableDiscordLeagueConnection extends CachedUpdatingView<DiscordLeagueConnectionEvent> {
  constructor() {
    super(new DiscordLeagueConnection())
  }
  async createSelectedView(key: string, selectedLeague?: string): Promise<SelectedDiscordLeagueConnection | undefined> {
    const connection = await this.createView(key)
    if (!connection) return undefined

    const defaultLeague = selectedLeague || await LeagueSettingsDB.getMaddenLeagueId(key)
    const leagueIds = connection.leagues.map(league => league.leagueId)
    const leagueId = defaultLeague && leagueIds.includes(defaultLeague)
      ? defaultLeague
      : leagueIds[0]
    if (!leagueId) return undefined
    return { guildId: connection.guildId, leagueId }
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
