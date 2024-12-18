// this file was used to migrate league data, only ran once
import { SnallabotEvent } from "../db/events_db";
import db from "../db/firebase"
import { DefensiveStats, KickingStats, MaddenGame, PassingStats, Player, PuntingStats, ReceivingStats, RushingStats, Standing, Team, TeamStats } from "./madden_league_types";
import { sendEvents } from "./routes";


async function migrateLeagueData<T>(requestType: string, eventType: string, idFn: (e: T) => number) {
    const eventsRef = db.collection("events");
    const eventsSnapshot = await eventsRef.get();

    for (const doc of eventsSnapshot.docs) {
        const leagueId = doc.id;
        const leagueDataRef = eventsRef.doc(leagueId).collection(eventType);
        const leagueDataSnapshot = await leagueDataRef.orderBy("timestamp", "asc").get()
        leagueDataSnapshot.forEach((leagueDataDoc) => {
            const event = leagueDataDoc.data() as SnallabotEvent<T>
            sendEvents(leagueId, requestType, [event], idFn)
        });
    }
}

console.log("Migrating Team");
migrateLeagueData<Team>("leagueteams", "MADDEN_TEAM", e => e.teamId);
console.log("Migrating Standings Team");
migrateLeagueData<Standing>("standings", "MADDEN_STANDING", e => e.teamId);
console.log("Migrating Madden Game");
migrateLeagueData<MaddenGame>("schedulespre-1", "MADDEN_SCHEDULE", e => e.scheduleId);
console.log("Migrating Punting Stats");
migrateLeagueData<PuntingStats>("puntingpre-1", "MADDEN_PUNTING_STAT", e => e.statId);
console.log("Migrating Team Stats");
migrateLeagueData<TeamStats>("teamstatspre-1", "MADDEN_TEAM_STAT", e => e.statId);
console.log("Migrating Passing Stats");
migrateLeagueData<PassingStats>("passingpre-1", "MADDEN_PASSING_STAT", e => e.statId);
console.log("Migrating Kicking Stats");
migrateLeagueData<KickingStats>("kickingpre-1", "MADDEN_KICKING_STAT", e => e.statId);
console.log("Migrating Rushing Stats");
migrateLeagueData<RushingStats>("rushingpre-1", "MADDEN_RUSHING_STAT", e => e.statId);
console.log("Migrating Defensive Stats");
migrateLeagueData<DefensiveStats>("defensepre-1", "MADDEN_DEFENSIVE_STAT", e => e.statId);
console.log("Migrating Receiving Stats");
migrateLeagueData<ReceivingStats>("receivingpre-1", "MADDEN_RECEIVING_STAT", e => e.statId);
console.log("Migrating Player Roster");
migrateLeagueData<Player>("rosterfreeagents", "MADDEN_PLAYER", e => e.rosterId);





