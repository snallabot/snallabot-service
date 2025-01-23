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

async function updateEachLeagueNotifier() {
  const querySnapshot = await db.collection("league_settings").get()
  querySnapshot.docs.map(async leagueSettingsDoc => {
    const leagueSettings = leagueSettingsDoc.data() as LeagueSettings
    try {
      const notifier = createNotifier(prodClient, leagueSettingsDoc.id, leagueSettings)
      const weeklyStates = leagueSettings.commands?.game_channel?.weekly_states || {}
      await Promise.all(Object.values(weeklyStates).map(async weeklyState => {
        await Promise.all(Object.entries(weeklyState.channel_states).map(async channelEntry => {
          const [channelId, channelState] = channelEntry
          try {
            await notifier.update(channelState, weeklyState.seasonIndex, weeklyState.week)
          } catch (e) {
            console.log("could not update notifier " + e)
          }

        }))
      }))
    } catch (e) {
      console.log("could not update notifier for " + leagueSettingsDoc.id)
    }
  })
}

updateEachLeagueNotifier()
