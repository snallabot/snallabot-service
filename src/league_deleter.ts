import db from "./db/firebase"
import { MaddenEvents } from "./db/madden_db"

async function deleteAllLeagueData() {
  console.log('Starting deletion of league_data collection...');
  try {
    const leagueDocs = await db.collection("league_data").listDocuments()
    console.log(`Deleting ${leagueDocs.length} leagues`)
    let i = 0
    while (true) {
      // Get all document IDs in the league_data collection
      const leagueDataSnapshot = leagueDocs.slice(i, i + 20)
      if (leagueDataSnapshot.length == 0) {

        return;
      }

      console.log(`deleting ${leagueDataSnapshot.length} document IDs in league_data collection`);

      // Get all subcollection names from the enum
      const subcollectionNames = Object.values(MaddenEvents);
      await Promise.all(leagueDataSnapshot.map(async mainDoc =>
      // Iterate through each document ID in league_data

      {
        const documentId = mainDoc.id;
        console.log(`\nProcessing document ID: ${documentId}`);

        // For each document, check all possible subcollections
        for (const subcollectionName of subcollectionNames) {
          console.log(`  Checking subcollection: ${subcollectionName}`);

          // Get reference to the subcollection under this document
          const subcollectionRef = db.collection('league_data').doc(documentId).collection(subcollectionName);

          try {
            // Get all documents in this subcollection
            while (true) {
              const subcollectionSnapshot = await subcollectionRef.limit(200).get();

              if (subcollectionSnapshot.empty) {
                break
              }

              await Promise.all(subcollectionSnapshot.docs.map(async documentSnapshot =>

              // Process each document in the subcollection
              {
                const subDocId = documentSnapshot.id;

                // Check for history subcollection in this document
                const historyRef = documentSnapshot.ref.collection('history');

                try {
                  const historySnapshot = await historyRef.get();

                  if (!historySnapshot.empty) {

                    // Delete all history documents in batches
                    let batch = db.batch();
                    let batchCount = 0;

                    for (const historyDoc of historySnapshot.docs) {
                      batch.delete(historyDoc.ref);
                      batchCount++;

                      // Firestore batch limit is 500 operations
                      if (batchCount === 500) {
                        await batch.commit();
                        batch = db.batch();
                        batchCount = 0;
                      }
                    }

                    // Commit the final batch if it has operations
                    if (batchCount > 0) {
                      await batch.commit();
                    }
                  }
                } catch (historyError) {
                  console.log(`      No history subcollection or error accessing it: ${historyError}`);
                }
                // Delete the main subcollection document
                await documentSnapshot.ref.delete();
              }))
            }
          } catch (subcollectionError) {
            console.log(`    Error accessing subcollection ${subcollectionName}: ${subcollectionError}`);
          }
        }
      }))
      console.log('\nSuccessfully completed deletion of 20 league_data collection data!');
      i = i + 20
    }
  } catch (error) {
    console.error('Error deleting league_data collection:', error);
    throw error;
  }
}

deleteAllLeagueData()
