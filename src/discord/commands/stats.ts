import { Command, MessageComponentInteraction } from "../commands_handler"
import { DiscordClient, deferMessage, getTeamEmoji, NoConnectedLeagueError } from "../discord_utils"
import {
  APIApplicationCommandInteractionDataIntegerOption,
  APIApplicationCommandInteractionDataStringOption,
  APIApplicationCommandInteractionDataSubcommandOption,
  APIMessageStringSelectInteractionData,
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ButtonStyle,
  ComponentType,
  InteractionResponseType,
  RESTPostAPIApplicationCommandsJSONBody,
  SeparatorSpacingSize
} from "discord-api-types/v10"
import MaddenDB, { MaddenEvents, PlayerStatEvents, TeamList } from "../../db/madden_db"
import { discordLeagueView, LeagueLogos, leagueLogosView } from "../../db/view"
import {
  DefensiveStats,
  KickingStats,
  MADDEN_SEASON,
  PassingStats,
  PuntingStats,
  ReceivingStats,
  RushingStats,
  getMessageForWeek
} from "../../export/madden_league_types"

const PAGINATION_LIMIT = 5
type ShortPlayerStatEvents = "pa" | "ru" | "rc" | "d" | "k" | "pu"
const SHORT_TO_LONG_MAPPING: Record<ShortPlayerStatEvents, PlayerStatEvents> = {
  "pa": MaddenEvents.MADDEN_PASSING_STAT,
  "ru": MaddenEvents.MADDEN_RUSHING_STAT,
  "rc": MaddenEvents.MADDEN_RECEIVING_STAT,
  "d": MaddenEvents.MADDEN_DEFENSIVE_STAT,
  "k": MaddenEvents.MADDEN_KICKING_STAT,
  "pu": MaddenEvents.MADDEN_PUNTING_STAT
}

const LONG_TO_SHORT_MAPPING = Object.fromEntries(
  Object.entries(SHORT_TO_LONG_MAPPING).map(([k, v]) => [v, k])
)

// Aggregation types for season stats
type PassingAggregation = {
  rosterId: number
  passYds: number
  passTDs: number
  passInts: number
  passComp: number
  passAtt: number
  passSacks: number
}

type RushingAggregation = {
  rosterId: number
  rushYds: number
  rushTDs: number
  rushAtt: number
  rushFum: number
}

type ReceivingAggregation = {
  rosterId: number
  recYds: number
  recTDs: number
  recCatches: number
  recDrops: number
}

type DefensiveAggregation = {
  rosterId: number
  defTotalTackles: number
  defSacks: number
  defInts: number
  defFumRec: number
  defForcedFum: number
  defTDs: number
}

type KickingAggregation = {
  rosterId: number
  fGMade: number
  fGAtt: number
  xPMade: number
  xPAtt: number
  kickPts: number
}

type PuntingAggregation = {
  rosterId: number
  puntYds: number
  puntAtt: number
  puntsIn20: number
  puntNetYds: number
}

type StatAggregations = PuntingAggregation | KickingAggregation | RushingAggregation | ReceivingAggregation | PassingAggregation | DefensiveAggregation

type SortOrderConfig<T extends StatAggregations> = { sorter: (x: T) => number, shortName: string, label: string }

type StatTypeConfig<T extends StatAggregations> = {
  label: string
  shortValue: ShortPlayerStatEvents,
  sortOrders: SortOrderConfig<T>[]
}

const passingConfig: StatTypeConfig<PassingAggregation> = {
  label: "Passing",
  shortValue: "pa" satisfies ShortPlayerStatEvents,
  sortOrders: [
    { sorter: (x) => x.passYds, shortName: "YD", label: "Pass Yards" },
    { sorter: (x) => x.passTDs, shortName: "TD", label: "Touchdowns" },
    { sorter: (x) => x.passInts, shortName: "IN", label: "Interceptions" },
    { sorter: (x) => x.passAtt > 0 ? x.passComp / x.passAtt : 0, shortName: "%", label: "Completion %" },
  ]
}

const rushingConfig: StatTypeConfig<RushingAggregation> = {
  label: "Rushing",
  shortValue: "ru" satisfies ShortPlayerStatEvents,
  sortOrders: [
    { sorter: (x) => x.rushYds, shortName: "YD", label: "Rush Yards" },
    { sorter: (x) => x.rushTDs, shortName: "TD", label: "Touchdowns" },
    { sorter: (x) => x.rushFum, shortName: "FM", label: "Fumbles" },
    { sorter: (x) => x.rushAtt > 0 ? x.rushYds / x.rushAtt : 0, shortName: "YC", label: "Yards Per Carry" },
  ]
}

