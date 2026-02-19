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

type StatTypeConfig = {
  label: string
  value: PlayerStatEvents
  offensiveStat: boolean,
  shortValue: string
}

const statEventTypes: StatTypeConfig[] = [
  { label: "Passing", value: MaddenEvents.MADDEN_PASSING_STAT, offensiveStat: true, shortValue: "pa" },
  { label: "Rushing", value: MaddenEvents.MADDEN_RUSHING_STAT, offensiveStat: true, shortValue: "ru" },
  { label: "Receiving", value: MaddenEvents.MADDEN_RECEIVING_STAT, offensiveStat: true, shortValue: "rc" },
  { label: "Defense", value: MaddenEvents.MADDEN_DEFENSIVE_STAT, offensiveStat: false, shortValue: "d" },
  { label: "Kicking", value: MaddenEvents.MADDEN_KICKING_STAT, offensiveStat: false, shortValue: "k" },
  { label: "Punting", value: MaddenEvents.MADDEN_PUNTING_STAT, offensiveStat: false, shortValue: "pu" },
]

type WeekStatsPagination = {
  st: PlayerStatEvents  // stat type
  w?: number            // week
  s?: number            // season
  p: number             // page
}

type SeasonStatsPagination = {
  st: PlayerStatEvents  // stat type
  s?: number            // season
  p: number             // page
}

type WeekSelection = { w: number, s: number }
type SeasonSelection = { s: number }

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

function aggregatePassingStats(stats: PassingStats[]): PassingAggregation[] {
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

  return Array.from(aggregated.values()).sort((a, b) => b.passYds - a.passYds)
}

function aggregateRushingStats(stats: RushingStats[]): RushingAggregation[] {
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

  return Array.from(aggregated.values()).sort((a, b) => b.rushYds - a.rushYds)
}

function aggregateReceivingStats(stats: ReceivingStats[]): ReceivingAggregation[] {
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

  return Array.from(aggregated.values()).sort((a, b) => b.recYds - a.recYds)
}

function aggregateDefensiveStats(stats: DefensiveStats[]): DefensiveAggregation[] {
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

  return Array.from(aggregated.values()).sort((a, b) => b.defTotalTackles - a.defTotalTackles)
}

function aggregateKickingStats(stats: KickingStats[]): KickingAggregation[] {
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

  return Array.from(aggregated.values()).sort((a, b) => b.kickPts - a.kickPts)
}

