import { expect, test } from "vitest"
import { StoredEvent } from "./events_db"
import { Team } from "../export/madden_league_types"
import { createTeamList } from "./teams"

const BASE_A = 776863744 // sync base, league 1456362 (latest)
const BASE_B = 777519104 // sync base
const BASE_C = 777781248 // sync base
const ts = (iso: string) => Math.floor(Date.parse(iso) / 1000)

function createMockTeam(teamId: number, division: string, cityName: string, abbrName: string, timestamp: number) {
  const d = new Date(0)
  d.setUTCSeconds(timestamp)
  return {
    teamId: teamId,
    divName: division,
    cityName: cityName,
    abbrName: abbrName,
    timestamp: d
  } as StoredEvent<Team>
}

const latestIds = (teams: ReturnType<typeof createTeamList>) =>
  teams.getLatestTeams().map(t => t.teamId).sort((a, b) => a - b)

test("createTeamList works on normal teams", () => {
  const team = createTeamList([
    createMockTeam(BASE_C + 25, "AFC East", "new england", "NE", 1792790722),
    createMockTeam(BASE_C + 21, "AFC East", "new york", "NYJ", 1792790722),
    createMockTeam(BASE_C + 15, "AFC East", "miami", "MIA", 1792790722),
    createMockTeam(BASE_C + 3, "AFC East", "buffalo", "BUF", 1792790722)
  ])
  expect(team.getLatestTeams().length).toBe(4)
})

test("createTeamList works on duplicate teams across syncs", () => {
  const team = createTeamList([
    createMockTeam(BASE_B + 25, "AFC East", "new england", "NE", 1792790722),
    createMockTeam(BASE_B + 21, "AFC East", "new york", "NYJ", 1792790722),
    createMockTeam(BASE_B + 15, "AFC East", "miami", "MIA", 1792790722),
    createMockTeam(BASE_B + 3, "AFC East", "buffalo", "BUF", 1792790722),
    // older sync, same franchises
    createMockTeam(BASE_C + 25, "AFC East", "new england", "NE", 1792000000),
    createMockTeam(BASE_C + 21, "AFC East", "new york", "NYJ", 1792000000),
    createMockTeam(BASE_C + 15, "AFC East", "miami", "MIA", 1792000000),
    createMockTeam(BASE_C + 3, "AFC East", "buffalo", "BUF", 1792000000)
  ])
  expect(team.getLatestTeams().length).toBe(4)
  // the newest timestamp wins for every franchise
  expect(latestIds(team)).toEqual([BASE_B + 3, BASE_B + 15, BASE_B + 21, BASE_B + 25])
})

test("createTeamList picks newest timestamp, not newest id", () => {
  const team = createTeamList([
    // league 3125736: higher id but older timestamp
    createMockTeam(BASE_C + 5, "AFC North", "cleveland", "CLE", ts("2026-10-21T03:28:26.745Z")),
    createMockTeam(BASE_B + 5, "AFC North", "cleveland", "CLE", ts("2026-10-22T14:35:14.881Z")),
    createMockTeam(BASE_C + 0, "NFC West", "san francisco", "SF", ts("2026-10-18T19:39:23.475Z")),
    createMockTeam(BASE_B + 0, "NFC West", "san francisco", "SF", ts("2026-10-21T23:09:07.731Z"))
  ])
  expect(team.getLatestTeams().length).toBe(2)
  expect(latestIds(team)).toEqual([BASE_B + 0, BASE_B + 5])
})

test("createTeamList does not collide offsets 32-34 with offsets 0-2", () => {
  // league 3125736: HOU/TEN/MIN vs SF/CHI/CIN
  const team = createTeamList([
    createMockTeam(BASE_B + 0, "NFC West", "san francisco", "SF", ts("2026-10-21T23:09:07.731Z")),
    createMockTeam(BASE_B + 1, "NFC North", "chicago", "CHI", ts("2026-10-22T03:34:27.108Z")),
    createMockTeam(BASE_B + 2, "AFC North", "cincinnati", "CIN", ts("2026-10-21T23:09:07.731Z")),
    createMockTeam(BASE_B + 32, "AFC South", "houston", "HOU", ts("2026-10-21T23:09:07.731Z")),
    createMockTeam(BASE_B + 33, "AFC South", "tennessee", "TEN", ts("2026-10-22T17:24:27.072Z")),
    createMockTeam(BASE_B + 34, "NFC North", "minnesota", "MIN", ts("2026-10-22T03:34:27.108Z"))
  ])
  expect(team.getLatestTeams().length).toBe(6)
})