const receivingConfig: StatTypeConfig<ReceivingAggregation> = {
  label: "Receiving",
  shortValue: "rc" satisfies ShortPlayerStatEvents,
  sortOrders: [
    { sorter: (x) => x.recYds, shortName: "YD", label: "Rec Yards" },
    { sorter: (x) => x.recTDs, shortName: "TD", label: "Touchdowns" },
    { sorter: (x) => x.recCatches, shortName: "RC", label: "Receptions" },
    { sorter: (x) => x.recDrops, shortName: "DR", label: "Drops" },
    { sorter: (x) => x.recCatches > 0 ? x.recYds / x.recCatches : 0, shortName: "YR", label: "Yards Per Catch" },
  ]
}

const defensiveConfig: StatTypeConfig<DefensiveAggregation> = {
  label: "Defense",
  shortValue: "d" satisfies ShortPlayerStatEvents,
  sortOrders: [
    { sorter: (x) => x.defTotalTackles, shortName: "TK", label: "Total Tackles" },
    { sorter: (x) => x.defSacks, shortName: "SK", label: "Sacks" },
    { sorter: (x) => x.defInts, shortName: "IN", label: "Interceptions" },
    { sorter: (x) => x.defForcedFum, shortName: "FF", label: "Forced Fumbles" },
    { sorter: (x) => x.defTDs, shortName: "TD", label: "Touchdowns" },
  ]
}

const kickingConfig: StatTypeConfig<KickingAggregation> = {
  label: "Kicking",
  shortValue: "k" satisfies ShortPlayerStatEvents,
  sortOrders: [
    { sorter: (x) => x.fGMade, shortName: "FG", label: "FG Made" },
    { sorter: (x) => x.kickPts, shortName: "PT", label: "Points" },
    { sorter: (x) => x.fGAtt > 0 ? x.fGMade / x.fGAtt : 0, shortName: "%", label: "FG %" },
  ]
}

const puntingConfig: StatTypeConfig<PuntingAggregation> = {
  label: "Punting",
  shortValue: "pu" satisfies ShortPlayerStatEvents,
  sortOrders: [
    { sorter: (x) => x.puntYds, shortName: "YD", label: "Punt Yards" },
    { sorter: (x) => x.puntsIn20, shortName: "20", label: "Punts Inside 20" },
    { sorter: (x) => x.puntNetYds, shortName: "NT", label: "Net Yards" },
  ]
}

type StatAggregationMap = {
  [MaddenEvents.MADDEN_PASSING_STAT]: PassingAggregation
  [MaddenEvents.MADDEN_RUSHING_STAT]: RushingAggregation
  [MaddenEvents.MADDEN_RECEIVING_STAT]: ReceivingAggregation
  [MaddenEvents.MADDEN_DEFENSIVE_STAT]: DefensiveAggregation
  [MaddenEvents.MADDEN_KICKING_STAT]: KickingAggregation
  [MaddenEvents.MADDEN_PUNTING_STAT]: PuntingAggregation
}

const statEventTypes = {
  [MaddenEvents.MADDEN_PASSING_STAT]: passingConfig,
  [MaddenEvents.MADDEN_RUSHING_STAT]: rushingConfig,
  [MaddenEvents.MADDEN_RECEIVING_STAT]: receivingConfig,
  [MaddenEvents.MADDEN_DEFENSIVE_STAT]: defensiveConfig,
  [MaddenEvents.MADDEN_KICKING_STAT]: kickingConfig,
  [MaddenEvents.MADDEN_PUNTING_STAT]: puntingConfig,
} satisfies {
    [K in PlayerStatEvents]: StatTypeConfig<StatAggregationMap[K]>
  }

type WeekStatsPagination = {
  st: ShortPlayerStatEvents  // stat type
  w: number            // week
  s: number            // season
  p: number             // page
  so: string
}

type SeasonStatsPagination = {
  st: ShortPlayerStatEvents  // stat type
  s: number            // season
  p: number             // page
  so: string
}


function aggregatePassingStats(stats: PassingStats[], sorter: (x: PassingAggregation) => number): PassingAggregation[] {
  const aggregated = new Map<number, PassingAggregation>()
  for (const stat of stats) {
    const existing = aggregated.get(stat.rosterId) || {
      rosterId: stat.rosterId,
      passYds: 0,
      passTDs: 0,
      passInts: 0,
      passComp: 0,
      passAtt: 0,
      passSacks: 0
    }
    existing.passYds += stat.passYds
    existing.passTDs += stat.passTDs
    existing.passInts += stat.passInts
    existing.passComp += stat.passComp
    existing.passAtt += stat.passAtt
    existing.passSacks += stat.passSacks
    aggregated.set(stat.rosterId, existing)
  }
  return Array.from(aggregated.values()).sort((a, b) => sorter(b) - sorter(a))
}

