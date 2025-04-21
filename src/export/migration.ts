// this file was used to migrate league data, only ran once
// import { SnallabotEvent, StoredEvent } from "../db/events_db";
// import db from "../db/firebase"
// import { DefensiveStats, KickingStats, MaddenGame, PassingStats, Player, PuntingStats, ReceivingStats, RushingStats, Standing, Team, TeamStats } from "./madden_league_types";
// import { sendEvents } from "./routes";


// async function migrateLeagueData<T>(requestType: string, eventType: string, idFn: (e: T) => number) {
//   const eventsDocs = await db.collection("events").listDocuments()
//   await Promise.all(eventsDocs.map(async doc => {
//     const leagueId = doc.id;
//     const leagueDataRef = db.collection("events").doc(leagueId).collection(eventType);

//     let lastDoc = null; // Keep track of the last document for pagination
//     let batchProcessed = true;

//     while (batchProcessed) {
//       let query = leagueDataRef.orderBy("timestamp", "asc").limit(100);
//       if (lastDoc) {
//         query = query.startAfter(lastDoc);
//       }

//       const leagueDataSnapshot = await query.get();
//       if (leagueDataSnapshot.empty) {
//         batchProcessed = false;
//         break;
//       }
//       for (const leagueDataDoc of leagueDataSnapshot.docs) {
//         const { timestamp, id, ...event } = leagueDataDoc.data() as StoredEvent<T>;
//         await sendEvents(leagueId, requestType, [event as SnallabotEvent<T>], idFn);
//         let retryCount = 0
//         while (retryCount < 10) {
//           try {
//             await db
//               .collection("events")
//               .doc(leagueId)
//               .collection(eventType)
//               .doc(leagueDataDoc.id)
//               .delete();
//             break
//           } catch (e) {
//             retryCount = retryCount + 1
//             await new Promise((r) => setTimeout(r, 1000))
//             console.log("errored, slept and retrying")
//           }
//         }
//       }
//       lastDoc = leagueDataSnapshot.docs[leagueDataSnapshot.docs.length - 1];
//     }
//   }))
// }

// export async function main() {
//   console.log("Migrating Team");
//   await migrateLeagueData<Team>("leagueteams", "MADDEN_TEAM", e => e.teamId);
//   console.log("Migrating Standings Team");
//   await migrateLeagueData<Standing>("standings", "MADDEN_STANDING", e => e.teamId);
//   console.log("Migrating Madden Game");
//   await migrateLeagueData<MaddenGame>("schedulespre-1", "MADDEN_SCHEDULE", e => e.scheduleId);
//   console.log("Migrating Punting Stats");
//   await migrateLeagueData<PuntingStats>("puntingpre-1", "MADDEN_PUNTING_STAT", e => e.statId);
//   console.log("Migrating Team Stats");
//   await migrateLeagueData<TeamStats>("teamstatspre-1", "MADDEN_TEAM_STAT", e => e.statId);
//   console.log("Migrating Passing Stats");
//   await migrateLeagueData<PassingStats>("passingpre-1", "MADDEN_PASSING_STAT", e => e.statId);
//   console.log("Migrating Kicking Stats");
//   await migrateLeagueData<KickingStats>("kickingpre-1", "MADDEN_KICKING_STAT", e => e.statId);
//   console.log("Migrating Rushing Stats");
//   await migrateLeagueData<RushingStats>("rushingpre-1", "MADDEN_RUSHING_STAT", e => e.statId);
//   console.log("Migrating Defensive Stats");
//   await migrateLeagueData<DefensiveStats>("defensepre-1", "MADDEN_DEFENSIVE_STAT", e => e.statId);
//   console.log("Migrating Receiving Stats");
//   await migrateLeagueData<ReceivingStats>("receivingpre-1", "MADDEN_RECEIVING_STAT", e => e.statId);
//   console.log("Migrating Player Roster");
//   await migrateLeagueData<Player>("rosterfreeagents", "MADDEN_PLAYER", e => e.rosterId);
// }

// main()

