import db from "./db/firebase";

interface FieldChangeCount {
  [fieldName: string]: number;
}

interface HistoryDocument {
  [key: string]: any;
}

async function analyzeFieldChanges(): Promise<FieldChangeCount> {
  const fieldChangeCounts: FieldChangeCount = {};
  
  try {
    console.log('Starting field change analysis...');
    console.log('Fetching all MADDEN_PLAYER documents...');
    
    // Get all player documents for a league
    const playersSnapshot = await db.collection("madden_data26").doc("3370549").collection("MADDEN_PLAYER").get();
    const totalPlayers = playersSnapshot.size;
    console.log(`Total players to analyze: ${totalPlayers}`);

    let processedPlayers = 0;
    let totalHistoryDocuments = 0;
    let playersWithHistory = 0;

    // Process each player document
    for (const playerDoc of playersSnapshot.docs) {
      const playerId = playerDoc.id;
      
      try {
        // Get the history subcollection for this player
        const historySnapshot = await db.collection("madden_data26").doc("3370549").collection("MADDEN_PLAYER").doc(playerId).collection("history").get();
        
        if (!historySnapshot.empty) {
          playersWithHistory++;
          totalHistoryDocuments += historySnapshot.size;
          
          // Analyze each history document
          historySnapshot.docs.forEach((historyDoc) => {
            const historyData = historyDoc.data() as HistoryDocument;
            
            // Count each field that appears in the history document
            Object.keys(historyData).forEach((fieldName: string) => {
              // Skip Firestore internal fields and metadata
              if (!fieldName.startsWith('_') && fieldName !== 'timestamp') {
                fieldChangeCounts[fieldName] = (fieldChangeCounts[fieldName] || 0) + 1;
              }
            });
          });
        }
      } catch (error) {
        console.warn(`Error processing history for player ${playerId}:`, error);
      }

      processedPlayers++;
      
      // Progress update every 100 players
      if (processedPlayers % 100 === 0) {
        console.log(`Processed ${processedPlayers}/${totalPlayers} players`);
      }
    }

    console.log(`Analysis complete!`);
    console.log(`Processed ${processedPlayers} players`);
    console.log(`Players with history: ${playersWithHistory}`);
    console.log(`Analyzed ${totalHistoryDocuments} history documents`);
    console.log(`Found ${Object.keys(fieldChangeCounts).length} unique fields that changed`);

    return fieldChangeCounts;
  } catch (error) {
    console.error('Error during analysis:', error);
    throw error;
  }
}

function displayResults(fieldChangeCounts: FieldChangeCount, limit: number = 20): void {
  console.log('\n' + '='.repeat(60));
  console.log('FIELD CHANGE ANALYSIS RESULTS');
  console.log('='.repeat(60));

  // Sort fields by change count (descending)
  const sortedFields = Object.entries(fieldChangeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit);

  console.log(`\nTop ${limit} Most Changed Fields:`);
  console.log('-'.repeat(40));
  
  sortedFields.forEach(([fieldName, count], index) => {
    console.log(`${(index + 1).toString().padStart(2)}. ${fieldName.padEnd(25)} ${count.toLocaleString()} changes`);
  });

  // Additional statistics
  const totalChanges = Object.values(fieldChangeCounts).reduce((sum, count) => sum + count, 0);
  const averageChangesPerField = totalChanges / Object.keys(fieldChangeCounts).length;

  console.log('\n' + '-'.repeat(40));
  console.log(`Total field changes: ${totalChanges.toLocaleString()}`);
  console.log(`Average changes per field: ${averageChangesPerField.toFixed(2)}`);
  console.log(`Fields with only 1 change: ${Object.values(fieldChangeCounts).filter(count => count === 1).length}`);
}

function printFullResults(fieldChangeCounts: FieldChangeCount): void {
  const results = {
    timestamp: new Date().toISOString(),
    totalUniqueFields: Object.keys(fieldChangeCounts).length,
    totalChanges: Object.values(fieldChangeCounts).reduce((sum, count) => sum + count, 0),
    fieldChangeCounts: Object.entries(fieldChangeCounts)
      .sort(([, a], [, b]) => b - a)
      .reduce((obj, [field, count]) => {
        obj[field] = count;
        return obj;
      }, {} as FieldChangeCount)
  };

  console.log('\n' + '='.repeat(60));
  console.log('FULL RESULTS (JSON FORMAT)');
  console.log('='.repeat(60));
  console.log(JSON.stringify(results, null, 2));
}

// Helper function to analyze a specific player's history (useful for debugging)
async function analyzePlayerHistory(playerId: string): Promise<FieldChangeCount> {
  const playerFieldCounts: FieldChangeCount = {};
  
  try {
    const historySnapshot = await db.collection("MADDEN_PLAYER").doc(playerId).collection("history").get();
    
    console.log(`Player ${playerId} has ${historySnapshot.size} history documents`);
    
    historySnapshot.docs.forEach((historyDoc) => {
      const historyData = historyDoc.data() as HistoryDocument;
      console.log(`History doc ${historyDoc.id}:`, Object.keys(historyData));
      
      Object.keys(historyData).forEach((fieldName: string) => {
        if (!fieldName.startsWith('_') && fieldName !== 'timestamp') {
          playerFieldCounts[fieldName] = (playerFieldCounts[fieldName] || 0) + 1;
        }
      });
    });
    
    return playerFieldCounts;
  } catch (error) {
    console.error(`Error analyzing player ${playerId}:`, error);
    return {};
  }
}

// Main execution function
async function main() {
  try {
    console.log('Connecting to Firebase...');
    
    const results = await analyzeFieldChanges();
    
    // Display top 30 results
    displayResults(results, 30);
    
    // Print full results as JSON
    printFullResults(results);
    
  } catch (error) {
    console.error('Analysis failed:', error);
  }
}
main().catch(console.error);
