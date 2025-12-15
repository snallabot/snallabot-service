import { createProdClient } from "./discord_utils"
import createNotifier from "./notifier"
import LeagueSettingsDB from "./settings_db"

const prodClient = createProdClient()

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

async function updateEachLeagueNotifier() {
  const allLeagueSettings = await LeagueSettingsDB.getAllLeagueSettings()
  for (const leagueSettings of allLeagueSettings) {
    try {
      const notifier = createNotifier(prodClient, leagueSettings.guildId, leagueSettings)
      const weeklyStates = leagueSettings.commands?.game_channel?.weekly_states || {}
      const jitter = getRandomInt(3)
      await new Promise((r) => setTimeout(r, 1000 + jitter * 1000));
      await Promise.all(Object.values(weeklyStates).map(async weeklyState => {
        await Promise.all(Object.entries(weeklyState.channel_states || {}).map(async channelEntry => {
          const [channelId, channelState] = channelEntry
          try {
            await new Promise((r) => setTimeout(r, 500 + jitter * 100));
            await notifier.checkPing(channelState, weeklyState.seasonIndex, weeklyState.week)
          } catch (e) {
          }

        }))
      }))
    } catch (e) {
      // well do nothing
    }
  }
}

updateEachLeagueNotifier()
