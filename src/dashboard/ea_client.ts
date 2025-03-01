import { Agent, fetch } from "undici";
import { CLIENT_ID, CLIENT_SECRET, AUTH_SOURCE, AccountToken, BLAZE_SERVICE, SystemConsole, BLAZE_PRODUCT_NAME, BlazeAuthenticatedResponse, MACHINE_KEY, League, GetMyLeaguesResponse, LeagueResponse, BlazeLeagueResponse } from "./ea_constants"
import { EAAccountError } from "./routes";
import { constants, randomBytes, createHash } from "crypto"
import { Buffer } from "buffer"
import { TeamExport, StandingExport, SchedulesExport, RushingExport, TeamStatsExport, PuntingExport, ReceivingExport, DefensiveExport, KickingExport, PassingExport, RosterExport } from "../export/madden_league_types"

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
  getTeamRoster(leagueId: number, teamId: number): Promise<RosterExport>,
  getFreeAgents(leagueId: number): Promise<RosterExport>
}


export type TokenInformation = { accessToken: string, refreshToken: string, expiry: Date, console: SystemConsole }
export type SessionInformation = { blazeId: number, sessionKey: string, requestId: number }
type MessageAuth = { authData: string, authCode: string, authType: number }
export type BlazeRequest = { commandName: string, componentId: number, commandId: number, requestPayload: Record<string, any>, componentName: string }
type BlazeErrorResponse = { error: { errorname: string, component: number, errorcode: number, errordf: { commandSeverity: string, errorString: string } } }
type ExportDestination = { autoUpdate: boolean, leagueInfo: boolean, rosters: boolean, weeklyStats: boolean, url: string, lastExportAttempt?: Date, lastSuccessfulExport?: Date }
type StoredMaddenConnection = {
  token: TokenInformation,
  session?: SessionInformation,
  leagueId: number,
  destinations: { [key: string]: ExportDestination }
}

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
      throw new EAAccountError(`Error refreshing tokens, response from EA ${newToken}`, "The only solution may to unlink the dashboard and set it up again")
    }
    const newExpiry = new Date(new Date().getTime() + newToken.expires_in * 1000)
    return { accessToken: newToken.access_token, refreshToken: newToken.refresh_token, expiry: newExpiry, console: token.console }
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
    if (val.errorname) {
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
    return await res1.json() as T
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
      return {} as TeamExport
    },
    async getStandings(leagueId: number): Promise<StandingExport> {
      return {} as StandingExport
    },
    async getSchedules(leagueId: number, stage: Stage, weekIndex: number): Promise<SchedulesExport> {
      return {} as SchedulesExport
    },
    async getRushingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<RushingExport> {
      return {} as RushingExport;
    },

    async getTeamStats(leagueId: number, stage: Stage, weekIndex: number): Promise<TeamStatsExport> {
      return {} as TeamStatsExport;
    },

    async getPuntingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<PuntingExport> {
      return {} as PuntingExport;
    },

    async getReceivingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<ReceivingExport> {
      return {} as ReceivingExport;
    },

    async getDefensiveStats(leagueId: number, stage: Stage, weekIndex: number): Promise<DefensiveExport> {
      return {} as DefensiveExport;
    },

    async getKickingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<KickingExport> {
      return {} as KickingExport;
    },

    async getPassingStats(leagueId: number, stage: Stage, weekIndex: number): Promise<PassingExport> {
      return {} as PassingExport;
    },

    async getTeamRoster(leagueId: number, teamId: number): Promise<RosterExport> {
      return {} as RosterExport;
    },

    async getFreeAgents(leagueId: number): Promise<RosterExport> {
      return {} as RosterExport;
    }
  }
}