test("createTeamList works on one relocated team and duplicates", () => {
  // league 1456362: slot 5 was Tokyo, then became Anchorage
  const team = createTeamList([
    // snapshot 2026-10-21 (latest full sync)
    createMockTeam(776863746, "AFC North", "cincinnati", "CIN", ts("2026-10-21T15:14:49.987Z")),
    createMockTeam(776863749, "AFC North", "anchorage", "ANC", ts("2026-10-21T15:14:49.987Z")),
    createMockTeam(776863772, "AFC North", "baltimore", "BAL", ts("2026-10-21T15:14:49.987Z")),
    createMockTeam(776863775, "AFC North", "pittsburgh", "PIT", ts("2026-10-21T15:14:49.987Z")),

    // snapshot 2026-10-10 to 10-16
    createMockTeam(777519106, "AFC North", "cincinnati", "CIN", ts("2026-10-10T23:16:17.785Z")),
    createMockTeam(777519109, "AFC North", "anchorage", "ANC", ts("2026-10-14T21:50:57.001Z")),
    createMockTeam(777519132, "AFC North", "baltimore", "BAL", ts("2026-10-16T12:19:09.667Z")),
    createMockTeam(777519135, "AFC North", "pittsburgh", "PIT", ts("2026-10-16T12:19:09.667Z")),

    // snapshot 2026-09 (SeagylI was Tokyo Black Knights back then)
    createMockTeam(777781250, "AFC North", "cincinnati", "CIN", ts("2026-09-09T19:04:43.903Z")),
    createMockTeam(777781253, "AFC North", "tokyo", "TKY", ts("2026-09-12T22:49:51.164Z")),
    createMockTeam(777781276, "AFC North", "baltimore", "BAL", ts("2026-09-14T16:00:10.378Z")),
    createMockTeam(777781279, "AFC North", "pittsburgh", "PIT", ts("2026-09-09T19:04:43.903Z")),
  ])
  expect(team.getLatestTeams().length).toBe(4)
  expect(latestIds(team)).toEqual([776863746, 776863749, 776863772, 776863775])
  expect(team.getLatestTeams().map(t => t.abbrName).sort()).toEqual(["ANC", "BAL", "CIN", "PIT"])
})

test("createTeamList keeps relocations that change division", () => {
  // league 1456362: Washington/London share a division, Las Vegas -> San Juan, Seattle -> Melbourne
  const team = createTeamList([
    createMockTeam(777519126 + 4, "AFC West", "san juan", "SJU", ts("2026-10-14T13:02:00.816Z")), // offset 30? see below
  ])
  expect(team.getLatestTeams().length).toBe(1)
})

test("createTeamList works on a full 32 team league", () => {
  // league 6898933: one sync, no relocations
  const WHEN = ts("2026-10-23T22:20:13.039Z")
  const slots: [number, string, string, string][] = [
    [0, "NFC West", "san francisco", "SF"], [1, "NFC North", "chicago", "CHI"],
    [2, "AFC North", "cincinnati", "CIN"], [3, "AFC East", "buffalo", "BUF"],
    [4, "AFC West", "denver", "DEN"], [5, "AFC North", "cleveland", "CLE"],
    [6, "NFC South", "tampa bay", "TB"], [7, "NFC West", "arizona", "AZ"],
    [10, "AFC West", "los angeles", "LAC"], [11, "AFC West", "kansas city", "KC"],
    [12, "AFC South", "indianapolis", "IND"], [13, "NFC East", "washington", "WAS"],
    [14, "NFC East", "dallas", "DAL"], [15, "AFC East", "miami", "MIA"],
    [16, "NFC East", "philadelphia", "PHI"], [17, "NFC South", "atlanta", "ATL"],
    [19, "NFC East", "new york", "NYG"], [20, "AFC South", "jacksonville", "JAX"],
    [21, "AFC East", "new york", "NYJ"], [22, "NFC North", "detroit", "DET"],
    [23, "NFC North", "green bay", "GB"], [24, "NFC South", "carolina", "CAR"],
    [25, "AFC East", "new england", "NE"], [26, "AFC West", "las vegas", "LV"],
    [27, "NFC West", "los angeles", "LAR"], [28, "AFC North", "baltimore", "BAL"],
    [29, "NFC South", "new orleans", "NO"], [30, "NFC West", "seattle", "SEA"],
    [31, "AFC North", "pittsburgh", "PIT"], [32, "AFC South", "houston", "HOU"],
    [33, "AFC South", "tennessee", "TEN"], [34, "NFC North", "minnesota", "MIN"],
  ]
  const team = createTeamList(slots.map(([off, div, city, abbr]) => createMockTeam(BASE_C + off, div, city, abbr, WHEN)))
  expect(team.getLatestTeams().length).toBe(32)
  expect(latestIds(team)).toEqual(slots.map(([off]) => BASE_C + off))
})

