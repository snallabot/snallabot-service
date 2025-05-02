import db from "../db/firebase"
import { createClient } from "./discord_utils"
import createNotifier from "./notifier"
import { LeagueSettings } from "./settings_db"

if (!process.env.PUBLIC_KEY) {
  throw new Error("No Public Key passed for interaction verification")
}

if (!process.env.DISCORD_TOKEN) {
  throw new Error("No Discord Token passed for interaction verification")
}
if (!process.env.APP_ID) {
  throw new Error("No App Id passed for interaction verification")
}
const prodSettings = { publicKey: process.env.PUBLIC_KEY, botToken: process.env.DISCORD_TOKEN, appId: process.env.APP_ID }

const prodClient = createClient(prodSettings)

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}

async function updateEachLeagueNotifier() {
  const querySnapshot = await db.collection("league_settings").get()
  for (const leagueSettingsDoc of querySnapshot.docs) {
    const leagueSettings = leagueSettingsDoc.data() as LeagueSettings
    try {
      const notifier = createNotifier(prodClient, leagueSettingsDoc.id, leagueSettings)
      const weeklyStates = leagueSettings.commands?.game_channel?.weekly_states || {}
      const jitter = getRandomInt(3)
      await new Promise((r) => setTimeout(r, 1000 + jitter * 1000));
      await Promise.all(Object.values(weeklyStates).map(async weeklyState => {
        await Promise.all(Object.entries(weeklyState.channel_states).map(async channelEntry => {
          const [channelId, channelState] = channelEntry
          try {
            await new Promise((r) => setTimeout(r, 500 + jitter * 100));
            await notifier.update(channelState, weeklyState.seasonIndex, weeklyState.week)
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
