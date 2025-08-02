import { FieldValue } from "firebase-admin/firestore"
import db from "../db/firebase"
import { google } from "googleapis"

export function extractChannelId(html: string) {
  const linkTagIndex = html.indexOf('<link rel="canonical" href="')
  const sliced = html.slice(linkTagIndex)
  const linkTag = sliced.slice(0, sliced.indexOf(">"))
  return linkTag.replace('<link rel="canonical" href="', "").replace('>', "").replace('"', "").replace("https://www.youtube.com/channel/", "")
}

export type YoutubeUri = { channelName: string, channelUri: string }
interface YoutubeNotifierHandler {
  addYoutubeChannel(discordServer: string, youtubeUrl: string): Promise<void>,
  removeYoutubeChannel(discordServer: string, youtubeUrl: string): Promise<void>,
  listYoutubeChannels(discordServer: string): Promise<YoutubeUri[]>
}

export type YoutubeNotifierStored = {
  channelName: string
  servers: Record<string, { enabled: true }>
}

interface YoutubeAPIHandler {
  getChannelName(channelId: string): Promise<string>
}
function createYoutubeAPIHandler(apiKey: string): YoutubeAPIHandler {
  const youtubeClient = google.youtube({
    version: "v3",
    auth: apiKey
  })
  return {
    getChannelName: async function(channelId: string) {
      const response = await youtubeClient.channels.list({
        part: ['snippet'],
        id: [channelId]
      })
      const maybeChannelName = response?.data?.items?.[0]?.snippet?.title
      if (maybeChannelName) {
        return maybeChannelName
      }
      throw new Error(`Could not get channel name for ${channelId}`)
    }
  }
}

function createTestYoutubeAPIHandler(): YoutubeAPIHandler {
  return {
    getChannelName: async function(channelId: string) {
      return `TEST Name ${channelId}`
    }
  }
}

export function createHandler(): YoutubeAPIHandler {
  if (!process.env.YOUTUBE_API_KEY) {
    return createTestYoutubeAPIHandler()
  } else {
    return createYoutubeAPIHandler(process.env.YOUTUBE_API_KEY)
  }
}

const youtubeClient = createHandler()

export const youtubeNotifierHandler: YoutubeNotifierHandler = {
  addYoutubeChannel: async (discordServer: string, youtubeUrl: string) => {
    const channelId = await fetch(youtubeUrl).then(r => r.text()).then(t => extractChannelId(t))
    if (channelId.trim()) {
      const channelName = await youtubeClient.getChannelName(channelId)
      const docRef = db.collection("youtube_notifiers").doc(channelId);

      // Use Firestore transaction to handle concurrent updates
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (doc.exists) {
          // Document exists, update the servers map
          const data = doc.data() as YoutubeNotifierStored
          const servers = data.servers || {};
          servers[discordServer] = { enabled: true };

          transaction.update(docRef, { servers });
        } else {
          // Document doesn't exist, create it
          transaction.set(docRef, {
            servers: {
              channelName: channelName,
              [discordServer]: { enabled: true }
            }
          });
        }
      })
    } else {
      throw new Error("could not find valid channel id")
    }
  },
  removeYoutubeChannel: async (discordServer: string, youtubeUrl: string) => {
    const channelId = await fetch(youtubeUrl).then(r => r.text()).then(t => extractChannelId(t))
    if (channelId) {
      const docRef = db.collection("youtube_notifiers").doc(channelId);

      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(docRef);

        if (!doc.exists) {
          throw new Error('YouTube channel not found in notifications');
        }

        const data = doc.data() as YoutubeNotifierStored
        const servers = data.servers || {};

        if (!servers[discordServer]) {
          throw new Error('YouTube channel not configured for this Discord server');
        }
        delete servers[discordServer]
        // If no servers left, delete the entire document
        if (Object.keys(servers).length === 0) {
          transaction.delete(docRef);
        } else {
          transaction.update(docRef, {
            [`servers.${discordServer}`]: FieldValue.delete()
          })
        }
      });
    } else {
      throw new Error("could not find valid channel id")
    }
  },
  listYoutubeChannels: async (discordServer: string) => {
    const snapshot = await db.collection("youtube_notifiers").get();
    const channelUrls: { channelName: string, channelUri: string }[] = []

    snapshot.forEach(doc => {
      const data = doc.data() as YoutubeNotifierStored
      const servers = data.servers || {};
      if (servers[discordServer] && servers[discordServer].enabled) {
        const channelId = doc.id;
        channelUrls.push({ channelUri: `https://www.youtube.com/channel/${channelId}`, channelName: data.channelName });
      }
    });

    return channelUrls;
  }
}
