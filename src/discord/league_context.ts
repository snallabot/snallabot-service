import { AsyncLocalStorage } from "node:async_hooks"

type LeagueContext = { guildId: string, leagueId: string }

const leagueContext = new AsyncLocalStorage<LeagueContext>()

export function runWithLeague<T>(guildId: string, leagueId: string | undefined, callback: () => Promise<T>): Promise<T> {
  return leagueId ? leagueContext.run({ guildId, leagueId }, callback) : callback()
}

export function selectedLeagueForGuild(guildId: string): string | undefined {
  const current = leagueContext.getStore()
  return current?.guildId === guildId ? current.leagueId : undefined
}