function aggregateRushingStats(stats: RushingStats[], sorter: (x: RushingAggregation) => number): RushingAggregation[] {
  const aggregated = new Map<number, RushingAggregation>()
  for (const stat of stats) {
    const existing = aggregated.get(stat.rosterId) || {
      rosterId: stat.rosterId,
      rushYds: 0,
      rushTDs: 0,
      rushAtt: 0,
      rushFum: 0
    }
    existing.rushYds += stat.rushYds
    existing.rushTDs += stat.rushTDs
    existing.rushAtt += stat.rushAtt
    existing.rushFum += stat.rushFum
    aggregated.set(stat.rosterId, existing)
  }
  return Array.from(aggregated.values()).sort((a, b) => sorter(b) - sorter(a))
}

function aggregateReceivingStats(stats: ReceivingStats[], sorter: (x: ReceivingAggregation) => number): ReceivingAggregation[] {
  const aggregated = new Map<number, ReceivingAggregation>()
  for (const stat of stats) {
    const existing = aggregated.get(stat.rosterId) || {
      rosterId: stat.rosterId,
      recYds: 0,
      recTDs: 0,
      recCatches: 0,
      recDrops: 0
    }
    existing.recYds += stat.recYds
    existing.recTDs += stat.recTDs
    existing.recCatches += stat.recCatches
    existing.recDrops += stat.recDrops
    aggregated.set(stat.rosterId, existing)
  }
  return Array.from(aggregated.values()).sort((a, b) => sorter(b) - sorter(a))
}

function aggregateDefensiveStats(stats: DefensiveStats[], sorter: (x: DefensiveAggregation) => number): DefensiveAggregation[] {
  const aggregated = new Map<number, DefensiveAggregation>()
  for (const stat of stats) {
    const existing = aggregated.get(stat.rosterId) || {
      rosterId: stat.rosterId,
      defTotalTackles: 0,
      defSacks: 0,
      defInts: 0,
      defFumRec: 0,
      defForcedFum: 0,
      defTDs: 0
    }
    existing.defTotalTackles += stat.defTotalTackles
    existing.defSacks += stat.defSacks
    existing.defInts += stat.defInts
    existing.defFumRec += stat.defFumRec
    existing.defForcedFum += stat.defForcedFum
    existing.defTDs += stat.defTDs
    aggregated.set(stat.rosterId, existing)
  }
  return Array.from(aggregated.values()).sort((a, b) => sorter(b) - sorter(a))
}

function aggregateKickingStats(stats: KickingStats[], sorter: (x: KickingAggregation) => number): KickingAggregation[] {
  const aggregated = new Map<number, KickingAggregation>()
  for (const stat of stats) {
    const existing = aggregated.get(stat.rosterId) || {
      rosterId: stat.rosterId,
      fGMade: 0,
      fGAtt: 0,
      xPMade: 0,
      xPAtt: 0,
      kickPts: 0
    }
    existing.fGMade += stat.fGMade
    existing.fGAtt += stat.fGAtt
    existing.xPMade += stat.xPMade
    existing.xPAtt += stat.xPAtt
    existing.kickPts += stat.kickPts
    aggregated.set(stat.rosterId, existing)
  }
  return Array.from(aggregated.values()).sort((a, b) => sorter(b) - sorter(a))
}

function aggregatePuntingStats(stats: PuntingStats[], sorter: (x: PuntingAggregation) => number): PuntingAggregation[] {
  const aggregated = new Map<number, PuntingAggregation>()
  for (const stat of stats) {
    const existing = aggregated.get(stat.rosterId) || {
      rosterId: stat.rosterId,
      puntYds: 0,
      puntAtt: 0,
      puntsIn20: 0,
      puntNetYds: 0
    }
    existing.puntYds += stat.puntYds
    existing.puntAtt += stat.puntAtt
    existing.puntsIn20 += stat.puntsIn20
    existing.puntNetYds += stat.puntNetYds
    aggregated.set(stat.rosterId, existing)
  }
  return Array.from(aggregated.values()).sort((a, b) => sorter(b) - sorter(a))
}

