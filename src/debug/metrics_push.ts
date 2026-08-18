import client from 'prom-client'

const register = new client.Registry()

const PUSHGATEWAY_URL = process.env.PUSHGATEWAY_URL

const gateway = PUSHGATEWAY_URL
  ? new client.Pushgateway(PUSHGATEWAY_URL, {}, register)
  : null

export const leaguesCheckedCount = new client.Gauge({
  name: 'league_check_leagues_checked',
  help: 'Number of leagues checked in the last cycle',
  registers: [register]
})

export const leaguesErroredCount = new client.Gauge({
  name: 'league_check_leagues_errored',
  help: 'Number of leagues that errored during the last check cycle',
  registers: [register]
})

export const leagueCheckCycleDuration = new client.Gauge({
  name: 'league_check_cycle_duration_seconds',
  help: 'How long the full league check cycle took',
  registers: [register]
})

export const leagueCheckLastCompleted = new client.Gauge({
  name: 'league_check_last_completed_timestamp',
  help: 'Unix timestamp when the last league check cycle completed',
  registers: [register]
})

export const channelsStreamingCount = new client.Gauge({
  name: 'youtube_check_channels_streaming',
  help: 'Number of channels currently live streaming',
  registers: [register]
})

export const broadcastsSentCount = new client.Gauge({
  name: 'youtube_check_broadcasts_sent',
  help: 'Number of new broadcasts sent out in the last cycle',
  registers: [register]
})

export const youtubeCheckCycleDuration = new client.Gauge({
  name: 'youtube_check_cycle_duration_seconds',
  help: 'How long the full youtube check cycle took',
  registers: [register]
})

export const youtubeCheckLastCompleted = new client.Gauge({
  name: 'youtube_check_last_completed_timestamp',
  help: 'Unix timestamp when the last youtube check cycle completed successfully',
  registers: [register]
})

export const notifierLeaguesCheckedCount = new client.Gauge({
  name: 'notifier_check_leagues_checked',
  help: 'Number of leagues checked in this run',
  registers: [register]
})

export const channelsCheckedCount = new client.Gauge({
  name: 'notifier_check_channels_checked',
  help: 'Number of channels checked in this run',
  registers: [register]
})

export const notifierCheckLastRun = new client.Gauge({
  name: 'notifier_check_last_run_timestamp',
  help: 'Unix timestamp of the last notifier check run',
  registers: [register]
})

export async function pushMetrics(jobName: string, instance: string) {
  if (!gateway) {
    return
  }
  try {
    await gateway.pushAdd({ jobName, groupings: { instance } })
  } catch (err) {
    console.error('metrics push failed:', err)
  }
}
