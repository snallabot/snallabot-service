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
    name: "discord_commands",
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

export const contentType = register.contentType
