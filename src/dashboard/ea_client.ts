import { Agent, fetch } from "undici";
import { CLIENT_ID, CLIENT_SECRET, AUTH_SOURCE, AccountToken, BLAZE_SERVICE, SystemConsole, BLAZE_PRODUCT_NAME, BlazeAuthenticatedResponse, MACHINE_KEY, League, GetMyLeaguesResponse, LeagueResponse, BlazeLeagueResponse } from "./ea_constants"
import { EAAccountError } from "./routes";
import { constants, randomBytes, createHash } from "crypto"
import { Buffer } from "buffer"
import { TeamExport, StandingExport, SchedulesExport, RushingExport, TeamStatsExport, PuntingExport, ReceivingExport, DefensiveExport, KickingExport, PassingExport, RosterExport } from "../export/madden_league_types"
import db from "../db/firebase"
import { createDestination } from "../export/exporter";
import { DEPLOYMENT_URL } from "../config";


export enum LeagueData {
  TEAMS = "CareerMode_GetLeagueTeamsExport",
  STANDINGS = "CareerMode_GetStandingsExport",
  WEEKLY_SCHEDULE = "CareerMode_GetWeeklySchedulesExport",
  RUSHING_STATS = "CareerMode_GetWeeklyRushingStatsExport",
  TEAM_STATS = "CareerMode_GetWeeklyTeamStatsExport",
  PUNTING_STATS = "CareerMode_GetWeeklyPuntingStatsExport",
  RECEIVING_STATS = "CareerMode_GetWeeklyReceivingStatsExport",
  DEFENSIVE_STATS = "CareerMode_GetWeeklyDefensiveStatsExport",
  KICKING_STATS = "CareerMode_GetWeeklyKickingStatsExport",
  PASSING_STATS = "CareerMode_GetWeeklyPassingStatsExport",
  TEAM_ROSTER = "CareerMode_GetTeamRostersExport"
}

export enum Stage {
  PRESEASON = 0,
  SEASON = 1
}

interface EAClient {
  getLeagues(): Promise<League[]>,
  getLeagueInfo(leagueId: number): Promise<LeagueResponse>,
  getTeams(leagueId: number): Promise<TeamExport>,
  getStandings(leagueId: number): Promise<StandingExport>,
  getSchedules(leagueId: number, stage: Stage, weekIndex: number): Promise<SchedulesExport>,
  getRushingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<RushingExport>,
  getTeamStats(leagueId: number, stage: Stage, weekIndex: number): Promise<TeamStatsExport>,
  getPuntingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<PuntingExport>,
  getReceivingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<ReceivingExport>,
  getDefensiveStats(leagueId: number, stage: Stage, weekIndex: number): Promise<DefensiveExport>,
  getKickingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<KickingExport>,
  getPassingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<PassingExport>,
  getTeamRoster(leagueId: number, teamId: number, teamIndex: number): Promise<RosterExport>,
  getFreeAgents(leagueId: number): Promise<RosterExport>,
  getSystemConsole(): SystemConsole
}


export type TokenInformation = { accessToken: string, refreshToken: string, expiry: Date, console: SystemConsole, blazeId: string }
export type SessionInformation = { blazeId: number, sessionKey: string, requestId: number }
type MessageAuth = { authData: string, authCode: string, authType: number }
export type BlazeRequest = { commandName: string, componentId: number, commandId: number, requestPayload: Record<string, any>, componentName: string }
type BlazeErrorResponse = { error: { errorname: string, component: number, errorcode: number, errordf: { commandSeverity: string, errorString: string } } }


export class BlazeError extends Error {
  error: BlazeErrorResponse
  constructor(error: BlazeErrorResponse) {
    super(JSON.stringify(error))
    this.name = "BlazeError"
    this.error = error
  }
}

// EA is on legaacy SSL, node by default rejects these requests. Have to turn off manually
const dispatcher = new Agent({
  connect: {
    rejectUnauthorized: false,
    secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
  },
})

const headers = (t: TokenInformation) => {
  return {
    "Accept-Charset": "UTF-8",
    "Accept": "application/json",
    "X-BLAZE-ID": BLAZE_SERVICE[t.console],
    "X-BLAZE-VOID-RESP": "XML",
    "X-Application-Key": "MADDEN-MCA",
    "Content-Type": "application/json",
    "User-Agent":
      "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
  }
}