async function formatPassingStats(
  stats: PassingAggregation[],
  leagueId: string,
  teams: TeamList,
  logos: LeagueLogos
): Promise<string> {
  const lines: string[] = []

  for (const stat of stats) {
    const player = await MaddenDB.getPlayer(leagueId, `${stat.rosterId}`)
    const teamAbbr = player.teamId === 0 ? "FA" : teams.getTeamForId(player.teamId).abbrName
    const completion = stat.passAtt > 0 ? ((stat.passComp / stat.passAtt) * 100).toFixed(1) : "0.0"


    lines.push(
      `${getTeamEmoji(teamAbbr, logos)} **${player.firstName} ${player.lastName}** (${player.position})` +
      `\n> ${stat.passComp}/${stat.passAtt} (${completion}%), ${stat.passYds} YDS, ${stat.passTDs} TD, ${stat.passInts} INT`
    )
  }

  return lines.join('\n\n')
}

async function formatRushingStats(
  stats: RushingAggregation[],
  leagueId: string,
  teams: TeamList,
  logos: LeagueLogos
): Promise<string> {
  const lines: string[] = []

  for (const stat of stats) {
    const player = await MaddenDB.getPlayer(leagueId, `${stat.rosterId}`)
    const teamAbbr = player.teamId === 0 ? "FA" : teams.getTeamForId(player.teamId).abbrName
    const avg = stat.rushAtt > 0 ? (stat.rushYds / stat.rushAtt).toFixed(1) : "0.0"

    lines.push(
      `${getTeamEmoji(teamAbbr, logos)} **${player.firstName} ${player.lastName}** (${player.position})` +
      `\n> ${stat.rushAtt} ATT, ${stat.rushYds} YDS, ${stat.rushTDs} TD, ${avg} AVG${stat.rushFum > 0 ? `, ${stat.rushFum} FUM` : ''}`
    )
  }

  return lines.join('\n\n')
}

async function formatReceivingStats(
  stats: ReceivingAggregation[],
  leagueId: string,
  teams: TeamList,
  logos: LeagueLogos
): Promise<string> {
  const lines: string[] = []

  for (const stat of stats) {
    const player = await MaddenDB.getPlayer(leagueId, `${stat.rosterId}`)
    const teamAbbr = player.teamId === 0 ? "FA" : teams.getTeamForId(player.teamId).abbrName
    const avg = stat.recCatches > 0 ? (stat.recYds / stat.recCatches).toFixed(1) : "0.0"

    lines.push(
      `${getTeamEmoji(teamAbbr, logos)} **${player.firstName} ${player.lastName}** (${player.position})` +
      `\n> ${stat.recCatches} REC, ${stat.recYds} YDS, ${stat.recTDs} TD, ${avg} AVG${stat.recDrops > 0 ? `, ${stat.recDrops} DROP` : ''}`
    )
  }

  return lines.join('\n\n')
}

async function formatDefensiveStats(
  stats: DefensiveAggregation[],
  leagueId: string,
  teams: TeamList,
  logos: LeagueLogos
): Promise<string> {
  const lines: string[] = []

  for (const stat of stats) {
    const player = await MaddenDB.getPlayer(leagueId, `${stat.rosterId}`)
    const teamAbbr = player.teamId === 0 ? "FA" : teams.getTeamForId(player.teamId).abbrName

    const statParts = [
      `${stat.defTotalTackles} TKL`,
      stat.defSacks > 0 ? `${stat.defSacks} SCK` : null,
      stat.defInts > 0 ? `${stat.defInts} INT` : null,
      stat.defFumRec > 0 ? `${stat.defFumRec} FR` : null,
      stat.defForcedFum > 0 ? `${stat.defForcedFum} FF` : null,
      stat.defTDs > 0 ? `${stat.defTDs} TD` : null
    ].filter(Boolean).join(', ')

    lines.push(
      `${getTeamEmoji(teamAbbr, logos)} **${player.firstName} ${player.lastName}** (${player.position})` +
      `\n> ${statParts}`
    )
  }

  return lines.join('\n\n')
}

async function formatKickingStats(
  stats: KickingAggregation[],
  leagueId: string,
  teams: TeamList,
  logos: LeagueLogos
): Promise<string> {
  const lines: string[] = []

  for (const stat of stats) {
    const player = await MaddenDB.getPlayer(leagueId, `${stat.rosterId}`)
    const teamAbbr = player.teamId === 0 ? "FA" : teams.getTeamForId(player.teamId).abbrName
    const fgPct = stat.fGAtt > 0 ? ((stat.fGMade / stat.fGAtt) * 100).toFixed(1) : "0.0"
    const xpPct = stat.xPAtt > 0 ? ((stat.xPMade / stat.xPAtt) * 100).toFixed(1) : "0.0"

    lines.push(
      `${getTeamEmoji(teamAbbr, logos)} **${player.firstName} ${player.lastName}** (${player.position})` +
      `\n> FG: ${stat.fGMade}/${stat.fGAtt} (${fgPct}%), XP: ${stat.xPMade}/${stat.xPAtt} (${xpPct}%), ${stat.kickPts} PTS`
    )
  }

  return lines.join('\n\n')
}

