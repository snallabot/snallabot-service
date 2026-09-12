import { NoTwitchAccount, createTwitchClient } from "./twitch_client"
import { twitchNotifierHandler } from "./routes"

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function main() {
  const client = createTwitchClient()
  const subscriptions = await client.getAllSubscriptions()
  console.log(`Cost of Subs: ${subscriptions.total_cost}/${subscriptions.max_total_cost}`)
  Object.entries(Object.groupBy(subscriptions.data, d => d.status)).forEach(e => {
    const [status, subList] = e
    console.log(`${status}: ${subList?.length}`)
  })
  const enabledSubs = new Set([...subscriptions.data.map(d => d.id)])
  const savedTwitchSubscribers = await twitchNotifierHandler.listAllTwitchChannels()
  const subsToDelete = savedTwitchSubscribers.filter(s => !enabledSubs.has(s.subscriptionId))
  console.log(`Found ${subsToDelete.length} Twitch subscriptions to delete`)
  await Promise.all([subsToDelete.map(async s => {
    await twitchNotifierHandler.cleanupTwitchSubscription(s.subscriptionId)
  })])
  for (const s of savedTwitchSubscribers) {
    try {
      await client.retrieveBroadcasterInformation(s.url)
      sleep(5)
    } catch (e) {
      if (e instanceof NoTwitchAccount) {
        console.log(`twitch account deleted ${s.url}, unsubscribing`)
        await twitchNotifierHandler.removeTwitchChannelForId(s.broadcasterId)
      }
    }
  }

}

main()