async function refreshToken(token: TokenInformation): Promise<TokenInformation> {
  const now = new Date()
  if (now > token.expiry) {
    const res = await fetch(`https://accounts.ea.com/connect/token`, {
      method: "POST",
      headers: {
        "Accept-Charset": "UTF-8",
        "User-Agent":
          "Dalvik/2.1.0 (Linux; U; Android 13; sdk_gphone_x86_64 Build/TE1A.220922.031)",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept-Encoding": "gzip",
      },
      body: `grant_type=refresh_token&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&release_type=prod&refresh_token=${token.refreshToken}&authentication_source=${AUTH_SOURCE}&token_format=JWS`,
    });
    const newToken = await res.json() as AccountToken
    if (!res.ok || !newToken.access_token) {
      throw new EAAccountError(`Error refreshing tokens, response from EA ${JSON.stringify(newToken)}`, "The only solution may to unlink the dashboard and set it up again")
    }
    const newExpiry = new Date(new Date().getTime() + newToken.expires_in * 1000)
    return { accessToken: newToken.access_token, refreshToken: newToken.refresh_token, expiry: newExpiry, console: token.console, blazeId: token.blazeId }
  } else {
    return token
  }
}

async function retrieveBlazeSession(token: TokenInformation): Promise<SessionInformation> {
  const res1 = await fetch(
    `https://wal2.tools.gos.bio-iad.ea.com/wal/authentication/login`,
    {
      dispatcher: dispatcher,
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        accessToken: token.accessToken,
        productName: BLAZE_PRODUCT_NAME[token.console],
      }),
    }
  )
  const textResponse = await res1.text()
  try {
    const blazeSession = JSON.parse(textResponse) as BlazeAuthenticatedResponse
    const sessionKey = blazeSession.userLoginInfo.sessionKey
    const blazeId = blazeSession.userLoginInfo.personaDetails.personaId
    return { blazeId: blazeId, sessionKey: sessionKey, requestId: 1 }
  } catch (e) {
    throw new EAAccountError(`Could not connect to EA Blaze (Madden) Error from EA: ${textResponse}`, "This could be temporary (EA is down for example). Could mean to unlink and setup the dashboard as well")
  }
}

function calculateMessageAuthData(blazeId: number, requestId: number): MessageAuth {
  const rand4bytes = randomBytes(4);
  const requestData = JSON.stringify({
    staticData: "05e6a7ead5584ab4",
    requestId: requestId,
    blazeId: blazeId,
  });
  const staticBytes = Buffer.from(
    "634203362017bf72f70ba900c0aa4e6b",
    "hex"
  );

  const xorHash = createHash("md5")
    .update(rand4bytes)
    .update(staticBytes)
    .digest();
  const requestBuffer = Buffer.from(requestData, "utf-8");
  const scrambledBytes = requestBuffer.map((b, i) => b ^ xorHash[i % 16]);
  const authDataBytes = Buffer.concat([rand4bytes, scrambledBytes]);
  const staticAuthCode = Buffer.from(
    "3a53413521464c3b6531326530705b70203a2900",
    "hex"
  );

  const authCode = createHash("md5")
    .update(staticAuthCode)
    .update(authDataBytes)
    .digest("base64");
  const authData = authDataBytes.toString("base64");
  const authType = 17039361;
  return { authData, authCode, authType };
}

async function sendBlazeRequest<T>(token: TokenInformation, session: SessionInformation, request: BlazeRequest): Promise<T> {
  const authData = calculateMessageAuthData(session.blazeId, session.requestId)
  const messageExpiration = Math.floor(new Date().getTime() / 1000)
  const { requestPayload, ...rest } = request
  const body = {
    apiVersion: 2,
    clientDevice: 3,
    requestInfo: JSON.stringify({
      ...rest,
      messageAuthData: authData,
      messageExpirationTime: messageExpiration,
      deviceId: MACHINE_KEY,
      ipAddress: "127.0.0.1",
      requestPayload: JSON.stringify(requestPayload)
    })
  }
  const res1 = await fetch(
    `https://wal2.tools.gos.bio-iad.ea.com/wal/mca/Process/${session.sessionKey}`,
    {
      dispatcher: dispatcher,
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    }
  )
  const txtResponse = await res1.text()
  try {
    const val = JSON.parse(txtResponse)
    if (val.error) {
      throw new BlazeError(val as BlazeErrorResponse)
    }
    return val as T
  } catch (e) {
    if (e instanceof BlazeError) {
      throw e
    }
    throw new EAAccountError(`Failed to send request to Blaze, Error: ${txtResponse}`, "No Guidance")
  }
}

