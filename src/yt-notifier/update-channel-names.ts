import db from "../db/firebase"
import { YoutubeNotifierStored, createHandler } from "./routes"

const youtubeClient = createHandler()

async function updateYouTubeChannelNames() {
  console.log('Starting channel name updates...');

  try {
    // Get all documents from youtube-notifiers collection
    const snapshot = await db.collection("youtube_notifiers").get()

    console.log(`Found ${snapshot.docs.length} documents to process`);

    for (const docSnapshot of snapshot.docs) {
      const channelId = docSnapshot.id; // Document ID is the channel ID
      const currentData = docSnapshot.data() as YoutubeNotifierStored;

      console.log(`Processing channel ID: ${channelId}`);

      try {
        // Get the channel name from YouTube API
        const channelName = await youtubeClient.getChannelName(channelId);

        if (channelName) {
          // Update the document with the channel name
          await db.collection("youtube_notifiers").doc(channelId).update({ channelName: channelName })


          console.log(`✅ Updated: ${channelName} (${channelId})`);
        } else {
          console.warn(`⚠️  Could not get channel name for: ${channelId}`);
        }

        // Small delay to respect API rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`❌ Error processing ${channelId}:`, error);
      }
    }

    console.log('✅ All channel names updated successfully!');

  } catch (error) {
    console.error('❌ Script failed:', error);
  }
}

// Run the script
updateYouTubeChannelNames();