async function formatPuntingStats(
  stats: PuntingAggregation[],
  leagueId: string,
  teams: TeamList,
  logos: LeagueLogos
): Promise<string> {
  const lines: string[] = []

  for (const stat of stats) {
    const player = await MaddenDB.getPlayer(leagueId, `${stat.rosterId}`)
    const teamAbbr = player.teamId === 0 ? "FA" : teams.getTeamForId(player.teamId).abbrName
    const avg = stat.puntAtt > 0 ? (stat.puntYds / stat.puntAtt).toFixed(1) : "0.0"
    const netAvg = stat.puntAtt > 0 ? (stat.puntNetYds / stat.puntAtt).toFixed(1) : "0.0"

    lines.push(
      `${getTeamEmoji(teamAbbr, logos)} **${player.firstName} ${player.lastName}** (${player.position})` +
      `\n> ${stat.puntAtt} PUNTS, ${stat.puntYds} YDS, ${avg} AVG, ${netAvg} NET${stat.puntsIn20 > 0 ? `, ${stat.puntsIn20} IN20` : ''}`
    )
  }

  return lines.join('\n\n')
}

function findSortOrder<T extends StatAggregations>(sortOrder: string, config: StatTypeConfig<T>) {
  const entry = config.sortOrders.find(s => s.shortName === sortOrder)
  if (!entry) throw new Error(`Sort order "${sortOrder}" not found in ${config.label} config`)
  return entry
}

