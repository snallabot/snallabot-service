import { createProdClient } from "./discord_utils"
import createNotifier from "./notifier"
import LeagueSettingsDB, { DiscordIdType } from "./settings_db"
import { runWithLeague } from "./league_context"

const prodClient = createProdClient()
const CONCURRENCY = 10 // tune based on Discord rate limits

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

type Job = () => Promise<void>

async function runWithConcurrency(jobs: Job[], concurrency: number) {
  let index = 0
  let completed = 0
  const total = jobs.length
  const startedAt = Date.now()

  async function worker() {
    while (index < jobs.length) {
      const currentIndex = index++
      try {
        await jobs[currentIndex]()
      } catch (e) {
        // individual job errors already caught inside job, this is just a safety net
      } finally {
        completed++
        if (completed % 50 === 0 || completed === total) {
          const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)
          console.log(`[updateEachLeagueNotifier] ${completed}/${total} jobs done (${elapsedSec}s elapsed)`)
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker())
  await Promise.all(workers)
}

async function updateEachLeagueNotifier() {
  const allLeagueSettings = await LeagueSettingsDB.getAllLeagueSettings()

  const jobs: Job[] = []

  for (const rawSettings of allLeagueSettings) {
    const leagueIds = await LeagueSettingsDB.getMaddenLeagueIds(rawSettings.guildId)
    for (const leagueId of leagueIds) {
      await runWithLeague(rawSettings.guildId, leagueId, async () => {
        const leagueSettings = await LeagueSettingsDB.getLeagueSettings(rawSettings.guildId)
        let notifier
        try {
          notifier = createNotifier(prodClient, leagueSettings.guildId, leagueSettings)
        } catch (e) {
          return
        }

        const weeklyStates = leagueSettings.commands?.game_channel?.weekly_states || {}
        for (const weeklyState of Object.values(weeklyStates)) {
          for (const [channelId, channelState] of Object.entries(weeklyState.channel_states || {})) {
            channelState.channel = { id: channelId, id_type: DiscordIdType.CHANNEL }
            jobs.push(async () => {
              try {
                const jitter = getRandomInt(3)
                await new Promise((r) => setTimeout(r, 100 + jitter * 50))
                await notifier.checkPing(channelState, weeklyState.seasonIndex, weeklyState.week)
              } catch (e) {
                // Swallow individual notifier failures so other leagues continue.
              }
            })
          }
        }
      })
    }
  }

  console.log(`[updateEachLeagueNotifier] starting ${jobs.length} jobs with concurrency ${CONCURRENCY}`)
  await runWithConcurrency(jobs, CONCURRENCY)
  console.log(`[updateEachLeagueNotifier] done`)
}

// manually close as some connections can keep this alive
updateEachLeagueNotifier()
  .then(() => {
    console.log("updateEachLeagueNotifier done")
    process.exit(0)
  })
  .catch(e => {
    console.error("updateEachLeagueNotifier failed:", e)
    process.exit(1)
  })
