import db from "../db/firebase"
import MaddenDB from "../db/madden_db"
import { Player } from "./madden_league_types";

const fields = ["capHit", "capReleaseNetSavings", "capReleasePenalty", "contractBonus", "contractSalary", "contractYearsLeft", "contractLength", "desiredBonus", "desiredSalary", "desiredLength"]

/**
 * Queries players by firstName and lastName and prints changes in their history from the last day.
 * @param {Array} players - List of players to search, each with firstName and lastName.
 */
async function queryPlayerHistory(players: { firstName: string, lastName: string }[]) {
  const teams = await MaddenDB.getLatestTeams("3418359")
  try {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    for (const player of players) {
      const { firstName, lastName } = player;

      // Query players matching firstName and lastName /league_data/3418359/MADDEN_PLAYER/551029616/history/285facce-919d-4d41-8771-4a9405d669e1
      const playerQuery = await db
        .collection('league_data').doc("3418359").collection("MADDEN_PLAYER")
        .where('firstName', '==', firstName)
        .where('lastName', '==', lastName)
        .get();

      if (playerQuery.empty) {
        console.log(`No players found for ${firstName} ${lastName}`);
        continue;
      }

      // Iterate through matching players
      for (const doc of playerQuery.docs) {
        const playerData = doc.data() as Player
        // Get the history subcollection
        const historyRef = db.collection(`league_data/3418359/MADDEN_PLAYER/${doc.id}/history`);
        const historyQuery = await historyRef
          .where('timestamp', '>=', oneDayAgo)
          .orderBy('timestamp', 'desc')
          .get();

        if (historyQuery.empty) {
          console.log(`No recent history for player ${firstName} ${lastName}`);
          continue;
        }
        console.log(`${playerData.firstName} ${playerData.lastName} ${playerData.teamId > 0 ? teams.getTeamForId(playerData.teamId).displayName : "Free Agent"} ${playerData.position} `)
        // Log history changes
        historyQuery.forEach((historyDoc) => {
          const historyData = historyDoc.data();
          // Iterate through the keys in the history document
          Object.entries(historyData).forEach(([key, value]) => {
            if (fields.includes(key)) {
              const { oldValue, newValue } = value;
              if (typeof oldValue === "number") {
                console.log(`${key}, Old: ${oldValue.toLocaleString()}, New: ${newValue.toLocaleString()}`);
              } else {

                console.log(`${key}, Old: ${oldValue}, New: ${newValue}`);
              }
            }
          });
        });
        console.log("\n")
      }
    }
  } catch (error) {
    console.error('Error querying player history:', error);
  }
}


const players = [
  { firstName: "Caleb", lastName: "Williams" },
  { firstName: "Cairo", lastName: "Santos" },
  { firstName: "Lavonte", lastName: "David" },
  { firstName: "Rome", lastName: "Odunze" },
  { firstName: "Marquise", lastName: "Morgan" },
  { firstName: "Charleston", lastName: "Sasser" },
  { firstName: "Braxton", lastName: "Jones" },
  { firstName: "Darnell", lastName: "Wright" },
  { firstName: "Rashid", lastName: "Shaheed" },
  { firstName: "Teven", lastName: "Jenkins" },
  { firstName: "Justin", lastName: "Simmons" },
  { firstName: "Montez", lastName: "Sweat" },
  { firstName: "Joe", lastName: "Thuney" },
  { firstName: "Travis", lastName: "Kelce" },
  { firstName: "Tyrique", lastName: "Stevenson" },
  { firstName: "Tremaine", lastName: "Edmunds" },
  { firstName: "Davante", lastName: "Adams" },
  { firstName: "D'Andre", lastName: "Swift" },
  { firstName: "Jaylon", lastName: "Johnson" },
  { firstName: "Gervon", lastName: "Dexter" },
  { firstName: "Jack", lastName: "Jones" },
  { firstName: "Matthew", lastName: "Judon" }
];


queryPlayerHistory(players);