async function showWeeklyStats(
  token: string,
  client: DiscordClient,
  leagueId: string,
  statType: PlayerStatEvents,
  sortOrder: string,
  week: number = -1,
  season: number = -1,
  page: number = 0
) {
  try {
    const [{ seasonIndex, weekIndex, stats: rawStats }, teams, logos, allWeeks] = await Promise.all([
      MaddenDB.getStatsForWeek(leagueId, statType, week === -1 ? undefined : week, season === -1 ? undefined : season),
      MaddenDB.getLatestTeams(leagueId),
      leagueLogosView.createView(leagueId),
      MaddenDB.getAllWeeks(leagueId)
    ])
    if (allWeeks.length === 0) {
      await client.editOriginalInteraction(token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `No data to show, try an export`
          }
        ]
      })
    }

    // Get the actual week/season from stats if not specified
    const actualWeek = weekIndex + 1
    const actualSeason = seasonIndex

    let aggregatedStats: any[]
    let formattedStats: string
    let shortSortOrder: string
    const startIdx = page * PAGINATION_LIMIT
    const endIdx = startIdx + PAGINATION_LIMIT
    // Aggregate and format based on stat type
    switch (statType) {
      case MaddenEvents.MADDEN_PASSING_STAT:
        const passingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_PASSING_STAT])
        aggregatedStats = aggregatePassingStats(rawStats as PassingStats[], passingOrder.sorter)
        formattedStats = await formatPassingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = passingOrder.shortName
        break
      case MaddenEvents.MADDEN_RUSHING_STAT:
        const rushingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_RUSHING_STAT])
        aggregatedStats = aggregateRushingStats(rawStats as RushingStats[], rushingOrder.sorter)
        formattedStats = await formatRushingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = rushingOrder.shortName
        break
      case MaddenEvents.MADDEN_RECEIVING_STAT:
        const receivingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_RECEIVING_STAT])
        aggregatedStats = aggregateReceivingStats(rawStats as ReceivingStats[], receivingOrder.sorter)
        formattedStats = await formatReceivingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = receivingOrder.shortName
        break
      case MaddenEvents.MADDEN_DEFENSIVE_STAT:
        const defensiveOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_DEFENSIVE_STAT])
        aggregatedStats = aggregateDefensiveStats(rawStats as DefensiveStats[], defensiveOrder.sorter)
        formattedStats = await formatDefensiveStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = defensiveOrder.shortName
        break
      case MaddenEvents.MADDEN_KICKING_STAT:
        const kickingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_KICKING_STAT])
        aggregatedStats = aggregateKickingStats(rawStats as KickingStats[], kickingOrder.sorter)
        formattedStats = await formatKickingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = kickingOrder.shortName
        break
      case MaddenEvents.MADDEN_PUNTING_STAT:
        const puntingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_PUNTING_STAT])
        aggregatedStats = aggregatePuntingStats(rawStats as PuntingStats[], puntingOrder.sorter)
        formattedStats = await formatPuntingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = puntingOrder.shortName
        break
      default:
        aggregatedStats = []
        formattedStats = "No stats available"
        shortSortOrder = ""
    }

    const statTypeLabel = statEventTypes[statType].label || "Stats"

    const message = formattedStats
      ? `# ${getMessageForWeek(actualWeek)} ${statTypeLabel} Leaders - ${MADDEN_SEASON + actualSeason}\n${formattedStats}`
      : `# ${getMessageForWeek(actualWeek)} ${statTypeLabel} Leaders - ${MADDEN_SEASON + actualSeason}\nNo stats available`

    // Create pagination buttons
    const backDisabled = page === 0
    const nextDisabled = endIdx >= aggregatedStats.length
    const currentPagination = { st: LONG_TO_SHORT_MAPPING[statType], w: actualWeek, s: actualSeason, p: page, so: shortSortOrder }

    // Create stat type selector
    const statTypeOptions = Object.values(statEventTypes).map(sType => {
      return {
        label: sType.label,
        value: JSON.stringify({ st: sType.shortValue, w: actualWeek, s: actualSeason, p: 0, so: sType.sortOrders[0].shortName })
      }
    })
    const sortOptions = statEventTypes[statType].sortOrders.map(sortOrder => (
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: sortOrder.label,
        disabled: sortOrder.shortName === shortSortOrder,
        // differentiate id
        custom_id: JSON.stringify({ st: LONG_TO_SHORT_MAPPING[statType], s: actualSeason, p: 0, so: sortOrder.shortName, b: "b" })
      }))

    // Create week selector
    const weekOptions = allWeeks
      .filter(ws => ws.seasonIndex === actualSeason)
      .sort((a, b) => a.weekIndex - b.weekIndex)
      .map(ws => ({
        label: getMessageForWeek(ws.weekIndex + 1),
        value: JSON.stringify({ st: LONG_TO_SHORT_MAPPING[statType], w: ws.weekIndex + 1, s: actualSeason, p: 0, so: shortSortOrder })
      }))

    // Create season selector
    const seasonOptions = [...new Set(allWeeks.map(ws => ws.seasonIndex))]
      .sort((a, b) => a - b)
      .map(s => ({
        label: `Season ${s + MADDEN_SEASON}`,
        value: JSON.stringify({ st: LONG_TO_SHORT_MAPPING[statType], w: 1, s: s, p: 0, so: shortSortOrder })
      }))

    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: message
        },
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Large
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: "Previous",
              disabled: backDisabled,
              custom_id: JSON.stringify({ ...currentPagination, p: page - 1 })
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: "Next",
              disabled: nextDisabled,
              custom_id: JSON.stringify({ ...currentPagination, p: page + 1 })
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: sortOptions
        },
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Small
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: "weekly_stat_type_selector",
              placeholder: statTypeLabel,
              options: statTypeOptions
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: "weekly_week_selector",
              placeholder: getMessageForWeek(actualWeek),
              options: weekOptions
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: "weekly_season_selector",
              placeholder: `Season ${actualSeason + MADDEN_SEASON}`,
              options: seasonOptions
            }
          ]
        }
      ]
    })
  } catch (e) {
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Failed to show weekly stats: ${e}`
        }
      ]
    })
  }
}

async function showSeasonStats(
  token: string,
  client: DiscordClient,
  leagueId: string,
  statType: PlayerStatEvents,
  sortOrder: string,
  season: number = -1,
  page: number = 0
) {
  try {
    const [rawStats, teams, logos, allWeeks] = await Promise.all([
      MaddenDB.getStatsForSeason(leagueId, statType, season === -1 ? undefined : season),
      MaddenDB.getLatestTeams(leagueId),
      leagueLogosView.createView(leagueId),
      MaddenDB.getAllWeeks(leagueId)
    ])
    if (allWeeks.length === 0) {
      await client.editOriginalInteraction(token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `No data to show, try an export`
          }
        ]
      })
    }
    // Get the actual season from stats if not specified
    const actualSeason = rawStats[0] ? rawStats[0].seasonIndex : season == -1 ? 0 : season

    let aggregatedStats: any[]
    let formattedStats: string
    let shortSortOrder: string
    const startIdx = page * PAGINATION_LIMIT
    const endIdx = startIdx + PAGINATION_LIMIT
    // Aggregate and format based on stat type
    switch (statType) {
      case MaddenEvents.MADDEN_PASSING_STAT:
        const passingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_PASSING_STAT])
        aggregatedStats = aggregatePassingStats(rawStats as PassingStats[], passingOrder.sorter)
        formattedStats = await formatPassingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = passingOrder.shortName
        break
      case MaddenEvents.MADDEN_RUSHING_STAT:
        const rushingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_RUSHING_STAT])
        aggregatedStats = aggregateRushingStats(rawStats as RushingStats[], rushingOrder.sorter)
        formattedStats = await formatRushingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = rushingOrder.shortName
        break
      case MaddenEvents.MADDEN_RECEIVING_STAT:
        const receivingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_RECEIVING_STAT])
        aggregatedStats = aggregateReceivingStats(rawStats as ReceivingStats[], receivingOrder.sorter)
        formattedStats = await formatReceivingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = receivingOrder.shortName
        break
      case MaddenEvents.MADDEN_DEFENSIVE_STAT:
        const defensiveOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_DEFENSIVE_STAT])
        aggregatedStats = aggregateDefensiveStats(rawStats as DefensiveStats[], defensiveOrder.sorter)
        formattedStats = await formatDefensiveStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = defensiveOrder.shortName
        break
      case MaddenEvents.MADDEN_KICKING_STAT:
        const kickingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_KICKING_STAT])
        aggregatedStats = aggregateKickingStats(rawStats as KickingStats[], kickingOrder.sorter)
        formattedStats = await formatKickingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = kickingOrder.shortName
        break
      case MaddenEvents.MADDEN_PUNTING_STAT:
        const puntingOrder = findSortOrder(sortOrder, statEventTypes[MaddenEvents.MADDEN_PUNTING_STAT])
        aggregatedStats = aggregatePuntingStats(rawStats as PuntingStats[], puntingOrder.sorter)
        formattedStats = await formatPuntingStats(aggregatedStats.slice(startIdx, endIdx), leagueId, teams, logos)
        shortSortOrder = puntingOrder.shortName
        break
      default:
        aggregatedStats = []
        formattedStats = "No stats available"
        shortSortOrder = ""
    }

    const statTypeLabel = statEventTypes[statType].label || "Stats"

    const message = formattedStats
      ? `# ${MADDEN_SEASON + actualSeason} Season ${statTypeLabel} Leaders\n${formattedStats}`
      : `# ${MADDEN_SEASON + actualSeason} Season ${statTypeLabel} Leaders\nNo stats available`

    // Create pagination buttons
    const backDisabled = page === 0
    const nextDisabled = endIdx >= aggregatedStats.length
    const currentPagination = { st: LONG_TO_SHORT_MAPPING[statType], s: actualSeason, p: page, so: shortSortOrder }

    // Create stat type selector
    const statTypeOptions = Object.values(statEventTypes).map(sType => ({
      label: sType.label,
      value: JSON.stringify({ st: sType.shortValue, s: actualSeason, p: 0, so: sType.sortOrders[0].shortName })
    }))
    const sortOptions = statEventTypes[statType].sortOrders.map(sortOrder => (
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: sortOrder.label,
        disabled: sortOrder.shortName === shortSortOrder,
        // differentiate id
        custom_id: JSON.stringify({ st: LONG_TO_SHORT_MAPPING[statType], s: actualSeason, p: 0, so: sortOrder.shortName, b: "b" })
      }))


    // Create season selector
    const seasonOptions = [...new Set(allWeeks.map(ws => ws.seasonIndex))]
      .sort((a, b) => a - b)
      .map(s => ({
        label: `Season ${s + MADDEN_SEASON}`,
        value: JSON.stringify({ st: LONG_TO_SHORT_MAPPING[statType], s: actualSeason, p: 0, so: shortSortOrder })
      }))

    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: message
        },
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Large
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: "Previous",
              disabled: backDisabled,
              custom_id: JSON.stringify({ ...currentPagination, p: page - 1 })
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: "Next",
              disabled: nextDisabled,
              custom_id: JSON.stringify({ ...currentPagination, p: page + 1 })
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: sortOptions
        },
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Small
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: "season_stat_type_selector",
              placeholder: statTypeLabel,
              options: statTypeOptions
            }
          ]
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: "season_season_selector",
              placeholder: `Season ${actualSeason + MADDEN_SEASON}`,
              options: seasonOptions
            }
          ]
        }
      ]
    })
  } catch (e) {
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Failed to show season stats: ${e}`
        }
      ]
    })
  }
}

function getWeeklyStatSelection(interaction: MessageComponentInteraction) {
  const customId = interaction.custom_id
  if (customId === "weekly_stat_type_selector" || customId === "weekly_week_selector" || customId === "weekly_season_selector") {
    const data = interaction.data as APIMessageStringSelectInteractionData
    if (data.values.length !== 1) {
      throw new Error("Somehow did not receive just one selection from stats selector " + data.values)
    }
    return JSON.parse(data.values[0]) as WeekStatsPagination
  } else {
    try {
      const parsedId = JSON.parse(customId)
      if (parsedId.st != null && parsedId.w != null && parsedId.s != null && parsedId.p != null) {
        return parsedId as WeekStatsPagination
      }
    } catch (e) {
    }
  }
}

function getSeasonStatSelection(interaction: MessageComponentInteraction) {
  const customId = interaction.custom_id
  if (customId === "season_stat_type_selector" || customId === "season_season_selector") {
    const data = interaction.data as APIMessageStringSelectInteractionData
    if (data.values.length !== 1) {
      throw new Error("Somehow did not receive just one selection from schedule selector " + data.values)
    }
    return JSON.parse(data.values[0]) as SeasonStatsPagination
  } else {
    try {
      const parsedId = JSON.parse(customId)
      if (parsedId.st != null && parsedId.s != null && parsedId.p != null) {
        return parsedId as SeasonStatsPagination
      }
    } catch (e) {
    }
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id, token } = command

    const discordLeague = await discordLeagueView.createView(guild_id)
    const leagueId = discordLeague?.leagueId
    if (!leagueId) {
      throw new NoConnectedLeagueError(guild_id)
    }

    if (!command.data.options) {
      throw new Error("stats command not defined properly")
    }

    const options = command.data.options
    const statsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption

    if (statsCommand.name === "weekly") {
      const statType = (statsCommand.options?.find(o => o.name === "stat_type") as APIApplicationCommandInteractionDataStringOption)?.value as PlayerStatEvents ?? MaddenEvents.MADDEN_PASSING_STAT
      const week = (statsCommand.options?.find(o => o.name === "week") as APIApplicationCommandInteractionDataIntegerOption)?.value ?? -1
      const season = (statsCommand.options?.find(o => o.name === "season") as APIApplicationCommandInteractionDataIntegerOption)?.value ?? -1

      showWeeklyStats(token, client, leagueId, statType, statEventTypes[statType].sortOrders[0].shortName, Number(week), Number(season))
      return deferMessage()
    } else if (statsCommand.name === "season") {
      const statType = (statsCommand.options?.find(o => o.name === "stat_type") as APIApplicationCommandInteractionDataStringOption)?.value as PlayerStatEvents ?? MaddenEvents.MADDEN_PASSING_STAT
      const season = (statsCommand.options?.find(o => o.name === "season") as APIApplicationCommandInteractionDataIntegerOption)?.value ?? -1

      showSeasonStats(token, client, leagueId, statType, statEventTypes[statType].sortOrders[0].shortName, Number(season))
      return deferMessage()
    }

    throw new Error("Invalid stats subcommand")
  },

  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "stats",
      description: "shows player stats for your league",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "weekly",
          description: "shows weekly stat leaders",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "stat_type",
              description: "passing, rushing, receiving, defense...",
              required: false,
              choices: Object.entries(statEventTypes).map(f => ({ name: f[1].label, value: f[0] }))
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "week",
              description: "optional week to show stats for",
              required: false
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "season",
              description: "optional season to show stats for",
              required: false
            }
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "season",
          description: "shows season stat leaders",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "stat_type",
              description: "passing, rushing, receiving, defense...",
              required: false,
              choices: Object.entries(statEventTypes).map(f => ({ name: f[1].label, value: f[0] }))
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "season",
              description: "optional season to show stats for",
              required: false
            }
          ],
        }
      ],
      type: ApplicationCommandType.ChatInput,
    }
  },

  async handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient) {
    try {
      const guildId = interaction.guild_id
      const discordLeague = await discordLeagueView.createView(guildId)
      const leagueId = discordLeague?.leagueId

      if (!leagueId) {
        throw new NoConnectedLeagueError(guildId)
      }
      const weekStatSelection = getWeeklyStatSelection(interaction)
      const seasonStatSelection = getSeasonStatSelection(interaction)
      if (weekStatSelection) {
        showWeeklyStats(interaction.token, client, leagueId, SHORT_TO_LONG_MAPPING[weekStatSelection.st], weekStatSelection.so, weekStatSelection.w, weekStatSelection.s, weekStatSelection.p)
      } else if (seasonStatSelection) {
        showSeasonStats(interaction.token, client, leagueId, SHORT_TO_LONG_MAPPING[seasonStatSelection.st], seasonStatSelection.so, seasonStatSelection.s, seasonStatSelection.p)
      }

    } catch (e) {
      await client.editOriginalInteraction(interaction.token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `Could not show stats. Error: ${e}`
          }
        ]
      })
    }

    return {
      type: InteractionResponseType.DeferredMessageUpdate,
    }
  }
}