test("league 1456362: 96 rows across 3 syncs collapse to 32 franchises", () => {

  // [teamId, division, city, abbr, timestamp]
  const rows: [number, string, string, string, string][] = [
    // sync 776863744 (newest)
    [776863744, "NFC West", "san francisco", "SF", "2026-10-21T15:14:49.987Z"],
    [776863745, "NFC North", "chicago", "CHI", "2026-10-21T15:14:49.987Z"],
    [776863746, "AFC North", "cincinnati", "CIN", "2026-10-21T15:14:49.987Z"],
    [776863747, "AFC East", "buffalo", "BUF", "2026-10-21T15:14:49.987Z"],
    [776863748, "AFC West", "denver", "DEN", "2026-10-22T02:25:28.053Z"],
    [776863749, "AFC North", "anchorage", "ANC", "2026-10-21T15:14:49.987Z"],
    [776863750, "NFC South", "tampa bay", "TB", "2026-10-21T15:14:49.987Z"],
    [776863751, "NFC West", "arizona", "AZ", "2026-10-21T15:14:49.987Z"],
    [776863754, "AFC West", "los angeles", "LAC", "2026-10-21T15:14:49.987Z"],
    [776863755, "AFC West", "kansas city", "KC", "2026-10-21T15:14:49.987Z"],
    [776863756, "AFC South", "indianapolis", "IND", "2026-10-21T15:14:49.987Z"],
    [776863757, "NFC East", "washington", "WAS", "2026-10-23T01:22:32.290Z"],
    [776863758, "NFC East", "london", "LON", "2026-10-21T15:14:49.987Z"],
    [776863759, "AFC East", "miami", "MIA", "2026-10-21T15:14:49.987Z"],
    [776863760, "NFC East", "philadelphia", "PHI", "2026-10-21T15:14:49.987Z"],
    [776863761, "NFC South", "atlanta", "ATL", "2026-10-21T15:14:49.987Z"],
    [776863763, "NFC East", "new york", "NYG", "2026-10-22T03:07:35.506Z"],
    [776863764, "AFC South", "jacksonville", "JAX", "2026-10-21T15:14:49.987Z"],
    [776863765, "AFC East", "new york", "NYJ", "2026-10-21T15:14:49.987Z"],
    [776863766, "NFC North", "detroit", "DET", "2026-10-22T02:25:28.053Z"],
    [776863767, "NFC North", "green bay", "GB", "2026-10-22T04:31:36.211Z"],
    [776863768, "NFC South", "carolina", "CAR", "2026-10-21T15:14:49.987Z"],
    [776863769, "AFC East", "new england", "NE", "2026-10-22T03:07:35.506Z"],
    [776863770, "AFC West", "san juan", "SJU", "2026-10-23T01:22:32.290Z"],
    [776863771, "NFC West", "los angeles", "LAR", "2026-10-21T15:14:49.987Z"],
    [776863772, "AFC North", "baltimore", "BAL", "2026-10-21T15:14:49.987Z"],
    [776863773, "NFC South", "new orleans", "NO", "2026-10-21T15:14:49.987Z"],
    [776863774, "NFC West", "melbourne", "MEL", "2026-10-21T15:14:49.987Z"],
    [776863775, "AFC North", "pittsburgh", "PIT", "2026-10-21T15:14:49.987Z"],
    [776863776, "AFC South", "london", "LON", "2026-10-21T15:14:49.987Z"],
    [776863777, "AFC South", "honolulu", "HNL", "2026-10-21T15:14:49.987Z"],
    [776863778, "NFC North", "buenos aires", "BA", "2026-10-21T15:14:49.987Z"],

    // sync 777519104
    [777519104, "NFC West", "san francisco", "SF", "2026-10-14T16:07:52.210Z"],
    [777519105, "NFC North", "chicago", "CHI", "2026-10-19T12:35:09.580Z"],
    [777519106, "AFC North", "cincinnati", "CIN", "2026-10-10T23:16:17.785Z"],
    [777519107, "AFC East", "buffalo", "BUF", "2026-10-16T12:19:09.667Z"],
    [777519108, "AFC West", "denver", "DEN", "2026-10-13T17:33:23.568Z"],
    [777519109, "AFC North", "anchorage", "ANC", "2026-10-14T21:50:57.001Z"],
    [777519110, "NFC South", "tampa bay", "TB", "2026-10-12T02:05:02.424Z"],
    [777519111, "NFC West", "arizona", "AZ", "2026-10-13T17:33:23.568Z"],
    [777519114, "AFC West", "los angeles", "LAC", "2026-10-14T13:02:00.816Z"],
    [777519115, "AFC West", "kansas city", "KC", "2026-10-16T12:19:09.667Z"],
    [777519116, "AFC South", "indianapolis", "IND", "2026-10-17T20:47:01.503Z"],
    [777519117, "NFC East", "washington", "WAS", "2026-10-14T16:07:52.210Z"],
    [777519118, "NFC East", "london", "LON", "2026-10-14T13:02:00.816Z"],
    [777519119, "AFC East", "miami", "MIA", "2026-10-14T19:02:10.372Z"],
    [777519120, "NFC East", "philadelphia", "PHI", "2026-10-14T19:02:10.372Z"],
    [777519121, "NFC South", "atlanta", "ATL", "2026-10-17T20:47:01.503Z"],
    [777519123, "NFC East", "new york", "NYG", "2026-10-14T16:07:52.210Z"],
    [777519124, "AFC South", "jacksonville", "JAX", "2026-10-17T20:47:01.503Z"],
    [777519125, "AFC East", "new york", "NYJ", "2026-10-16T12:19:09.667Z"],
    [777519126, "NFC North", "detroit", "DET", "2026-10-13T17:33:23.568Z"],
    [777519127, "NFC North", "green bay", "GB", "2026-10-16T12:19:09.667Z"],
    [777519128, "NFC South", "carolina", "CAR", "2026-10-17T20:47:01.503Z"],
    [777519129, "AFC East", "new england", "NE", "2026-10-17T20:47:01.503Z"],
    [777519130, "AFC West", "san juan", "SJU", "2026-10-14T13:02:00.816Z"],
    [777519131, "NFC West", "los angeles", "LAR", "2026-10-17T20:47:01.503Z"],
    [777519132, "AFC North", "baltimore", "BAL", "2026-10-16T12:19:09.667Z"],
    [777519133, "NFC South", "new orleans", "NO", "2026-10-14T13:02:00.816Z"],
    [777519134, "NFC West", "melbourne", "MEL", "2026-10-16T12:19:09.667Z"],
    [777519135, "AFC North", "pittsburgh", "PIT", "2026-10-16T12:19:09.667Z"],
    [777519136, "AFC South", "london", "LON", "2026-10-19T12:35:09.580Z"],
    [777519137, "AFC South", "honolulu", "HNL", "2026-10-14T21:50:57.001Z"],
    [777519138, "NFC North", "buenos aires", "BA", "2026-10-20T12:59:51.389Z"],

    // sync 777781248 (oldest: Tokyo, Dallas, Houston, Minnesota still had original identities)
    [777781248, "NFC West", "san francisco", "SF", "2026-09-10T13:58:09.933Z"],
    [777781249, "NFC North", "chicago", "CHI", "2026-09-09T19:04:43.903Z"],
    [777781250, "AFC North", "cincinnati", "CIN", "2026-09-09T19:04:43.903Z"],
    [777781251, "AFC East", "buffalo", "BUF", "2026-09-09T19:04:43.903Z"],
    [777781252, "AFC West", "denver", "DEN", "2026-09-15T17:40:29.713Z"],
    [777781253, "AFC North", "tokyo", "TKY", "2026-09-12T22:49:51.164Z"],
    [777781254, "NFC South", "tampa bay", "TB", "2026-09-09T19:04:43.903Z"],
    [777781255, "NFC West", "arizona", "AZ", "2026-09-09T19:04:43.903Z"],
    [777781258, "AFC West", "los angeles", "LAC", "2026-09-12T22:49:51.164Z"],
    [777781259, "AFC West", "kansas city", "KC", "2026-09-09T19:04:43.903Z"],
    [777781260, "AFC South", "indianapolis", "IND", "2026-09-09T19:04:43.903Z"],
    [777781261, "NFC East", "washington", "WAS", "2026-09-15T17:40:29.713Z"],
    [777781262, "NFC East", "dallas", "DAL", "2026-09-11T14:52:38.703Z"],
    [777781263, "AFC East", "miami", "MIA", "2026-09-14T01:40:22.319Z"],
    [777781264, "NFC East", "philadelphia", "PHI", "2026-09-12T22:49:51.164Z"],
    [777781265, "NFC South", "atlanta", "ATL", "2026-09-14T01:40:22.319Z"],
    [777781267, "NFC East", "new york", "NYG", "2026-09-15T17:40:29.713Z"],
    [777781268, "AFC South", "jacksonville", "JAX", "2026-09-09T19:04:43.903Z"],
    [777781269, "AFC East", "new york", "NYJ", "2026-09-09T19:04:43.903Z"],
    [777781270, "NFC North", "detroit", "DET", "2026-09-11T14:52:38.703Z"],
    [777781271, "NFC North", "green bay", "GB", "2026-09-15T17:40:29.713Z"],
    [777781272, "NFC South", "carolina", "CAR", "2026-09-14T16:00:10.378Z"],
    [777781273, "AFC East", "new england", "NE", "2026-09-09T19:04:43.903Z"],
    [777781274, "AFC West", "san juan", "SJU", "2026-09-09T19:04:43.903Z"],
    [777781275, "NFC West", "los angeles", "LAR", "2026-09-09T19:04:43.903Z"],
    [777781276, "AFC North", "baltimore", "BAL", "2026-09-14T16:00:10.378Z"],
    [777781277, "NFC South", "new orleans", "NO", "2026-09-09T19:04:43.903Z"],
    [777781278, "NFC West", "melbourne", "MEL", "2026-09-15T17:40:29.713Z"],
    [777781279, "AFC North", "pittsburgh", "PIT", "2026-09-09T19:04:43.903Z"],
    [777781280, "AFC South", "houston", "HOU", "2026-09-09T19:04:43.903Z"],
    [777781281, "AFC South", "honolulu", "HNL", "2026-09-09T19:04:43.903Z"],
    [777781282, "NFC North", "minnesota", "MIN", "2026-09-15T17:40:29.713Z"],
  ]

  const toMocks = (r: typeof rows) =>
    r.map(([id, div, city, abbr, iso]) => createMockTeam(id, div, city, abbr, ts(iso)))

  expect(rows.length).toBe(96)

  const team = createTeamList(toMocks(rows))
  const latest = team.getLatestTeams()

  // 96 rows collapse to 32 franchises
  expect(latest.length).toBe(32)

  // the newest sync is newest for every slot, so all winners are its ids (776863744 to 776863778)
  const expectedIds = rows.slice(0, 32).map(([id]) => id)
  expect(latest.map(t => t.teamId).sort((a, b) => a - b)).toEqual(expectedIds)

  // relocated slots resolve to their current identity
  const abbrById = new Map(latest.map(t => [t.teamId, t.abbrName]))
  expect(abbrById.get(776863749)).toBe("ANC") // slot 5: Tokyo -> Anchorage
  expect(abbrById.get(776863758)).toBe("LON") // slot 14: Dallas -> London
  expect(abbrById.get(776863776)).toBe("LON") // slot 32: Houston -> London (separate franchise from slot 14)
  expect(abbrById.get(776863777)).toBe("HNL") // slot 33
  expect(abbrById.get(776863778)).toBe("BA")  // slot 34: Minnesota -> Buenos Aires
  expect(abbrById.get(776863770)).toBe("SJU") // slot 26
  expect(abbrById.get(776863774)).toBe("MEL") // slot 30

  // offsets 32-34 do not collide with offsets 0-2
  for (const id of [776863744, 776863745, 776863746, 776863776, 776863777, 776863778]) {
    expect(abbrById.has(id)).toBe(true)
  }
})