function aggregatePuntingStats(stats: PuntingStats[]): PuntingAggregation[] {
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

  return Array.from(aggregated.values()).sort((a, b) => b.puntYds - a.puntYds)
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


async function showWeeklyStats(
  token: string,
  client: DiscordClient,
  leagueId: string,
  statType: PlayerStatEvents,
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


    // Get the actual week/season from stats if not specified
    const actualWeek = weekIndex + 1
    const actualSeason = seasonIndex

    let aggregatedStats: any[]
    let formattedStats: string

    // Aggregate and format based on stat type
    switch (statType) {
      case MaddenEvents.MADDEN_PASSING_STAT:
        aggregatedStats = aggregatePassingStats(rawStats as PassingStats[])
        break
      case MaddenEvents.MADDEN_RUSHING_STAT:
        aggregatedStats = aggregateRushingStats(rawStats as RushingStats[])
        break
      case MaddenEvents.MADDEN_RECEIVING_STAT:
        aggregatedStats = aggregateReceivingStats(rawStats as ReceivingStats[])
        break
      case MaddenEvents.MADDEN_DEFENSIVE_STAT:
        aggregatedStats = aggregateDefensiveStats(rawStats as DefensiveStats[])
        break
      case MaddenEvents.MADDEN_KICKING_STAT:
        aggregatedStats = aggregateKickingStats(rawStats as KickingStats[])
        break
      case MaddenEvents.MADDEN_PUNTING_STAT:
        aggregatedStats = aggregatePuntingStats(rawStats as PuntingStats[])
        break
      default:
        throw new Error("Invalid stat type")
    }

    // Paginate
    const startIdx = page * PAGINATION_LIMIT
    const endIdx = startIdx + PAGINATION_LIMIT
    const paginatedStats = aggregatedStats.slice(startIdx, endIdx)

    // Format stats
    switch (statType) {
      case MaddenEvents.MADDEN_PASSING_STAT:
        formattedStats = await formatPassingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_RUSHING_STAT:
        formattedStats = await formatRushingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_RECEIVING_STAT:
        formattedStats = await formatReceivingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_DEFENSIVE_STAT:
        formattedStats = await formatDefensiveStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_KICKING_STAT:
        formattedStats = await formatKickingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_PUNTING_STAT:
        formattedStats = await formatPuntingStats(paginatedStats, leagueId, teams, logos)
        break
      default:
        formattedStats = "No stats available"
    }

    const statTypeLabel = statEventTypes.find(t => t.value === statType)?.label || "Stats"
    const showing = `Showing ${startIdx + 1}-${Math.min(endIdx, aggregatedStats.length)} of ${aggregatedStats.length}`

    const message = formattedStats
      ? `# ${getMessageForWeek(actualWeek)} ${statTypeLabel} Leaders - ${MADDEN_SEASON + actualSeason}\n${showing}\n\n${formattedStats}`
      : `# ${getMessageForWeek(actualWeek)} ${statTypeLabel} Leaders - ${MADDEN_SEASON + actualSeason}\nNo stats available`

    // Create pagination buttons
    const backDisabled = page === 0
    const nextDisabled = endIdx >= aggregatedStats.length
    const currentPagination: WeekStatsPagination = { st: "p" as PlayerStatEvents, w: actualWeek, s: actualSeason, p: page }

    // Create stat type selector
    const statTypeOptions = statEventTypes.map(type => ({
      label: type.label,
      value: JSON.stringify({ st: type.shortValue, w: actualWeek, s: actualSeason, p: 0 })
    }))

    // Create week selector
    const weekOptions = allWeeks
      .filter(ws => ws.seasonIndex === actualSeason)
      .map(ws => ({
        label: getMessageForWeek(ws.weekIndex + 1),
        value: JSON.stringify({ w: ws.weekIndex + 1, s: actualSeason })
      }))

    // Create season selector
    const seasonOptions = [...new Set(allWeeks.map(ws => ws.seasonIndex))]
      .sort((a, b) => a - b)
      .map(s => ({
        label: `Season ${s + MADDEN_SEASON}`,
        value: JSON.stringify({ w: Math.min(...allWeeks.filter(ws => ws.seasonIndex === s).map(ws => ws.weekIndex + 1) || [1]), s })
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
  season?: number,
  page: number = 0
) {
  try {
    const [rawStats, teams, logos, allWeeks] = await Promise.all([
      MaddenDB.getStatsForSeason(leagueId, statType, season),
      MaddenDB.getLatestTeams(leagueId),
      leagueLogosView.createView(leagueId),
      MaddenDB.getAllWeeks(leagueId)
    ])

    // Get the actual season from stats if not specified
    const actualSeason = season ?? (rawStats[0] ? rawStats[0].seasonIndex : 0)

    let aggregatedStats: any[]
    let formattedStats: string

    // Aggregate and format based on stat type
    switch (statType) {
      case MaddenEvents.MADDEN_PASSING_STAT:
        aggregatedStats = aggregatePassingStats(rawStats as PassingStats[])
        break
      case MaddenEvents.MADDEN_RUSHING_STAT:
        aggregatedStats = aggregateRushingStats(rawStats as RushingStats[])
        break
      case MaddenEvents.MADDEN_RECEIVING_STAT:
        aggregatedStats = aggregateReceivingStats(rawStats as ReceivingStats[])
        break
      case MaddenEvents.MADDEN_DEFENSIVE_STAT:
        aggregatedStats = aggregateDefensiveStats(rawStats as DefensiveStats[])
        break
      case MaddenEvents.MADDEN_KICKING_STAT:
        aggregatedStats = aggregateKickingStats(rawStats as KickingStats[])
        break
      case MaddenEvents.MADDEN_PUNTING_STAT:
        aggregatedStats = aggregatePuntingStats(rawStats as PuntingStats[])
        break
      default:
        throw new Error("Invalid stat type")
    }

    // Paginate
    const startIdx = page * PAGINATION_LIMIT
    const endIdx = startIdx + PAGINATION_LIMIT
    const paginatedStats = aggregatedStats.slice(startIdx, endIdx)

    // Format stats
    switch (statType) {
      case MaddenEvents.MADDEN_PASSING_STAT:
        formattedStats = await formatPassingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_RUSHING_STAT:
        formattedStats = await formatRushingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_RECEIVING_STAT:
        formattedStats = await formatReceivingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_DEFENSIVE_STAT:
        formattedStats = await formatDefensiveStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_KICKING_STAT:
        formattedStats = await formatKickingStats(paginatedStats, leagueId, teams, logos)
        break
      case MaddenEvents.MADDEN_PUNTING_STAT:
        formattedStats = await formatPuntingStats(paginatedStats, leagueId, teams, logos)
        break
      default:
        formattedStats = "No stats available"
    }

    const statTypeLabel = statEventTypes.find(t => t.value === statType)?.label || "Stats"
    const showing = `Showing ${startIdx + 1}-${Math.min(endIdx, aggregatedStats.length)} of ${aggregatedStats.length}`

    const message = formattedStats
      ? `# ${MADDEN_SEASON + actualSeason} Season ${statTypeLabel} Leaders\n${showing}\n\n${formattedStats}`
      : `# ${MADDEN_SEASON + actualSeason} Season ${statTypeLabel} Leaders\nNo stats available`

    // Create pagination buttons
    const backDisabled = page === 0
    const nextDisabled = endIdx >= aggregatedStats.length
    const currentPagination: SeasonStatsPagination = { st: statType, s: actualSeason, p: page }

    // Create stat type selector
    const statTypeOptions = statEventTypes.map(type => ({
      label: type.label,
      value: JSON.stringify({ st: type.value, s: actualSeason, p: 0 } as SeasonStatsPagination)
    }))

    // Create season selector
    const seasonOptions = [...new Set(allWeeks.map(ws => ws.seasonIndex))]
      .sort((a, b) => a - b)
      .map(s => ({
        label: `Season ${s + MADDEN_SEASON}`,
        value: JSON.stringify({ s })
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

      showWeeklyStats(token, client, leagueId, statType, Number(week), Number(season))
      return deferMessage()
    } else if (statsCommand.name === "season") {
      const statType = (statsCommand.options?.find(o => o.name === "stat_type") as APIApplicationCommandInteractionDataStringOption)?.value as PlayerStatEvents ?? MaddenEvents.MADDEN_PASSING_STAT
      const season = (statsCommand.options?.find(o => o.name === "season") as APIApplicationCommandInteractionDataIntegerOption)?.value ?? -1

      showSeasonStats(token, client, leagueId, statType, Number(season))
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
              choices: statEventTypes.map(f => ({ name: f.label, value: f.value }))
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
              choices: statEventTypes.map(f => ({ name: f.label, value: f.value }))
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
      const customId = interaction.custom_id
      const guildId = interaction.guild_id
      const discordLeague = await discordLeagueView.createView(guildId)
      const leagueId = discordLeague?.leagueId

      if (!leagueId) {
        throw new NoConnectedLeagueError(guildId)
      }

      // Handle weekly stats interactions
      if (customId === "weekly_stat_type_selector") {
        const data = interaction.data as APIMessageStringSelectInteractionData
        const pagination: WeekStatsPagination = JSON.parse(data.values[0])
        showWeeklyStats(interaction.token, client, leagueId, pagination.st, pagination.w, pagination.s, pagination.p)
      } else if (customId === "weekly_week_selector" || customId === "weekly_season_selector") {
        const data = interaction.data as APIMessageStringSelectInteractionData
        const selection: WeekSelection = JSON.parse(data.values[0])
        // Default to passing stats when changing week/season
        showWeeklyStats(interaction.token, client, leagueId, MaddenEvents.MADDEN_PASSING_STAT, selection.w, selection.s, 0)
      }
      // Handle season stats interactions
      else if (customId === "season_stat_type_selector") {
        const data = interaction.data as APIMessageStringSelectInteractionData
        const pagination: SeasonStatsPagination = JSON.parse(data.values[0])
        showSeasonStats(interaction.token, client, leagueId, pagination.st, pagination.s, pagination.p)
      } else if (customId === "season_season_selector") {
        const data = interaction.data as APIMessageStringSelectInteractionData
        const selection: SeasonSelection = JSON.parse(data.values[0])
        // Default to passing stats when changing season
        showSeasonStats(interaction.token, client, leagueId, MaddenEvents.MADDEN_PASSING_STAT, selection.s, 0)
      }
      // Handle pagination buttons
      else {
        try {
          const pagination = JSON.parse(customId)
          if ('w' in pagination) {
            // Weekly stats pagination
            const weekPagination = pagination as WeekStatsPagination
            showWeeklyStats(interaction.token, client, leagueId, weekPagination.st, weekPagination.w, weekPagination.s, weekPagination.p)
          } else if ('st' in pagination) {
            // Season stats pagination
            const seasonPagination = pagination as SeasonStatsPagination
            showSeasonStats(interaction.token, client, leagueId, seasonPagination.st, seasonPagination.s, seasonPagination.p)
          }
        } catch (e) {
          throw new Error(`Invalid interaction: ${customId}`)
        }
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
