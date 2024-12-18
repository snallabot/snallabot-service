// this file was used to migrate league data, only ran once
import { SnallabotEvent } from "../db/events_db";
import db from "../db/firebase"
import { DefensiveStats, KickingStats, MaddenGame, PassingStats, Player, PuntingStats, ReceivingStats, RushingStats, Standing, Team, TeamStats } from "./madden_league_types";
import { sendEvents } from "./routes";


async function migrateLeagueData<T>(requestType: string, eventType: string, idFn: (e: T) => number) {
    const eventsRef = db.collection("events");
    const eventsSnapshot = await eventsRef.get();

    console.log(eventsSnapshot.docs)
    for (const doc of eventsSnapshot.docs) {
        const leagueId = doc.id;
        console.log(leagueId)
        const leagueDataRef = eventsRef.doc(leagueId).collection(eventType);
        const leagueDataSnapshot = await leagueDataRef.orderBy("timestamp", "asc").get()
        await Promise.all(leagueDataSnapshot.docs.map(async leagueDataDoc => {
            const event = leagueDataDoc.data() as SnallabotEvent<T>
            await sendEvents(leagueId, requestType, [event], idFn)
        }));
    }
}

async function main() {
    console.log("Migrating Team");
    await migrateLeagueData<Team>("leagueteams", "MADDEN_TEAM", e => e.teamId);
    console.log("Migrating Standings Team");
    await migrateLeagueData<Standing>("standings", "MADDEN_STANDING", e => e.teamId);
    console.log("Migrating Madden Game");
    await migrateLeagueData<MaddenGame>("schedulespre-1", "MADDEN_SCHEDULE", e => e.scheduleId);
    console.log("Migrating Punting Stats");
    await migrateLeagueData<PuntingStats>("puntingpre-1", "MADDEN_PUNTING_STAT", e => e.statId);
    console.log("Migrating Team Stats");
    await migrateLeagueData<TeamStats>("teamstatspre-1", "MADDEN_TEAM_STAT", e => e.statId);
    console.log("Migrating Passing Stats");
    await migrateLeagueData<PassingStats>("passingpre-1", "MADDEN_PASSING_STAT", e => e.statId);
    console.log("Migrating Kicking Stats");
    await migrateLeagueData<KickingStats>("kickingpre-1", "MADDEN_KICKING_STAT", e => e.statId);
    console.log("Migrating Rushing Stats");
    await migrateLeagueData<RushingStats>("rushingpre-1", "MADDEN_RUSHING_STAT", e => e.statId);
    console.log("Migrating Defensive Stats");
    await migrateLeagueData<DefensiveStats>("defensepre-1", "MADDEN_DEFENSIVE_STAT", e => e.statId);
    console.log("Migrating Receiving Stats");
    await migrateLeagueData<ReceivingStats>("receivingpre-1", "MADDEN_RECEIVING_STAT", e => e.statId);
    console.log("Migrating Player Roster");
    await migrateLeagueData<Player>("rosterfreeagents", "MADDEN_PLAYER", e => e.rosterId);
}

main().catch(e => console.error(e))