async function getExportData<T>(token: TokenInformation, session: SessionInformation, exportType: LeagueData, body: Record<string, any>): Promise<T> {
  const res1 = await fetch(
    `https://wal2.tools.gos.bio-iad.ea.com/wal/mca/${exportType}/${session.sessionKey}`,
    {
      dispatcher: dispatcher,
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body)
    }
  )
  try {
    const text = await res1.text()
    const replacedText = text.replaceAll(/[\u0000-\u001F\u007F-\u009F]/g, "")
    return JSON.parse(replacedText) as T
  } catch (e) {
    throw new EAAccountError(`Could not fetch league data, error: ${e}`, "No Guidance")
  }
}

async function refreshBlazeSession(token: TokenInformation, session: SessionInformation): Promise<SessionInformation> {
  try {
    // we send this request just to see if it succeeds
    await sendBlazeRequest<GetMyLeaguesResponse>(token, session, {
      commandName: "Mobile_GetMyLeagues",
      componentId: 2060,
      commandId: 801,
      requestPayload: {},
      componentName: "careermode",
    })
    return session
  } catch (e) {
    if (e instanceof BlazeError) {
      const newSession = await retrieveBlazeSession(token)
      return { ...newSession, requestId: session.requestId }
    }
    throw e
  }
}

export async function ephemeralClientFromToken(token: TokenInformation, session?: SessionInformation): Promise<EAClient> {
  const validSession = session ? session : await retrieveBlazeSession(token)
  return {
    async getLeagues() {
      const res = await sendBlazeRequest<GetMyLeaguesResponse>(token, validSession, {
        commandName: "Mobile_GetMyLeagues",
        componentId: 2060,
        commandId: 801,
        requestPayload: {},
        componentName: "careermode",
      })
      return res.responseInfo.value.leagues
    },
    async getLeagueInfo(leagueId: number) {
      const res = await sendBlazeRequest<BlazeLeagueResponse>(token, validSession, {
        commandName: "Mobile_Career_GetLeagueHub",
        componentId: 2060,
        commandId: 811,
        requestPayload: {
          leagueId: leagueId
        },
        componentName: "careermode",
      })
      return res.responseInfo.value
    },
    async getTeams(leagueId: number) {
      return await getExportData<TeamExport>(token, validSession, LeagueData.TEAMS, { leagueId: leagueId })
    },
    async getStandings(leagueId: number): Promise<StandingExport> {
      return await getExportData<StandingExport>(token, validSession, LeagueData.STANDINGS, { leagueId: leagueId })
    },
    async getSchedules(leagueId: number, stage: Stage, weekIndex: number): Promise<SchedulesExport> {
      return await getExportData<SchedulesExport>(token, validSession, LeagueData.WEEKLY_SCHEDULE, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },
    async getRushingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<RushingExport> {
      return await getExportData<RushingExport>(token, validSession, LeagueData.RUSHING_STATS, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },
    async getTeamStats(leagueId: number, stage: Stage, weekIndex: number): Promise<TeamStatsExport> {
      return await getExportData<TeamStatsExport>(token, validSession, LeagueData.TEAM_STATS, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },

    async getPuntingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<PuntingExport> {
      return await getExportData<PuntingExport>(token, validSession, LeagueData.PUNTING_STATS, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },

    async getReceivingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<ReceivingExport> {
      return await getExportData<ReceivingExport>(token, validSession, LeagueData.RECEIVING_STATS, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },

    async getDefensiveStats(leagueId: number, stage: Stage, weekIndex: number): Promise<DefensiveExport> {
      return await getExportData<DefensiveExport>(token, validSession, LeagueData.DEFENSIVE_STATS, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },

    async getKickingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<KickingExport> {
      return await getExportData<KickingExport>(token, validSession, LeagueData.KICKING_STATS, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },

    async getPassingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<PassingExport> {
      return await getExportData<PassingExport>(token, validSession, LeagueData.PASSING_STATS, { leagueId: leagueId, stageIndex: stage, weekIndex: weekIndex })
    },

    async getTeamRoster(leagueId: number, teamId: number, teamIndex: number): Promise<RosterExport> {
      return await getExportData<RosterExport>(token, validSession, LeagueData.TEAM_ROSTER, {
        leagueId: leagueId, listIndex: teamIndex,
        returnFreeAgents: false,
        teamId: teamId,
      })
    },
    async getFreeAgents(leagueId: number): Promise<RosterExport> {
      return await getExportData<RosterExport>(token, validSession, LeagueData.TEAM_ROSTER, {
        leagueId: leagueId, listIndex: -1,
        returnFreeAgents: true,
        teamId: 0,
      })
    },
    getSystemConsole() {
      return token.console
    }
  }
}

type StoredMaddenConnection = {
  blazeId: string,
  session?: SessionInformation,
  leagueId: number,
  destinations: { [key: string]: ExportDestination }
}
type StoredTokenInformation = {
  token: TokenInformation,
  session?: SessionInformation
}
export type ExportDestination = { autoUpdate: boolean, leagueInfo: boolean, rosters: boolean, weeklyStats: boolean, url: string, lastExportAttempt?: Date, lastSuccessfulExport?: Date, editable: boolean }
const DEFAULT_EXPORT = `https://${DEPLOYMENT_URL}`
export async function storeToken(token: TokenInformation, leagueId: number) {
  const leagueConnection: StoredMaddenConnection = {
    blazeId: token.blazeId,
    leagueId: leagueId,
    destinations: {
      [DEFAULT_EXPORT]: { autoUpdate: true, leagueInfo: true, rosters: true, weeklyStats: true, url: DEFAULT_EXPORT, editable: false }
    }
  }
  await db.collection("league_data").doc(`${leagueId}`).set(leagueConnection)
  const tokenInformation: StoredTokenInformation = {
    token: token
  }
  await db.collection("blaze_tokens").doc(`${token.blazeId}`).set(tokenInformation)
}

interface StoredEAClient extends EAClient {
  getExports(): { [key: string]: ExportDestination },
  updateExport(destination: ExportDestination): Promise<void>,
  removeExport(url: string): Promise<void>
}
export async function deleteLeague(leagueId: number): Promise<void> {
  await db.collection("league_data").doc(`${leagueId}`).delete()
}

export async function storedTokenClient(leagueId: number): Promise<StoredEAClient> {
  const doc = await db.collection("league_data").doc(`${leagueId}`).get()
  if (!doc.exists) {
    throw new Error(`League ${leagueId} not connected to snallabot`)
  }
  const leagueConnection = doc.data() as StoredMaddenConnection
  const tokenDoc = await db.collection("blaze_tokens").doc(`${leagueConnection.blazeId}`).get()
  if (!doc.exists) {
    throw new Error(`League ${leagueId} is connected, but its missing EA connection with id ${leagueConnection.blazeId}`)
  }
  const token = tokenDoc.data() as StoredTokenInformation
  const newToken = await refreshToken(token.token)
  const session = token.session ? token.session : await retrieveBlazeSession(newToken)
  const newSession = await refreshBlazeSession(newToken, session)
  token.token = newToken
  token.session = newSession
  await db.collection("blaze_tokens").doc(`${token.token.blazeId}`).set(token, { merge: true })
  const eaClient = await ephemeralClientFromToken(newToken, newSession)
  return {
    getExports() {
      return leagueConnection.destinations
    },
    async updateExport(destination: ExportDestination) {
      await db.collection("league_data").doc(`${leagueId}`).set({
        destinations: {
          [destination.url]: destination
        }
      }, { merge: true })
    },
    async removeExport(url: string) {
      delete leagueConnection.destinations[url]
      await db.collection("league_data").doc(`${leagueId}`).set(leagueConnection)
    },
    ...eaClient
  }
}

interface MaddenExporter {
  exportCurrentWeek(): Promise<void>,
  exportAllWeeks(): Promise<void>,
  exportSpecificWeeks(weeks: { weekIndex: number, stage: number }[]): Promise<void>,
  exportSurroundingWeek(): Promise<void>
}
export enum ExportContext {
  UNKNOWN = "UNKNOWN",
  // manual means directly done by user
  MANUAL = "MANUAL",
  // auto means through event driven/polling processes
  AUTO = "AUTO"
}

function randomIntFromInterval(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

type WeeklyExportData = {
  weekIndex: number, stage: Stage, passing: PassingExport, schedules: SchedulesExport, teamstats: TeamStatsExport, defense: DefensiveExport, punting: PuntingExport, receiving: ReceivingExport, kicking: KickingExport, rushing: RushingExport
}
type ExportData = {
  leagueTeams: TeamExport,
  standings: StandingExport,
  weeks: WeeklyExportData[],
}
type TeamData = {
  roster: {
    [key: string]: RosterExport
  }
}

const STAGGERED_MAX_MS = 75 // to stagger requests to EA and other outbound services
const PRESEASON_WEEKS = Array.from({ length: 4 }, (v, index) => index)
const SEASON_WEEKS = Array.from({ length: 23 }, (v, index) => index).filter(i => i !== 21) // filters out pro bowl

async function exportData(data: ExportData, destinations: { [key: string]: ExportDestination }, leagueId: string, platform: string) {
  const leagueInfo = Object.values(destinations).filter(d => d.leagueInfo).map(d => createDestination(d.url))
  const weeklyStats = Object.values(destinations).filter(d => d.weeklyStats).map(d => createDestination(d.url))
  if (leagueInfo.length > 0) {
    await Promise.all(leagueInfo.flatMap(d => {
      return [d.leagueTeams(platform, leagueId, data.leagueTeams), d.standings(platform, leagueId, data.standings)]
    }))
  }
  if (weeklyStats.length > 0) {
    await Promise.all(weeklyStats.flatMap(d => {
      return data.weeks.flatMap(w => [
        d.passing(platform, leagueId, w.weekIndex + 1, w.stage, w.passing),
        d.schedules(platform, leagueId, w.weekIndex + 1, w.stage, w.schedules),
        d.teamStats(platform, leagueId, w.weekIndex + 1, w.stage, w.teamstats),
        d.defense(platform, leagueId, w.weekIndex + 1, w.stage, w.defense),
        d.punting(platform, leagueId, w.weekIndex + 1, w.stage, w.punting),
        d.receiving(platform, leagueId, w.weekIndex + 1, w.stage, w.receiving),
        d.kicking(platform, leagueId, w.weekIndex + 1, w.stage, w.kicking),
        d.rushing(platform, leagueId, w.weekIndex + 1, w.stage, w.rushing)
      ])
    }))
  }
}

async function exportTeamData(data: TeamData, destinations: { [key: string]: ExportDestination }, leagueId: string, platform: string) {
  const roster = Object.values(destinations).filter(d => d.rosters).map(d => createDestination(d.url))
  if (roster.length > 0) {
    await Promise.all(roster.flatMap(d => {
      return Object.entries(data.roster).map(e => {
        const [teamId, roster] = e
        if (teamId === "freeagents") {
          return d.freeagents(platform, leagueId, roster)
        }
        return d.teamRoster(platform, leagueId, teamId, roster)
      })
    }))
  }
}

export async function exporterForLeague(leagueId: number, context: ExportContext): Promise<MaddenExporter> {
  const client = await storedTokenClient(leagueId)
  const exports = client.getExports()
  const contextualExports = Object.fromEntries(Object.entries(exports).filter(e => {
    const [_, destination] = e
    if (context === ExportContext.MANUAL) {
      return true
    } else if (context === ExportContext.AUTO) {
      return destination.autoUpdate
    } else {
      return true
    }
  }))
  const leagueInfo = await client.getLeagueInfo(leagueId)
  const staggeringCall = async <T>(p: Promise<T>, waitTime: number = STAGGERED_MAX_MS): Promise<T> => {
    await new Promise(r => setTimeout(r, randomIntFromInterval(1, waitTime)))
    return await p
  }
  return {
    exportCurrentWeek: async function() {
      const weekIndex = leagueInfo.careerHubInfo.seasonInfo.seasonWeek
      const stage = leagueInfo.careerHubInfo.seasonInfo.seasonWeekType === 0 ? 0 : 1
      await this.exportSpecificWeeks([{ weekIndex, stage }])
    },
    exportSurroundingWeek: async function() {
      const currentWeek =
        leagueInfo.careerHubInfo.seasonInfo.seasonWeekType === 8
          ? 22
          : leagueInfo.careerHubInfo.seasonInfo.seasonWeek
      const stage =
        leagueInfo.careerHubInfo.seasonInfo.seasonWeekType == 0 ? 0 : 1
      const maxWeekIndex = stage === 0 ? 3 : 22
      const previousWeek = currentWeek - 1
      const nextWeek = currentWeek + 1
      const weeksToExport = [
        previousWeek === 21 ? 20 : previousWeek,
        currentWeek,
        nextWeek === 21 ? 22 : nextWeek,
      ].filter((c) => c >= 0 && c <= maxWeekIndex)
      await this.exportSpecificWeeks(weeksToExport.map(w => ({ weekIndex: w, stage: stage })))
    },
    exportAllWeeks: async function() {
      const weeksToExport =
        PRESEASON_WEEKS.map(weekIndex => ({
          weekIndex: weekIndex, stage: 0
        })).concat(
          SEASON_WEEKS.map(weekIndex => ({
            weekIndex: weekIndex, stage: 1
          })))
      await this.exportSpecificWeeks(weeksToExport)
    },
    exportSpecificWeeks: async function(weeks: { weekIndex: number, stage: number }[]) {
      const destinations = Object.values(contextualExports)
      const data = { weeks: [], roster: {} } as any
      const dataRequests = [] as Promise<any>[]
      function toStage(stage: number): Stage {
        return stage === 0 ? Stage.PRESEASON : Stage.SEASON
      }
      if (destinations.some(e => e.leagueInfo)) {
        dataRequests.push(client.getTeams(leagueId).then(t => data.leagueTeams = t))
        dataRequests.push(client.getStandings(leagueId).then(t => data.standings = t))
      }
      if (destinations.some(e => e.weeklyStats)) {
        weeks.forEach(week => {
          const stage = toStage(week.stage)
          const weekData = { weekIndex: week.weekIndex, stage: stage } as WeeklyExportData
          dataRequests.push(client.getPassingStats(leagueId, stage, week.weekIndex).then(s => weekData.passing = s))
          dataRequests.push(client.getSchedules(leagueId, stage, week.weekIndex).then(s => weekData.schedules = s))
          dataRequests.push(client.getTeamStats(leagueId, stage, week.weekIndex).then(s => weekData.teamstats = s))
          dataRequests.push(client.getDefensiveStats(leagueId, stage, week.weekIndex).then(s => weekData.defense = s))
          dataRequests.push(client.getPuntingStats(leagueId, stage, week.weekIndex).then(s => weekData.punting = s))
          dataRequests.push(client.getReceivingStats(leagueId, stage, week.weekIndex).then(s => weekData.receiving = s))
          dataRequests.push(client.getKickingStats(leagueId, stage, week.weekIndex).then(s => weekData.kicking = s))
          dataRequests.push(client.getRushingStats(leagueId, stage, week.weekIndex).then(s => weekData.rushing = s))
          data.weeks.push(weekData)
        })
      }

      // avoid using too much memory, process weekly data first then team rosters
      await Promise.all(dataRequests.map(request => staggeringCall(request, 50)))
      await exportData(data as ExportData, contextualExports, `${leagueId}`, client.getSystemConsole())
      if (destinations.some(e => e.rosters)) {
        let teamRequests = [] as Promise<any>[]
        let teamData: TeamData = { roster: {} }
        const teamList = leagueInfo.teamIdInfoList
        teamRequests.push(client.getFreeAgents(leagueId).then(freeAgents => teamData.roster["freeagents"] = freeAgents))

        for (let idx = 0; idx < teamList.length; idx++) {
          const team = teamList[idx];
          teamRequests.push(
            client.getTeamRoster(leagueId, team.teamId, idx).then(roster =>
              teamData.roster[`${team.teamId}`] = roster
            )
          )
          if ((idx + 1) % 4 == 0) {
            await Promise.all(teamRequests)
            await exportTeamData(teamData, contextualExports, `${leagueId}`, client.getSystemConsole())
            teamRequests = []
            teamData = { roster: {} }
          }
        }
        if (teamRequests.length > 0) {
          await Promise.all(teamRequests)
          await exportTeamData(teamData, contextualExports, `${leagueId}`, client.getSystemConsole())
          teamRequests = []
          teamData = { roster: {} }
        }
      }
    }
  } as MaddenExporter
}
