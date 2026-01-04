import db from "./db/firebase"
import LeagueSettingsDB from "./discord/settings_db"

import { MaddenEvents } from "./db/madden_db";

async function getStaleDocuments() {
  const collectionRef = db.collection('madden_data26')

  // Calculate the date 30 days ago
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  // Get all documents
  const snapshot = await collectionRef.get()

  const stale = await Promise.all(snapshot.docs.map(async doc => {
    // Use Firestore metadata timestamps
    const updateTime = doc.updateTime.toDate()
    if (updateTime < thirtyDaysAgo) {
      const leagueId = doc.id
      const settings = await LeagueSettingsDB.getLeagueSettingsForLeagueId(leagueId)
      if (settings.length === 0) {
        return [leagueId]
      }
    }
    return []
  }
  ))

  const staleLeagues = stale.flat()

  console.log(`Found ${staleLeagues.length} documents not modified in 30 days and not connected to Discord`)
  // Delete stale leagues in chunks of 20
  for (let i = 0; i < staleLeagues.length; i += 20) {
    const chunk = staleLeagues.slice(i, i + 20)
    console.log(`\nDeleting chunk ${Math.floor(i / 20) + 1} of ${Math.ceil(staleLeagues.length / 20)} (${chunk.length} leagues)`)

    await Promise.all(chunk.map(async leagueId => {
      try {
        await deleteLeague(leagueId)
      } catch (error) {
        console.error(`Failed to delete league ${leagueId}:`, error)
      }
    }))

    console.log(`✓ Completed chunk ${Math.floor(i / 20) + 1}`)
  }

  console.log(`\n✓ Successfully deleted all ${staleLeagues.length} stale leagues`)
}

async function deleteLeague(leagueId: string) {
  console.log(`Starting deletion of league: ${leagueId}...`);

  try {
    const leagueDocRef = db.collection("madden_data26").doc(leagueId);

    // Get all subcollection names from the enum
    const subcollectionNames = Object.values(MaddenEvents);

    // Process all subcollections in parallel
    await Promise.all(
      subcollectionNames.map(async subcollectionName => {
        const subcollectionRef = leagueDocRef.collection(subcollectionName);

        try {
          // Delete all documents in this subcollection
          while (true) {
            const subcollectionSnapshot = await subcollectionRef.limit(50).get();
            if (subcollectionSnapshot.empty) {
              break;
            }
            // Process documents in parallel with concurrency limit
            await Promise.all(
              subcollectionSnapshot.docs.map(async documentSnapshot => {
                // Check for history subcollection
                const historyRef = documentSnapshot.ref.collection('history');

                try {
                  const historySnapshot = await historyRef.get();

                  if (!historySnapshot.empty) {

                    // Delete history documents in batches of 500
                    let batch = db.batch();
                    let batchCount = 0;

                    for (const historyDoc of historySnapshot.docs) {
                      batch.delete(historyDoc.ref);
                      batchCount++;

                      if (batchCount === 500) {
                        await batch.commit();
                        batch = db.batch();
                        batchCount = 0;
                      }
                    }

                    // Commit remaining operations
                    if (batchCount > 0) {
                      await batch.commit();
                    }
                  }
                } catch (historyError) {
                }
                // Delete the subcollection document
                await documentSnapshot.ref.delete();
              }
              )
            );
          }

        } catch (subcollectionError) {
          console.error(`    Error processing subcollection ${subcollectionName}:`, subcollectionError);
        }
      })
    );

    // Finally, delete the main league document
    await leagueDocRef.delete();
    console.log(`\n✓ Successfully deleted league: ${leagueId}`);

  } catch (error) {
    console.error(`Error deleting league ${leagueId}:`, error);
    throw error;
  }
}

export { deleteLeague };

getStaleDocuments()
