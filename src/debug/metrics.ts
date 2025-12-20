const client = require('prom-client')
const register = new client.Registry()
const collectDefaultMetrics = client.collectDefaultMetrics
collectDefaultMetrics({ register })

export async function scrapeMetrics() {
  return await register.metrics()
}

export const exportCounter = new client.Counter(
  {
    name: "madden_exports_total",
    help: "number of exports",
    labelNames: ["export_type"],
    registers: [register]
  }
)

export const discordCommandsCounter = new client.Counter(
  {
    name: "discord_commands_total",
    help: "number of commands",
    labelNames: ["command_name", "command_type"],
    registers: [register]
  }
)

export const debugCounter = new client.Counter(
  {
    name: "debug_counter_total",
    help: "tests metrics in bot",
    registers: [register]
  }
)

export const maddenHashCacheHits = new client.Counter(
  {
    name: "madden_hash_cache_hits_total",
    help: "Cache hits on madden hash write optimization",
    registers: [register]
  }
)

export const maddenHashCacheMisses = new client.Counter(
  {
    name: "madden_hash_cache_misses_total",
    help: "Cache misses on madden hash write optimization",
    registers: [register]
  }
)

export const maddenHashCacheSize = new client.Gauge(
  {
    name: "madden_hash_cache_size_bytes_total",
    help: "Madden hash cache size in bytes",
    registers: [register]
  }
)

export const viewCacheHits = new client.Counter(
  {
    name: "view_cache_hits_total",
    help: "Cache hits on views",
    registers: [register],
    labelNames: ["view_id"]
  }
)

export const viewCacheMisses = new client.Counter(
  {
    name: "view_cache_misses_total",
    help: "Cache misses on views",
    registers: [register],
    labelNames: ["view_id"]
  }
)

export const viewCacheSize = new client.Gauge(
  {
    name: "view_cache_size_bytes_total",
    help: "View cache size in bytes",
    registers: [register]
  }
)



export const contentType = register.contentType
