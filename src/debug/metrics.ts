
import { RouterContext } from "@koa/router"
import { APIApplicationCommandAutocompleteInteraction, APIChatInputApplicationCommandGuildInteraction, APIInteraction, APIMessageComponentInteraction, InteractionType } from "discord-api-types/v10"
import { Next, ParameterizedContext } from "koa"

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

export const maddenHashCacheTotalRequests = new client.Counter(
  {
    name: "madden_hash_cache_requests_total",
    help: "Total cache requests on madden hash write optimization",
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

export const maddenHashEventChanged = new client.Counter(
  {
    name: "madden_hash_event_changed_total",
    help: "Total events that did not pass the hash check",
    registers: [register],
    labelNames: ["event_type"]
  }
)

export const maddenHashEventsTotal = new client.Counter(
  {
    name: "madden_hash_events_exported_total",
    help: "Total events that were exported",
    registers: [register],
    labelNames: ["event_type"]
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

export const viewCacheTotalRequests = new client.Counter(
  {
    name: "view_cache_requests_total",
    help: "Total Requests on view cache",
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

export const maddenEventsDistribution = new client.Summary({
  name: "madden_events_size_distribution",
  help: "Distribution of madden writes",
  registers: [register],
  labelNames: ["event_type"]
})


export const contentType = register.contentType

export const exportQueueSize = new client.Gauge(
  {
    name: "export_queue_length_total",
    help: "the current length of the export queue",
    registers: [register]
  }
)

export const discordOutgoingRequestsCounter = new client.Counter(
  {
    name: "discord_outgoing_requests_total",
    help: "number of outgoing requests to discord",
    labelNames: [],
    registers: [register]
  }
)

export const maddenDBRequestsCounter = new client.Counter(
  {
    name: "madden_db_requests_counter_total",
    help: "number of requests to the madden db per method",
    registers: [register],
    labelNames: ["method"]
  }
)

export const youtubeChannelsGauge = new client.Gauge(
  {
    name: "broadcasts_youtube_total",
    help: "number of current youtube channels registered",
    registers: [register],
    labelNames: []
  }
)

export const twitchChannelsGauge = new client.Gauge(
  {
    name: "broadcasts_twitch_total",
    help: "number of current twitch channels registered",
    registers: [register],
    labelNames: []
  }
)

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "http request latency in seconds",
  labelNames: ['method', 'endpoint', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 10.0],
  registers: [register],
})

const discordRequestDuration = new client.Histogram({
  name: "discord_request_duration_seconds",
  help: "discord request latency in seconds",
  labelNames: ['command_type', 'command_name'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1.0, 2.5, 5.0, 10.0],
  registers: [register],
})

export async function latencyMiddleware(ctx: RouterContext, next: Next) {
  const end = httpRequestDuration.startTimer()
  await next()
  const method = ctx.method
  const endpoint = ctx.routerPath ?? "unmatched"
  const status = ctx.status
  ctx.res.on('finish', () => {
    end({
      method: method,
      endpoint: endpoint,
      status: status
    })
  })
}

function measure(ctx: ParameterizedContext, commandType: string, commandName: string) {
  const end = discordRequestDuration.startTimer()
  ctx.res.on('finish', () => {
    end({
      command_type: commandType,
      command_name: commandName
    })
  })
}

export async function discordLatencyMiddleware(ctx: ParameterizedContext, next: Next) {
  const interaction = ctx.request.body as APIInteraction
  const { type: interactionType } = interaction
  if (interactionType === InteractionType.ApplicationCommand) {
    const slashCommandInteraction = interaction as APIChatInputApplicationCommandGuildInteraction
    const { data } = slashCommandInteraction
    const { name } = data
    measure(ctx, "SLASH", name)
  } else if (interactionType === InteractionType.ApplicationCommandAutocomplete) {
    const slashCommandInteraction = interaction as APIApplicationCommandAutocompleteInteraction
    const { data } = slashCommandInteraction
    const { name } = data
    measure(ctx, "AUTOCOMPLETE", name)
  } // else if (interactionType === InteractionType.MessageComponent) {
  //   const messageComponentInteraction = interaction as APIMessageComponentInteraction
  //   const { data } = messageComponentInteraction
  //   const { custom_id } = data
  //   // todo ??? dont like it
  //   const metricCustomId = custom_id.startsWith("trade_vote:")
  //     ? "trade_vote"
  //     : custom_id.startsWith("trade_player:")
  //       ? "trade_player"
  //       : custom_id;
  //   measure(ctx, "MESSAGE_COMPONENT", metricCustomId)
  // }
  await next()
}
