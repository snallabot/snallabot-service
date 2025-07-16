// This file was used to migrate old dashboards to new ones
// import { initializeApp, cert } from "firebase-admin/app"
// import { getFirestore } from "firebase-admin/firestore"
// import { readFileSync } from "node:fs";
// import { BLAZE_SERVICE_TO_PATH, SystemConsole } from "./ea_constants";
// import { ExportDestination, TokenInformation, storeToken } from "./ea_client";
// import { SNALLABOT_EXPORT } from "../export/exporter";
// import db from "../db/firebase"


// if (!process.env.SERVICE_ACCOUNT_OLD_FILE) {
//   throw new Error("need SA")
// }
// const serviceAccount = JSON.parse(readFileSync(process.env.SERVICE_ACCOUNT_OLD_FILE, 'utf8'))
// const oldDB = initializeApp({
//   credential: cert(serviceAccount),
//   projectId: "championslounge-f0f36",
//   storageBucket: "championslounge-f0f36.appspot.com",
// }, "old")

// const oDb = getFirestore(oldDB)

// type oldData = {
//   accessToken: string,
//   blazeId: string,
//   blazeProductName: string,
//   blazeRequestId: number,
//   blazeService: string,
//   blazeSessionExpiry: Date,
//   expiry: Date,
//   leagueId: number,
//   refreshToken: string,
//   sessionKey: string
// }

// type oldExport = {
//   autoUpdate: boolean,
//   leagueInfo: boolean,
//   rosters: boolean,
//   url: string,
//   weeklyStats: boolean
// }

// async function translate() {
//   const oldLeagues = await oDb.collection("leagues").get()
//   await Promise.all(oldLeagues.docs.map(async d => {
//     const oldLeagueData = d.data()
//     if (oldLeagueData.madden_server) {
//       const maddenData = oldLeagueData.madden_server as oldData
//       if (maddenData.blazeProductName.includes("2025")) {
//         const token: TokenInformation = { accessToken: maddenData.accessToken, refreshToken: maddenData.refreshToken, console: BLAZE_SERVICE_TO_PATH[maddenData.blazeService] as SystemConsole, expiry: maddenData.expiry, blazeId: maddenData.blazeId }
//         try {
//           const leagueId = maddenData.leagueId
//           const old = oldLeagueData?.commands?.exports as oldExport[] || [] as oldExport[]
//           const newDestinations: { [key: string]: ExportDestination } = Object.fromEntries(old.filter(e => !e.url.includes("snallabot")).map(oldExport => {
//             return { autoUpdate: oldExport.autoUpdate, leagueInfo: oldExport.leagueInfo, rosters: oldExport.rosters, weeklyStats: oldExport.weeklyStats, url: oldExport.url, editable: true }
//           }).map(d => [d.url, d]))
//           newDestinations[SNALLABOT_EXPORT] = { autoUpdate: true, leagueInfo: true, rosters: true, weeklyStats: true, url: SNALLABOT_EXPORT, editable: false }
//           console.log(`Migrated Server ${d.id} to League ${leagueId}`)
//           await storeToken(token, leagueId)
//           await db.collection("league_data").doc(`${leagueId}`).set({
//             destinations: newDestinations
//           }, { merge: true })
//         } catch (e) {
//           console.log("Failed to migrate " + d.id)
//         }
//       }
//     }
//   }))
// }

// translate()
