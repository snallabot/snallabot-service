import EventDB, { StoredEvent } from "../db/events_db"
import { AddChannelEvent, RemoveChannelEvent } from "../db/events"
import db from "../db/firebase"

async function retrieveCurrentState(): Promise<Array<{ channel_id: string, discord_server: string }>> {
  const addEvents = await EventDB.queryEvents<AddChannelEvent>("yt_channels", "ADD_CHANNEL", new Date(0), {}, 10000)
  const removeEvents = await EventDB.queryEvents<RemoveChannelEvent>("yt_channels", "REMOVE_CHANNEL", new Date(0), {}, 10000)
  //TODO: Replace with Object.groupBy
  let state = {} as { [key: string]: Array<StoredEvent<AddChannelEvent>> }
  addEvents.forEach(a => {
    const k = `${a.channel_id}|${a.discord_server}`
    if (!state[k]) {
      state[k] = [a]
    } else {
      state[k].push(a)
      state[k] = state[k].sort((a: StoredEvent<AddChannelEvent>, b: StoredEvent<AddChannelEvent>) => (b.timestamp.getTime() - a.timestamp.getTime())) // reverse chronologically order
    }
  })
  removeEvents.forEach(a => {
    const k = `${a.channel_id}|${a.discord_server}`
    if (state?.[k]?.[0]) {
      if (a.timestamp > state[k][0].timestamp) {
        delete state[k]
      }
    }

  })
  return Object.keys(state).map(k => {
    const [channel_id, discord_server] = k.split("|")
    return { channel_id, discord_server }
  })
}

async function writeYouTubeNotifiers(channelData: { channel_id: string, discord_server: string }[]) {
  try {
    // Filter out undefined channel_ids and group data by channel_id
    const channelMap: Record<string, Record<string, { enabled: true }>> = {}

    channelData
      .filter(item => item.channel_id && item.channel_id !== 'undefined')
      .forEach(item => {
        if (!channelMap[item.channel_id]) {
          channelMap[item.channel_id] = {};
        }
        channelMap[item.channel_id][item.discord_server] = { enabled: true };
      });

    const batch = db.batch();

    for (const [channelId, servers] of Object.entries(channelMap)) {
      const docRef = db.collection('youtube_notifiers').doc(channelId);
      batch.set(docRef, {
        servers: servers
      });
    }

    await batch.commit();
    console.log('Successfully written YouTube notifier data to Firestore');

    // Log the structure for verification
    console.log('Data structure written:');
    Object.entries(channelMap).forEach(([channelId, servers]) => {
      console.log(`Channel: ${channelId}`);
      console.log(`Servers:`, servers);
      console.log('---');
    });
    console.log(`Wrote ${Object.keys(channelMap).length} documents`)

  } catch (error) {
    console.error('Error writing to Firestore:', error);
    throw error;
  }
}

async function main() {
  const c = await retrieveCurrentState()
  await writeYouTubeNotifiers(c)
}
main()
