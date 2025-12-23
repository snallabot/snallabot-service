import { Command, Autocomplete, MessageComponentInteraction } from "../commands_handler"
import { DiscordClient, deferMessage, getTeamEmoji, SnallabotTeamEmojis, NoConnectedLeagueError, SnallabotCommandReactions } from "../discord_utils"
import { APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, APIMessageStringSelectInteractionData, ApplicationCommandOptionType, ButtonStyle, ComponentType, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import { discordLeagueView, LeagueLogos, leagueLogosView } from "../../db/view"
import fuzzysort from "fuzzysort"
import MaddenDB, { PlayerListQuery, PlayerStatType, PlayerStats, TeamList, createPlayerKey, teamSearchView } from "../../db/madden_db"
import { DevTrait, LBStyleTrait, MADDEN_SEASON, MaddenGame, POSITIONS, POSITION_GROUP, PlayBallTrait, Player, QBStyleTrait, SensePressureTrait, YesNoTrait } from "../../export/madden_league_types"
import { ExportContext, exporterForLeague, storedTokenClient } from "../../dashboard/ea_client"
import EventDB, { EventDelivery } from "../../db/events_db"
import { EventTypes, RetiredPlayersEvent } from "../../db/events"

enum PlayerSelection {
  PLAYER_OVERVIEW = "po",
  PLAYER_FULL_RATINGS = "pr",
  PLAYER_WEEKLY_STATS = "pw",
  PLAYER_SEASON_STATS = "ps"
}

type Selection = { r: number, s: PlayerSelection, q?: PlayerPagination }

function formatPlaceholder(selection: PlayerSelection): string {
  switch (selection) {
    case PlayerSelection.PLAYER_OVERVIEW:
      return "Overview"
    case PlayerSelection.PLAYER_FULL_RATINGS:
      return "Full Ratings"
    case PlayerSelection.PLAYER_SEASON_STATS:
      return "Season Stats"
    case PlayerSelection.PLAYER_WEEKLY_STATS:
      return "Weekly Stats"
  }
}

function generatePlayerOptions(rosterId: number, pagination?: PlayerPagination) {
  return [
    {
      label: "Overview",
      value: { r: rosterId, s: PlayerSelection.PLAYER_OVERVIEW },
    },
    {
      label: "Full Ratings",
      value: { r: rosterId, s: PlayerSelection.PLAYER_FULL_RATINGS }
    },
    {
      label: "Weekly Stats",
      value: { r: rosterId, s: PlayerSelection.PLAYER_WEEKLY_STATS }
    },
    {
      label: "Season Stats",
      value: { r: rosterId, s: PlayerSelection.PLAYER_SEASON_STATS }
    }
  ].map(option => {
    if (pagination) (option.value as Selection).q = pagination
    return option
  })
    .map(option => ({ ...option, value: JSON.stringify(option.value) }))
}

function generatePlayerZoomOptions(players: Player[], currentPagination: PlayerPagination) {
  return players.map(p => ({ label: `${p.position} ${p.firstName} ${p.lastName}`, value: { r: p.rosterId, s: PlayerSelection.PLAYER_OVERVIEW, q: currentPagination } }))
    .map(option => ({ ...option, value: JSON.stringify(option.value) }))
}

async function showPlayerCard(playerSearch: string, client: DiscordClient, token: string, guild_id: string, pagination?: PlayerPagination) {
  try {
    const discordLeague = await discordLeagueView.createView(guild_id)
    const leagueId = discordLeague?.leagueId
    if (!leagueId) {
      throw new NoConnectedLeagueError(guild_id)
    }
    let searchRosterId = Number(playerSearch)
    if (isNaN(searchRosterId)) {
      // get top search result
      const results = await searchPlayerForRosterId(playerSearch, leagueId)
      if (results.length === 0) {
        throw new Error(`No player results for ${playerSearch} in ${leagueId}`)
      }
      searchRosterId = Number(results[0].rosterId)
    }
    const [player, teamList] = await Promise.all([MaddenDB.getPlayer(leagueId, `${searchRosterId}`), MaddenDB.getLatestTeams(leagueId)])
    const backToSearch = pagination ? [
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            style: ButtonStyle.Secondary,
            label: "Back to List",
            custom_id: `${JSON.stringify(pagination)}`
          }
        ]
      }

    ] : []
    const logos = await leagueLogosView.createView(leagueId)
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: formatPlayerCard(player, teamList, logos)
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
              type: ComponentType.StringSelect,
              custom_id: "player_card",
              placeholder: formatPlaceholder(PlayerSelection.PLAYER_OVERVIEW),
              options: generatePlayerOptions(searchRosterId, pagination)
            }
          ]
        },
        ...backToSearch
      ]
    })
  } catch (e) {
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Could not show player card ${e}`
        }
      ]
    })
  }
}

async function showPlayerFullRatings(rosterId: number, client: DiscordClient, token: string, guild_id: string, pagination?: PlayerPagination) {
  const discordLeague = await discordLeagueView.createView(guild_id)
  const leagueId = discordLeague?.leagueId
  if (!leagueId) {
    throw new NoConnectedLeagueError(guild_id)
  }
  const [player, teamList] = await Promise.all([MaddenDB.getPlayer(leagueId, `${rosterId}`), MaddenDB.getLatestTeams(leagueId)])
  // 0 team id means the player is a free agent
  const backToSearch = pagination ? [
    {
      type: ComponentType.Separator,
      divider: true,
      spacing: SeparatorSpacingSize.Small
    },
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "Back to List",
          custom_id: `${JSON.stringify(pagination)}`
        }
      ]
    }

  ] : []
  const logos = await leagueLogosView.createView(leagueId)
  await client.editOriginalInteraction(token, {
    flags: 32768,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: formatFullRatings(player, teamList, logos)
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
            type: ComponentType.StringSelect,
            custom_id: "player_card",
            placeholder: formatPlaceholder(PlayerSelection.PLAYER_FULL_RATINGS),
            options: generatePlayerOptions(rosterId, pagination)
          }
        ]
      },
      ...backToSearch
    ]
  })
}

async function showPlayerWeeklyStats(rosterId: number, client: DiscordClient, token: string, guild_id: string, pagination?: PlayerPagination) {
  const discordLeague = await discordLeagueView.createView(guild_id)
  const leagueId = discordLeague?.leagueId
  if (!leagueId) {
    throw new NoConnectedLeagueError(guild_id)
  }
  const [player, teamList] = await Promise.all([MaddenDB.getPlayer(leagueId, `${rosterId}`), MaddenDB.getLatestTeams(leagueId)])
  const playerStats = await MaddenDB.getPlayerStats(leagueId, player)
  const statGames = new Map<String, { id: number, week: number, season: number }>()
  Object.values(playerStats).flat().forEach(p => statGames.set(`${p.scheduleId}|${p.weekIndex}|${p.seasonIndex}`, { id: p.scheduleId, week: p.weekIndex + 1, season: p.seasonIndex }))
  const games = await MaddenDB.getGamesForSchedule(leagueId, Array.from(statGames.values()))
  const backToSearch = pagination ? [
    {
      type: ComponentType.Separator,
      divider: true,
      spacing: SeparatorSpacingSize.Small
    },
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "Back to List",
          custom_id: `${JSON.stringify(pagination)}`
        }
      ]
    }

  ] : []
  const logos = await leagueLogosView.createView(leagueId)
  await client.editOriginalInteraction(token, {
    flags: 32768,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: formatWeeklyStats(player, teamList, playerStats, games, logos)
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
            type: ComponentType.StringSelect,
            custom_id: "player_card",
            placeholder: formatPlaceholder(PlayerSelection.PLAYER_WEEKLY_STATS),
            options: generatePlayerOptions(rosterId, pagination)
          }
        ]
      },
      ...backToSearch
    ]
  })
}

async function showPlayerYearlyStats(rosterId: number, client: DiscordClient, token: string, guild_id: string, pagination?: PlayerPagination) {
  const discordLeague = await discordLeagueView.createView(guild_id)
  const leagueId = discordLeague?.leagueId
  if (!leagueId) {
    throw new NoConnectedLeagueError(guild_id)
  }
  const [player, teamList] = await Promise.all([MaddenDB.getPlayer(leagueId, `${rosterId}`), MaddenDB.getLatestTeams(leagueId)])
  const playerStats = await MaddenDB.getPlayerStats(leagueId, player)
  const backToSearch = pagination ? [
    {
      type: ComponentType.Separator,
      divider: true,
      spacing: SeparatorSpacingSize.Small
    },
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          label: "Back to List",
          custom_id: `${JSON.stringify(pagination)}`
        }
      ]
    }

  ] : []
  const logos = await leagueLogosView.createView(leagueId)
  await client.editOriginalInteraction(token, {
    flags: 32768,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: formatSeasonStats(player, playerStats, teamList, logos)
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
            type: ComponentType.StringSelect,
            custom_id: "player_card",
            placeholder: formatPlaceholder(PlayerSelection.PLAYER_SEASON_STATS),
            options: generatePlayerOptions(rosterId, pagination)
          }
        ]
      },
      ...backToSearch
    ]
  })
}
type ShortPlayerListQuery = { t?: number, p?: string, r?: boolean, e?: boolean }
function toShortQuery(q: PlayerListQuery) {
  const query: ShortPlayerListQuery = {}
  if (q.teamId === 0 || (q.teamId && q.teamId !== -1)) query.t = q.teamId
  if (q.position) query.p = q.position
  if (q.rookie) query.r = q.rookie
  if (q.retired) query.e = q.retired
  return query
}

function fromShortQuery(q: ShortPlayerListQuery) {
  const query: PlayerListQuery = {}
  if (q.t === 0 || (q.t && q.t !== -1)) query.teamId = q.t
  if (q.p) query.position = q.p
  if (q.r) query.rookie = q.r
  if (q.e) query.retired = q.e
  return query
}
type PlayerPagination = { q: ShortPlayerListQuery, s?: number, b?: number }
const PAGINATION_LIMIT = 5

async function getPlayers(leagueId: string, query: PlayerListQuery, startAfterPlayer?: number, endBeforePlayer?: number) {
  // if we reach the end just start over 
  if (startAfterPlayer) {
    const player = await MaddenDB.getPlayer(leagueId, `${startAfterPlayer}`)
    const players = await MaddenDB.getPlayers(leagueId, query, PAGINATION_LIMIT, player)
    if (players.length === 0) {
      return await MaddenDB.getPlayers(leagueId, query, PAGINATION_LIMIT)
    }
    return players
  }
  else if (endBeforePlayer) {
    const player = await MaddenDB.getPlayer(leagueId, `${endBeforePlayer}`)
    const players = await MaddenDB.getPlayers(leagueId, query, PAGINATION_LIMIT, undefined, player)
    if (players.length === 0) {
      return await MaddenDB.getPlayers(leagueId, query, PAGINATION_LIMIT)
    }
    return players
  } else {
    return await MaddenDB.getPlayers(leagueId, query, PAGINATION_LIMIT)
  }
}

async function showPlayerList(playerSearch: string, client: DiscordClient, token: string, guild_id: string, startAfterPlayer?: number, endBeforePlayer?: number) {
  try {
    const discordLeague = await discordLeagueView.createView(guild_id)
    const leagueId = discordLeague?.leagueId
    if (!leagueId) {
      throw new NoConnectedLeagueError(guild_id)
    }
    let query: PlayerListQuery;
    try {
      query = JSON.parse(playerSearch) as PlayerListQuery
    } catch (e) {
      const results = await searchPlayerListForQuery(playerSearch, leagueId)
      if (results.length === 0) {
        throw new Error(`No listable results for ${playerSearch} in ${leagueId}`)
      }
      const { teamId, rookie, position } = results[0]
      query = { teamId, rookie: rookie ? true : false, position }
    }
    const [players, teamList, logos] = await Promise.all([getPlayers(leagueId, query, startAfterPlayer, endBeforePlayer), MaddenDB.getLatestTeams(leagueId), leagueLogosView.createView(leagueId)])
    const message = players.length === 0 ? `# No results` : formatPlayerList(players, teamList, logos)
    const backDisabled = startAfterPlayer || endBeforePlayer ? false : true
    const nextDisabled = players.length < PAGINATION_LIMIT ? true : false
    const nextPagination = players.length === 0 ? startAfterPlayer : players[players.length - 1].rosterId
    const previousPagination = players.length === 0 ? endBeforePlayer : players[0].rosterId
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: message
        },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: "Back",
              disabled: backDisabled,
              custom_id: `${JSON.stringify({ q: toShortQuery(query), b: previousPagination ? previousPagination : -1 })}`
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: "Next",
              custom_id: `${JSON.stringify({ q: toShortQuery(query), s: nextPagination ? nextPagination : -1 })}`,
              disabled: nextDisabled
            }
          ]
        },
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Large
        },
        ...(players.length === 0 ? [] : [{
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.StringSelect,
              custom_id: "player_card",
              placeholder: `Show Player Card`,
              options: generatePlayerZoomOptions(players, { q: toShortQuery(query), s: startAfterPlayer, b: endBeforePlayer })
            }
          ]
        }])
      ]
    })
  } catch (e) {
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Could not list players  ${e} `
        }
      ]
    })
  }
}

function getTopAttributesByPosition(player: Player): Array<{ name: string, value: number }> {
  const attributes: Array<{ name: string, value: number }> = []
  attributes.push(
    { name: "Speed", value: player.speedRating },
    { name: "Accel", value: player.accelRating },
    { name: "Agility", value: player.agilityRating },
    { name: "Awareness", value: player.awareRating },
    { name: "Injury", value: player.injuryRating }
  )

  switch (player.position) {
    case "QB":
      attributes.push(
        { name: "Throw Power", value: player.throwPowerRating },
        { name: "Deep Acc", value: player.throwAccDeepRating },
        { name: "Medium Acc", value: player.throwAccMidRating },
        { name: "Short Acc", value: player.throwAccShortRating },
        { name: "Play Action", value: player.playActionRating },
        { name: "Throw Under Pressure", value: player.throwUnderPressureRating },
        { name: "Break Sack", value: player.breakSackRating },
      )
      break
    case "FB":
      attributes.push(
        { name: "Impact Blocking", value: player.impactBlockRating },
        { name: "Lead Block", value: player.leadBlockRating },
        { name: "Run Block", value: player.runBlockRating },
        { name: "Strength", value: player.strengthRating },
        { name: "Pass Block", value: player.passBlockRating },
        { name: "Truck", value: player.truckRating },
        { name: "Stiff Arm", value: player.stiffArmRating },
        { name: "Carrying", value: player.carryRating },
        { name: "Break Tackle", value: player.breakTackleRating },
      )
      break
    case "HB":
      attributes.push(
        { name: "Break Tackle", value: player.breakTackleRating },
        { name: "Carrying", value: player.carryRating },
        { name: "BC Vision", value: player.bCVRating },
        { name: "Truck", value: player.truckRating },
        { name: "Stiff Arm", value: player.stiffArmRating },
        { name: "Juke Move", value: player.jukeMoveRating },
        { name: "Spin Move", value: player.spinMoveRating },
        { name: "COD", value: player.changeOfDirectionRating },
        { name: "Strength", value: player.strengthRating }
      )
      break
    // catching, catch in traffic, short route, medium route, deep route, spec, release, jumping
    // secondary: BC vision, carryign, cod, trucking, break tackle, stiff arm, juke, spin, run, pass, impact, kick, injury, stamin, toughness
    case "WR":
      attributes.push(
        { name: "Catching", value: player.catchRating },
        { name: "Catch in Traffic", value: player.cITRating },
        { name: "Short Route", value: player.routeRunShortRating },
        { name: "Medium Route", value: player.routeRunMedRating },
        { name: "Deep Route", value: player.routeRunDeepRating },
        { name: "Spectacular Catch", value: player.specCatchRating },
        { name: "Release", value: player.releaseRating },
        { name: "Jumping", value: player.jumpRating },
      )
      break
    // speed, catching, run block, awarness, short, medium, deep, acc, cit, spec, impact, pass, lead, break
    // secondary: run power, run finess, pass power, pass finess, trucking, stif, carrying, cod, spin, juke, bc, injury, stamina, toughness
    case "TE":
      attributes.push(
        { name: "Catching", value: player.catchRating },
        { name: "Run Block", value: player.runBlockRating },
        { name: "Short Route", value: player.routeRunShortRating },
        { name: "Medium Route", value: player.routeRunMedRating },
        { name: "Deep Route", value: player.routeRunDeepRating },
        { name: "Catch in Traffic", value: player.cITRating },
        { name: "Spectacular Catch", value: player.specCatchRating },
        { name: "Impact Blocking", value: player.impactBlockRating },
        { name: "Pass Blocking", value: player.passBlockRating },
        { name: "Lead Blocking", value: player.leadBlockRating },
        { name: "Break Tackle", value: player.breakTackleRating },
      )
      break
    case "LT":
    case "LG":
    case "C":
    case "RG":
    case "RT":
      attributes.push(
        { name: "Strength", value: player.strengthRating },
        { name: "Run Block", value: player.runBlockRating },
        { name: "Pass Block", value: player.passBlockRating },
        { name: "Run Block Power", value: player.runBlockPowerRating },
        { name: "Run Block Finesse", value: player.runBlockFinesseRating },
        { name: "Pass Block Power", value: player.passBlockPowerRating },
        { name: "Pass Block Finesse", value: player.passBlockFinesseRating },
        { name: "Lead Block", value: player.leadBlockRating },
        { name: "Impact Blocking", value: player.impactBlockRating },
        { name: "Long Snap", value: player.longSnapRating }
      )
      break
    case "LEDGE":
    case "REDGE":
      attributes.push(
        { name: "Power Moves", value: player.powerMovesRating },
        { name: "Finesse Moves", value: player.finesseMovesRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Play Rec", value: player.playRecRating },
        { name: "Strength", value: player.strengthRating },
      )
      break
    case "DT":
      attributes.push(
        { name: "Strength", value: player.strengthRating },
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Power Moves", value: player.powerMovesRating },
        { name: "Finesse Moves", value: player.finesseMovesRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Play Rec", value: player.playRecRating },
      )
      break
    case "SAM":
    case "WILL":
      attributes.push(
        { name: "Hit Power", value: player.hitPowerRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Power Moves", value: player.powerMovesRating },
        { name: "Finesse Moves", value: player.finesseMovesRating },
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Play Rec", value: player.playRecRating },
      )
      break
    case "MIKE":
      attributes.push(
        { name: "Tackle", value: player.tackleRating },
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Hit Power", value: player.hitPowerRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Play Rec", value: player.playRecRating },
        { name: "Strength", value: player.strengthRating },
        { name: "Zone Coverage", value: player.zoneCoverRating },
      )
      break
    case "CB":
      attributes.push(
        { name: "Man Coverage", value: player.manCoverRating },
        { name: "Zone Coverage", value: player.zoneCoverRating },
        { name: "Play Rec", value: player.playRecRating },
        { name: "Press", value: player.pressRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Jumping", value: player.jumpRating },
        { name: "Catching", value: player.catchRating },
      )
      break
    case "FS":
    case "SS":
      attributes.push(
        { name: "Man Coverage", value: player.manCoverRating },
        { name: "Zone Coverage", value: player.zoneCoverRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Play Rec", value: player.playRecRating },
        { name: "Hit Power", value: player.hitPowerRating },
        { name: "Block Shedding", value: player.blockShedRating },
      )
      break
    case "K":
    case "P":
      attributes.push(
        { name: "Kick Power", value: player.kickPowerRating },
        { name: "Kick Accuracy", value: player.kickAccRating },
      )
      break
  }

  return attributes
}

function getPositionalTraits(player: Player) {
  const attributes: Array<{ name: string, value: string }> = []
  const yesNoAttributes: { name: string, value: YesNoTrait }[] = []

  switch (player.position) {
    case "QB":
      attributes.push(
        { name: "QB Style", value: formatQbStyle(player.qBStyleTrait) },
        { name: "Sense Pressure", value: formatSensePressure(player.sensePressureTrait) },
      )
      yesNoAttributes.push({ name: "Throw Away", value: player.throwAwayTrait },
        { name: "Tight Spiral", value: player.tightSpiralTrait })
      break
    case "FB":
    case "HB":
    case "WR":
    case "TE":
      yesNoAttributes.push(
        { name: "YAC Catch", value: player.yACCatchTrait },
        { name: "Possesion Catch", value: player.posCatchTrait },
        { name: "Aggressive Catch", value: player.hPCatchTrait },
        { name: "Fight for Yards", value: player.fightForYardsTrait },
        { name: "Feet in Bounds", value: player.feetInBoundsTrait },
        { name: "Drop Open Passes", value: player.dropOpenPassTrait }
      )
      break
    case "LT":
    case "LG":
    case "C":
    case "RG":
    case "RT":
      break
    case "LE":
    case "RE":
    case "DT":
      yesNoAttributes.push(
        { name: "DL Swim Move", value: player.dLSwimTrait },
        { name: "DL Spin Move", value: player.dLSpinTrait },
        { name: "DL Bull Rush", value: player.dLBullRushTrait },
        { name: "Strip Ball", value: player.stripBallTrait },
        { name: "High Motor", value: player.highMotorTrait },
      )
      break
    case "LOLB":
    case "ROLB":
    case "MLB":
      attributes.push(
        { name: "LB Style", value: formatLbStyle(player.lBStyleTrait) },
        { name: "Play Ball", value: formatPlayBallTrait(player.playBallTrait) }
      )
      yesNoAttributes.push(
        { name: "DL Swim Move", value: player.dLSwimTrait },
        { name: "DL Spin Move", value: player.dLSpinTrait },
        { name: "DL Bull Rush", value: player.dLBullRushTrait },
        { name: "Strip Ball", value: player.stripBallTrait },
        { name: "High Motor", value: player.highMotorTrait },
        { name: "Big Hitter", value: player.bigHitTrait },
      )
      break
    case "CB":
    case "FS":
    case "SS":
      attributes.push(
        { name: "Play Ball", value: formatPlayBallTrait(player.playBallTrait) }
      )
      yesNoAttributes.push(
        { name: "Strip Ball", value: player.stripBallTrait },
        { name: "High Motor", value: player.highMotorTrait },
        { name: "Big Hitter", value: player.bigHitTrait },
      )
      break
    case "K":
    case "P":
      break
  }

  const yesNoTraits = yesNoAttributes.filter(trait => trait.value === YesNoTrait.YES)
    .map(attr => `> **${attr.name}:** ${formatYesNoTrait(attr.value)}`).join('\n')
  const customAttributes = attributes.map(attr => `> **${attr.name}:** ${attr.value}`).join('\n')
  return `${yesNoTraits} \n${customAttributes}`

}


function getDevTraitName(devTrait: DevTrait, yearsPro: number): string {
  // non normal dev rookies get hidden dev
  if (yearsPro === 0 && devTrait !== DevTrait.NORMAL) {
    return SnallabotDevEmojis.HIDDEN
  }
  switch (devTrait) {
    case DevTrait.NORMAL: return SnallabotDevEmojis.NORMAL
    case DevTrait.STAR: return SnallabotDevEmojis.STAR
    case DevTrait.SUPERSTAR: return SnallabotDevEmojis.SUPERSTAR
    case DevTrait.XFACTOR: return SnallabotDevEmojis.XFACTOR
    default: return "Unknown"
  }
}

enum SnallabotDevEmojis {
  NORMAL = "<:snallabot_normal_dev:1363761484131209226>",
  STAR = "<:snallabot_star_dev:1363761179805220884>",
  SUPERSTAR = "<:snallabot_superstar_dev:1363761181525020703>",
  XFACTOR = "<:snallabot_xfactor_dev:1363761178622562484>",
  HIDDEN = "<:snallabot_hidden_dev:1363761182682517565>"
}
const rules = new Intl.PluralRules("en-US", { type: "ordinal" })
const suffixes = new Map([
  ["one", "st"],
  ["two", "nd"],
  ["few", "rd"],
  ["other", "th"],
])

function getSeasonFormatting(yearsPro: number) {
  if (yearsPro === 0) {
    return "Rookie"
  }
  const rule = rules.select(yearsPro + 1)
  const suffix = suffixes.get(rule)
  return `${yearsPro + 1}${suffix} Season`
}

function formatMoney(m: number) {
  if (m >= 1000000) {
    return `${(m / 1000000).toFixed(2)}M`
  } else {
    return `${m / 1000}K`
  }
}

function getTeamAbbr(teamId: number, teams: TeamList) {
  if (teamId === 0) {
    return "FA"
  }
  return teams.getTeamForId(teamId).abbrName
}

function formatAttributes(topAttributes: { name: string, value: number }[]): string {
  const lines: string[] = [];

  for (let i = 0; i < topAttributes.length; i += 2) {
    const attr1 = topAttributes[i];
    const attr2 = topAttributes[i + 1];

    if (attr2) {
      // Both attributes exist
      lines.push(`> **${attr1.name}:** ${attr1.value} | **${attr2.name}:** ${attr2.value}`);
    } else {
      // Only first attribute exists (odd number of attributes)
      lines.push(`> **${attr1.name}:** ${attr1.value}`);
    }
  }

  return lines.join('\n');
}

function formatPlayerCard(player: Player, teams: TeamList, logos: LeagueLogos) {

  const teamAbbr = getTeamAbbr(player.teamId, teams)
  const heightFeet = Math.floor(player.height / 12)
  const heightInches = player.height % 12
  const formattedHeight = `${heightFeet}'${heightInches}"`

  let age = player.age

  const contractStatus = player.isFreeAgent ? "Free Agent" :
    `> **Length**: ${player.contractYearsLeft}/${player.contractLength} yrs | **Salary**: $${formatMoney(player.contractSalary)}\n> **Cap Hit**: $${formatMoney(player.capHit)} | **Bonus**: $${formatMoney(player.contractBonus)}\n> **Savings**: $${formatMoney(player.capReleaseNetSavings)} | **Penalty**: $${formatMoney(player.capReleasePenalty)}`

  const topAttributes = getTopAttributesByPosition(player)

  const abilities = player.signatureSlotList && player.signatureSlotList.length > 0
    ? "\n**Abilities:** " + player.signatureSlotList
      .filter(ability => !ability.isEmpty && ability.signatureAbility)
      .map(ability => {
        return ability.signatureAbility?.signatureTitle || "Unnamed Ability"
      })
      .join(", ")
    : ""
  return `
  # ${getTeamEmoji(teamAbbr, logos)} ${player.position} ${player.firstName} ${player.lastName}
## ${getDevTraitName(player.devTrait, player.yearsPro)} **${player.playerBestOvr} OVR**
**${age} yrs** | **${getSeasonFormatting(player.yearsPro)}** | **${formattedHeight}, ${player.weight} lbs**
### Contract
${contractStatus}
### Ratings
${formatAttributes(topAttributes)}${getPositionalTraits(player)}${abilities}`
}

function formatYesNoTrait(trait: YesNoTrait) {
  switch (trait) {
    case YesNoTrait.YES: return "<:snallabot_yes:1368090206867030056>"
    case YesNoTrait.NO: return "<:snallabot_nope:1368090205525115030>"
    default: return "Unknown"
  }
}

function formatSensePressure(sensePressureTrait: SensePressureTrait) {
  switch (sensePressureTrait) {
    case SensePressureTrait.AVERAGE: return "Average"
    case SensePressureTrait.IDEAL: return "Ideal"
    case SensePressureTrait.OBLIVIOUS: return "Oblivious"
    case SensePressureTrait.PARANOID: return "Paranoid"
    case SensePressureTrait.TRIGGER_HAPPY: return "Trigger Happy"
    default: return "Unknown"
  }
}

function formatPlayBallTrait(playBallTrait: PlayBallTrait) {
  switch (playBallTrait) {
    case PlayBallTrait.AGGRESSIVE: return "Aggressive"
    case PlayBallTrait.BALANCED: return "Balanced"
    case PlayBallTrait.CONSERVATIVE: return "Conservative"
  }
}

function formatQbStyle(qbStyle: QBStyleTrait) {
  switch (qbStyle) {
    case QBStyleTrait.BALANCED: return "Balanced"
    case QBStyleTrait.POCKET: return "Pocket"
    case QBStyleTrait.SCRAMBLING: return "Scrambling"
  }
}

function formatLbStyle(lbStyle: LBStyleTrait) {
  switch (lbStyle) {
    case LBStyleTrait.BALANCED: return "Balanced"
    case LBStyleTrait.COVER_LB: return "Cover LB"
    case LBStyleTrait.PASS_RUSH: return "Pass Rush"
  }
}


function formatFullRatings(player: Player, teams: TeamList, logos: LeagueLogos) {
  const teamAbbr = getTeamAbbr(player.teamId, teams)

  return `
  # ${getTeamEmoji(teamAbbr, logos)} ${player.position} ${player.firstName} ${player.lastName}
  ## ${getDevTraitName(player.devTrait, player.yearsPro)} **${player.playerBestOvr} OVR**
## Ratings
__**Physical Attributes:**__
**Speed:** ${player.speedRating}
**Acceleration:** ${player.accelRating}
**Agility:** ${player.agilityRating}
**Strength:** ${player.strengthRating}
**Jump:** ${player.jumpRating}
**Stamina:** ${player.staminaRating}
**Injury:** ${player.injuryRating}
**Toughness:** ${player.toughRating}
**Awareness:** ${player.awareRating}

__**Offensive Skills:**__
**Carrying:** ${player.carryRating}
**Break Tackle:** ${player.breakTackleRating}
**Trucking:** ${player.truckRating}
**Stiff Arm:** ${player.stiffArmRating}
**Spin Move:** ${player.spinMoveRating}
**Juke Move:** ${player.jukeMoveRating}
**Change of Direction:** ${player.changeOfDirectionRating}
**Ball Carrier Vision:** ${player.bCVRating}

__**Passing Skills:**__
**Throw Power:** ${player.throwPowerRating}
**Throw Accuracy:** ${player.throwAccRating}
**Throw Accuracy Short:** ${player.throwAccShortRating}
**Throw Accuracy Mid:** ${player.throwAccMidRating}
**Throw Accuracy Deep:** ${player.throwAccDeepRating}
**Throw On Run:** ${player.throwOnRunRating}
**Play Action:** ${player.playActionRating}
**Throw Under Pressure:** ${player.throwUnderPressureRating}
**Break Sack:** ${player.breakSackRating}

__**Receiving Skills:**__
**Catching:** ${player.catchRating}
**Spectacular Catch:** ${player.specCatchRating}
**Catch In Traffic:** ${player.cITRating}
**Route Running Short:** ${player.routeRunShortRating}
**Route Running Med:** ${player.routeRunMedRating}
**Route Running Deep:** ${player.routeRunDeepRating}
**Release:** ${player.releaseRating}

__**Blocking Skills:**__
**Run Block:** ${player.runBlockRating}
**Run Block Power:** ${player.runBlockPowerRating}
**Run Block Finesse:** ${player.runBlockFinesseRating}
**Pass Block:** ${player.passBlockRating}
**Pass Block Power:** ${player.passBlockPowerRating}
**Pass Block Finesse:** ${player.passBlockFinesseRating}
**Impact Block:** ${player.impactBlockRating}
**Lead Block:** ${player.leadBlockRating}
**Long Snap:** ${player.longSnapRating}

__**Defensive Skills:**__
**Tackle:** ${player.tackleRating}
**Hit Power:** ${player.hitPowerRating}
**Power Moves:** ${player.powerMovesRating}
**Finesse Moves:** ${player.finesseMovesRating}
**Block Shedding:** ${player.blockShedRating}
**Pursuit:** ${player.pursuitRating}
**Play Recognition:** ${player.playRecRating}
**Man Coverage:** ${player.manCoverRating}
**Zone Coverage:** ${player.zoneCoverRating}
**Press:** ${player.pressRating}

__**Special Teams:**__
**Kick Power:** ${player.kickPowerRating}
**Kick Accuracy:** ${player.kickAccRating}
**Kick Return:** ${player.kickRetRating}

__**Styles:**__
**QB Style:** ${formatQbStyle(player.qBStyleTrait)}
**LB Style:** ${formatLbStyle(player.lBStyleTrait)}

__**Traits:**__
**Predictable:** ${formatYesNoTrait(player.predictTrait)}
**Clutch:** ${formatYesNoTrait(player.clutchTrait)}
**Tight Spiral:** ${formatYesNoTrait(player.tightSpiralTrait)}
**Sense Pressure:** ${formatSensePressure(player.sensePressureTrait)}
**Throw Away:** ${formatYesNoTrait(player.throwAwayTrait)}
**DL Swim:** ${formatYesNoTrait(player.dLSwimTrait)}
**DL Spin:** ${formatYesNoTrait(player.dLSpinTrait)}
**DL Bull Rush:** ${formatYesNoTrait(player.dLBullRushTrait)}
**High Motor:** ${formatYesNoTrait(player.highMotorTrait)}
**Big Hitter:** ${formatYesNoTrait(player.bigHitTrait)}
**Strip Ball:** ${formatYesNoTrait(player.stripBallTrait)}
**Play Ball:** ${formatPlayBallTrait(player.playBallTrait)}
**Fight for Yards:** ${formatYesNoTrait(player.fightForYardsTrait)}
**YAC Catch:** ${formatYesNoTrait(player.yACCatchTrait)}
**Possession Catch:** ${formatYesNoTrait(player.posCatchTrait)}
**Aggressive Catch:** ${formatYesNoTrait(player.hPCatchTrait)}
**Drop Open Passes:** ${formatYesNoTrait(player.dropOpenPassTrait)}
**Feet In Bounds:** ${formatYesNoTrait(player.feetInBoundsTrait)}
`
}

function formatStats(stats: PlayerStats) {
  const formattedStats: { scheduleId: string, value: string }[] = []
  if (stats[PlayerStatType.PASSING]) {
    stats[PlayerStatType.PASSING].forEach(ps => {
      const individualStat = []
      individualStat.push(`${ps.passComp}/${ps.passAtt}`)
      individualStat.push(`${ps.passYds} PASS YDS`)
      if (ps.passTDs > 0) {
        individualStat.push(`${ps.passTDs} TD`)
      }
      if (ps.passInts > 0) {
        individualStat.push(`${ps.passInts} INT`)
      }
      individualStat.push(`${ps.passerRating.toFixed(1)} RTG`)
      formattedStats.push({ scheduleId: formatGameKey(ps), value: individualStat.join(", ") })
    });
  }
  if (stats[PlayerStatType.RUSHING]) {
    stats[PlayerStatType.RUSHING].forEach(rs => {
      const individualStat = [];
      if (rs.rushAtt > 0) {
        individualStat.push(`${rs.rushAtt} ATT`);
        individualStat.push(`${rs.rushYds} RSH YDS`);
      }
      if (rs.rushTDs > 0) {
        individualStat.push(`${rs.rushTDs} TD`);
      }
      if (rs.rushFum > 0) {
        individualStat.push(`${rs.rushFum} FUM`);
      }
      if (rs.rushYdsPerAtt > 0) {
        individualStat.push(`${rs.rushYdsPerAtt.toFixed(1)} AVG`);
      }
      formattedStats.push({ scheduleId: formatGameKey(rs), value: individualStat.join(", ") });
    });
  }

  if (stats[PlayerStatType.RECEIVING]) {
    stats[PlayerStatType.RECEIVING].forEach(rs => {
      const individualStat = [];
      individualStat.push(`${rs.recCatches} REC`);
      individualStat.push(`${rs.recYds} YDS`);
      if (rs.recTDs > 0) {
        individualStat.push(`${rs.recTDs} TD`);
      }
      formattedStats.push({ scheduleId: formatGameKey(rs), value: individualStat.join(", ") });
    });
  }

  if (stats[PlayerStatType.DEFENSE]) {
    stats[PlayerStatType.DEFENSE].forEach(ds => {
      const individualStat = [];
      individualStat.push(`${ds.defTotalTackles} TKL`);
      if (ds.defSacks > 0) {
        individualStat.push(`${ds.defSacks} SCK`);
      }
      if (ds.defInts > 0) {
        individualStat.push(`${ds.defInts} INT`);
      }
      if (ds.defFumRec > 0) {
        individualStat.push(`${ds.defFumRec} FR`);
      }
      if (ds.defForcedFum > 0) {
        individualStat.push(`${ds.defForcedFum} FF`);
      }
      if (ds.defTDs > 0) {
        individualStat.push(`${ds.defTDs} TD`);
      }
      if (ds.defDeflections > 0) {
        individualStat.push(`${ds.defDeflections} PD`);
      }
      formattedStats.push({ scheduleId: formatGameKey(ds), value: individualStat.join(", ") });
    });
  }

  if (stats[PlayerStatType.KICKING]) {
    stats[PlayerStatType.KICKING].forEach(ks => {
      const individualStat = [];
      individualStat.push(`FG ${ks.fGMade}/${ks.fGAtt}`);
      individualStat.push(`XP ${ks.xPMade}/${ks.xPAtt}`);
      if (ks.fG50PlusAtt > 0) {
        individualStat.push(`50+ ${ks.fG50PlusMade}/${ks.fG50PlusAtt}`);
      }
      if (ks.fGLongest > 0) {
        individualStat.push(`${ks.fGLongest} LNG`);
      }
      individualStat.push(`${ks.kickPts} PTS`);
      formattedStats.push({ scheduleId: formatGameKey(ks), value: individualStat.join(", ") });
    });
  }

  if (stats[PlayerStatType.PUNTING]) {
    stats[PlayerStatType.PUNTING].forEach(ps => {
      const individualStat = [];
      individualStat.push(`${ps.puntAtt} PUNTS`);
      individualStat.push(`${ps.puntYds} YDS`);
      individualStat.push(`${ps.puntYdsPerAtt.toFixed(1)} AVG`);
      individualStat.push(`${ps.puntNetYdsPerAtt.toFixed(1)} NET`);
      if (ps.puntsIn20 > 0) {
        individualStat.push(`${ps.puntsIn20} INS 20`);
      }
      if (ps.puntTBs > 0) {
        individualStat.push(`${ps.puntTBs} TB`);
      }
      if (ps.puntsBlocked > 0) {
        individualStat.push(`${ps.puntsBlocked} BLK`);
      }
      formattedStats.push({ scheduleId: formatGameKey(ps), value: individualStat.join(", ") });
    });
  }
  return formattedStats
}

function formatScore(game: MaddenGame) {
  if (game.awayScore === game.homeScore) {
    return `${game.awayScore} - ${game.homeScore}`
  }
  if (game.awayScore > game.homeScore) {
    return `**${game.awayScore}** - ${game.homeScore}`
  }
  if (game.awayScore < game.homeScore) {
    return `${game.awayScore} - **${game.homeScore}**`
  }
}

enum SnallabotGameResult {
  WIN = "<:snallabot_win:1368708001548079304>",
  LOSS = "<:snallabot_loss:1368726069963653171>",
  TIE = "<:snallabot_tie:1368713402016337950>"
}

function formatGameEmoji(game: MaddenGame, playerTeam: number, teams: TeamList) {
  if (game.awayScore === game.homeScore) {
    return SnallabotGameResult.TIE
  }
  if (game.awayScore > game.homeScore) {
    return teams.getTeamForId(game.awayTeamId).teamId === playerTeam ? SnallabotGameResult.WIN : SnallabotGameResult.LOSS
  }
  if (game.awayScore < game.homeScore) {
    return teams.getTeamForId(game.homeTeamId).teamId === playerTeam ? SnallabotGameResult.WIN : SnallabotGameResult.LOSS
  }
}

function formatWeek(game: MaddenGame) {
  if (game.weekIndex < 18) {
    return `Wk ${game.weekIndex + 1}`
  } if (game.weekIndex === 18) {
    return `Wildcard`
  } if (game.weekIndex === 19) {
    return `Divisional`
  } if (game.weekIndex === 20) {
    return `Conference`
  } if (game.weekIndex === 22) {
    return `Superbowl`
  }
}

function formatGameKey(g: { scheduleId: number, weekIndex: number, seasonIndex: number }) {
  return `${g.scheduleId}|${g.weekIndex}|${g.seasonIndex}`
}

function formatGame(game: MaddenGame, player: Player, teams: TeamList) {
  const playerTeam = teams.getTeamForId(player.teamId).teamId
  const homeTeam = teams.getTeamForId(game.homeTeamId).teamId
  const awayTeam = teams.getTeamForId(game.awayTeamId).teamId
  const opponentTeam = playerTeam === awayTeam ? homeTeam : awayTeam
  const opponent = getTeamAbbr(opponentTeam, teams)
  return `${formatWeek(game)} vs ${opponent.padEnd(3)} ${formatGameEmoji(game, playerTeam, teams)} ${formatScore(game)}:`
}

function formatWeeklyStats(player: Player, teams: TeamList, stats: PlayerStats, games: MaddenGame[], logos: LeagueLogos) {
  const currentSeason = Math.max(...games.map(g => g.seasonIndex))
  const currentGameIds = new Set(games.filter(g => g.seasonIndex === currentSeason && g.stageIndex > 0).map(g => formatGameKey(g)))
  const gameResults = Object.groupBy(games.filter(g => currentGameIds.has(formatGameKey(g))), g => formatGameKey(g))
  const gameStats = formatStats(stats)
  const weekStats = Object.entries(Object.groupBy(gameStats.filter(s => currentGameIds.has(s.scheduleId)), g => g.scheduleId)).map(gameStat => {
    const [gameKey, stats] = gameStat
    const stat = stats?.map(s => s.value).join(", ") || ""
    const result = gameResults[gameKey]
    if (!result) {
      return { weekIndex: -1, value: `` }
    }
    const game = result[0]
    return {
      weekIndex: game.weekIndex, value: `${formatGame(game, player, teams)} ${stat}`
    }
  }).sort((a, b) => (a.weekIndex < b.weekIndex ? -1 : 1)).map(g => g.value)

  const teamAbbr = getTeamAbbr(player.teamId, teams)
  const joinedWeekStats = weekStats.join("\n")
  return `
  # ${getTeamEmoji(teamAbbr, logos)} ${player.position} ${player.firstName} ${player.lastName}
## ${getDevTraitName(player.devTrait, player.yearsPro)} **${player.playerBestOvr} OVR**
## Stats
${joinedWeekStats}
`
}
export type StatItem = {
  value: number;
  name: string;
}
export type RatioItem = {
  top: number,
  bottom: number,
}

export type SeasonAggregation = {
  [seasonIndex: number]: {
    // Passing stats
    passYds?: StatItem,
    passTDs?: StatItem,
    passInts?: StatItem,
    passPercent?: RatioItem,
    passSacks?: StatItem,

    // Rushing stats
    rushYds?: StatItem,
    rushTDs?: StatItem,
    rushAtt?: StatItem,
    rushFum?: StatItem,

    // Receiving stats
    recYds?: StatItem,
    recTDs?: StatItem,
    recCatches?: StatItem,
    recDrops?: StatItem,

    // Defensive stats
    defTotalTackles?: StatItem,
    defSacks?: StatItem,
    defInts?: StatItem,
    defFumRec?: StatItem,
    defForcedFum?: StatItem,
    defTDs?: StatItem,

    // Kicking stats
    fGMade?: StatItem,
    fGAtt?: StatItem,
    xPMade?: StatItem,
    xPAtt?: StatItem,
    kickPts?: StatItem,

    // Punting stats
    puntYds?: StatItem,
    puntAtt?: StatItem,
    puntsIn20?: StatItem,
    puntNetYds?: StatItem,
    puntsBlocked?: StatItem,
    puntTBs?: StatItem,
  }
}

function formatSeasonAggregation(agg: SeasonAggregation): string {
  let result = "";
  const seasonIndices = Object.keys(agg).map(Number).sort((a, b) => a - b);

  for (const seasonIndex of seasonIndices) {
    const seasonStats = agg[seasonIndex];
    const statItems: string[] = [];
    result += `**${seasonIndex + MADDEN_SEASON}**: `;

    if (seasonStats.passPercent) {
      statItems.push(`${seasonStats.passPercent.top}/${seasonStats.passPercent.bottom}`);
    }
    if (seasonStats.passYds) statItems.push(`${seasonStats.passYds.value} ${seasonStats.passYds.name}`);
    if (seasonStats.passTDs) statItems.push(`${seasonStats.passTDs.value} ${seasonStats.passTDs.name}`);
    if (seasonStats.passInts) statItems.push(`${seasonStats.passInts.value} ${seasonStats.passInts.name}`);
    if (seasonStats.passSacks) statItems.push(`${seasonStats.passSacks.value} ${seasonStats.passSacks.name}`);

    if (seasonStats.rushAtt) statItems.push(`${seasonStats.rushAtt.value} ${seasonStats.rushAtt.name}`);
    if (seasonStats.rushYds) statItems.push(`${seasonStats.rushYds.value} ${seasonStats.rushYds.name}`);
    if (seasonStats.rushTDs) statItems.push(`${seasonStats.rushTDs.value} ${seasonStats.rushTDs.name}`);
    if (seasonStats.rushFum && seasonStats.rushFum.value > 0) statItems.push(`${seasonStats.rushFum.value} ${seasonStats.rushFum.name}`);

    if (seasonStats.recCatches) statItems.push(`${seasonStats.recCatches.value} ${seasonStats.recCatches.name}`);
    if (seasonStats.recYds) statItems.push(`${seasonStats.recYds.value} ${seasonStats.recYds.name}`);
    if (seasonStats.recTDs) statItems.push(`${seasonStats.recTDs.value} ${seasonStats.recTDs.name}`);
    if (seasonStats.recDrops && seasonStats.recDrops.value > 0) statItems.push(`${seasonStats.recDrops.value} ${seasonStats.recDrops.name}`);

    if (seasonStats.defTotalTackles && seasonStats.defTotalTackles.value > 0) statItems.push(`${seasonStats.defTotalTackles.value} ${seasonStats.defTotalTackles.name}`);
    if (seasonStats.defSacks && seasonStats.defSacks.value > 0) statItems.push(`${seasonStats.defSacks.value} ${seasonStats.defSacks.name}`);
    if (seasonStats.defInts && seasonStats.defInts.value > 0) statItems.push(`${seasonStats.defInts.value} ${seasonStats.defInts.name}`);
    if (seasonStats.defFumRec && seasonStats.defFumRec.value > 0) statItems.push(`${seasonStats.defFumRec.value} ${seasonStats.defFumRec.name}`);
    if (seasonStats.defForcedFum && seasonStats.defForcedFum.value > 0) statItems.push(`${seasonStats.defForcedFum.value} ${seasonStats.defForcedFum.name}`);
    if (seasonStats.defTDs && seasonStats.defTDs.value > 0) statItems.push(`${seasonStats.defTDs.value} ${seasonStats.defTDs.name}`);

    if (seasonStats.fGMade && seasonStats.fGAtt) {
      statItems.push(`${seasonStats.fGMade.value}/${seasonStats.fGAtt.value} FG`);
    }
    if (seasonStats.xPMade && seasonStats.xPAtt) {
      statItems.push(`${seasonStats.xPMade.value}/${seasonStats.xPAtt.value} XP`);
    }
    if (seasonStats.kickPts) statItems.push(`${seasonStats.kickPts.value} ${seasonStats.kickPts.name}`);

    if (seasonStats.puntYds) statItems.push(`${seasonStats.puntYds.value} ${seasonStats.puntYds.name}`);
    if (seasonStats.puntAtt) statItems.push(`${seasonStats.puntAtt.value} ${seasonStats.puntAtt.name}`);
    if (seasonStats.puntsIn20) statItems.push(`${seasonStats.puntsIn20.value} ${seasonStats.puntsIn20.name}`);
    if (seasonStats.puntNetYds) statItems.push(`${seasonStats.puntNetYds.value} ${seasonStats.puntNetYds.name}`);
    if (seasonStats.puntsBlocked) statItems.push(`${seasonStats.puntsBlocked.value} ${seasonStats.puntsBlocked.name}`);
    if (seasonStats.puntTBs) statItems.push(`${seasonStats.puntTBs.value} ${seasonStats.puntTBs.name}`);

    result += statItems.join(", ");
    result += "\n";
  }

  return result.trim();
}


function aggregateSeason(stats: PlayerStats): SeasonAggregation {
  const seasonAggregation: SeasonAggregation = {};

  // Process passing stats
  if (stats[PlayerStatType.PASSING]) {
    for (const passStat of stats[PlayerStatType.PASSING]) {
      if (!seasonAggregation[passStat.seasonIndex]) {
        seasonAggregation[passStat.seasonIndex] = {}
      }

      const season = seasonAggregation[passStat.seasonIndex];

      // Initialize or add to existing values
      if (!season.passYds) {
        season.passYds = { value: passStat.passYds, name: 'PASS YDS' };
      } else {
        season.passYds.value += passStat.passYds;
      }

      if (!season.passTDs) {
        season.passTDs = { value: passStat.passTDs, name: 'TD' };
      } else {
        season.passTDs.value += passStat.passTDs;
      }

      if (!season.passInts) {
        season.passInts = { value: passStat.passInts, name: 'INT' };
      } else {
        season.passInts.value += passStat.passInts;
      }


      if (!season.passPercent) {
        season.passPercent = { top: passStat.passComp, bottom: passStat.passAtt }
      } else {
        season.passPercent.top += passStat.passComp
        season.passPercent.bottom += passStat.passAtt
      }

      if (!season.passSacks) {
        season.passSacks = { value: passStat.passSacks, name: 'SCKS' };
      } else {
        season.passSacks.value += passStat.passSacks;
      }
    }
  }

  // Process rushing stats
  if (stats[PlayerStatType.RUSHING]) {
    for (const rushStat of stats[PlayerStatType.RUSHING]) {
      if (!seasonAggregation[rushStat.seasonIndex]) {
        seasonAggregation[rushStat.seasonIndex] = {
        }
      }

      const season = seasonAggregation[rushStat.seasonIndex];

      if (!season.rushYds) {
        season.rushYds = { value: rushStat.rushYds, name: 'RUSH YDS' };
      } else {
        season.rushYds.value += rushStat.rushYds;
      }

      if (!season.rushTDs) {
        season.rushTDs = { value: rushStat.rushTDs, name: 'TD' };
      } else {
        season.rushTDs.value += rushStat.rushTDs;
      }

      if (!season.rushAtt) {
        season.rushAtt = { value: rushStat.rushAtt, name: 'ATT' };
      } else {
        season.rushAtt.value += rushStat.rushAtt;
      }

      if (!season.rushFum) {
        season.rushFum = { value: rushStat.rushFum, name: 'FUM' };
      } else {
        season.rushFum.value += rushStat.rushFum;
      }
    }
  }

  // Process receiving stats
  if (stats[PlayerStatType.RECEIVING]) {
    for (const recStat of stats[PlayerStatType.RECEIVING]) {
      if (!seasonAggregation[recStat.seasonIndex]) {
        seasonAggregation[recStat.seasonIndex] = {}
      }

      const season = seasonAggregation[recStat.seasonIndex];

      if (!season.recYds) {
        season.recYds = { value: recStat.recYds, name: 'REC YDS' };
      } else {
        season.recYds.value += recStat.recYds;
      }

      if (!season.recTDs) {
        season.recTDs = { value: recStat.recTDs, name: 'TD' };
      } else {
        season.recTDs.value += recStat.recTDs;
      }

      if (!season.recCatches) {
        season.recCatches = { value: recStat.recCatches, name: 'REC' };
      } else {
        season.recCatches.value += recStat.recCatches;
      }

      if (!season.recDrops) {
        season.recDrops = { value: recStat.recDrops, name: 'DROPS' };
      } else {
        season.recDrops.value += recStat.recDrops;
      }
    }
  }

  // Process defensive stats
  if (stats[PlayerStatType.DEFENSE]) {
    for (const defStat of stats[PlayerStatType.DEFENSE]) {
      if (!seasonAggregation[defStat.seasonIndex]) {
        seasonAggregation[defStat.seasonIndex] = {
        };
      }

      const season = seasonAggregation[defStat.seasonIndex];

      if (!season.defTotalTackles) {
        season.defTotalTackles = { value: defStat.defTotalTackles, name: 'TCKLS' };
      } else {
        season.defTotalTackles.value += defStat.defTotalTackles;
      }

      if (!season.defSacks) {
        season.defSacks = { value: defStat.defSacks, name: 'SCKS' };
      } else {
        season.defSacks.value += defStat.defSacks;
      }

      if (!season.defInts) {
        season.defInts = { value: defStat.defInts, name: 'INT' };
      } else {
        season.defInts.value += defStat.defInts;
      }

      if (!season.defFumRec) {
        season.defFumRec = { value: defStat.defFumRec, name: 'FR' };
      } else {
        season.defFumRec.value += defStat.defFumRec;
      }

      if (!season.defForcedFum) {
        season.defForcedFum = { value: defStat.defForcedFum, name: 'FF' };
      } else {
        season.defForcedFum.value += defStat.defForcedFum;
      }

      if (!season.defTDs) {
        season.defTDs = { value: defStat.defTDs, name: 'TD' };
      } else {
        season.defTDs.value += defStat.defTDs;
      }
    }
  }

  // Process kicking stats
  if (stats[PlayerStatType.KICKING]) {
    for (const kickStat of stats[PlayerStatType.KICKING]) {
      if (!seasonAggregation[kickStat.seasonIndex]) {
        seasonAggregation[kickStat.seasonIndex] = {}
      }

      const season = seasonAggregation[kickStat.seasonIndex];

      if (!season.fGMade) {
        season.fGMade = { value: kickStat.fGMade, name: 'FGS' };
      } else {
        season.fGMade.value += kickStat.fGMade;
      }

      if (!season.fGAtt) {
        season.fGAtt = { value: kickStat.fGAtt, name: 'FG ATT' };
      } else {
        season.fGAtt.value += kickStat.fGAtt;
      }

      if (!season.xPMade) {
        season.xPMade = { value: kickStat.xPMade, name: 'XP' };
      } else {
        season.xPMade.value += kickStat.xPMade;
      }

      if (!season.xPAtt) {
        season.xPAtt = { value: kickStat.xPAtt, name: 'XP ATT' };
      } else {
        season.xPAtt.value += kickStat.xPAtt;
      }

      if (!season.kickPts) {
        season.kickPts = { value: kickStat.kickPts, name: 'PTS' };
      } else {
        season.kickPts.value += kickStat.kickPts;
      }
    }
  }

  // Process punting stats
  if (stats[PlayerStatType.PUNTING]) {
    for (const puntStat of stats[PlayerStatType.PUNTING]) {
      if (!seasonAggregation[puntStat.seasonIndex]) {
        seasonAggregation[puntStat.seasonIndex] = {}
      }

      const season = seasonAggregation[puntStat.seasonIndex];

      if (!season.puntYds) {
        season.puntYds = { value: puntStat.puntYds, name: 'PUNT YDS' };
      } else {
        season.puntYds.value += puntStat.puntYds;
      }

      if (!season.puntAtt) {
        season.puntAtt = { value: puntStat.puntAtt, name: 'ATT' };
      } else {
        season.puntAtt.value += puntStat.puntAtt;
      }

      if (!season.puntsIn20) {
        season.puntsIn20 = { value: puntStat.puntsIn20, name: 'INS 20' };
      } else {
        season.puntsIn20.value += puntStat.puntsIn20;
      }

      if (!season.puntNetYds) {
        season.puntNetYds = { value: puntStat.puntNetYds, name: 'PUNT YDS NET' };
      } else {
        season.puntNetYds.value += puntStat.puntNetYds;
      }

      if (!season.puntsBlocked) {
        season.puntsBlocked = { value: puntStat.puntsBlocked, name: 'BLOCK' };
      } else {
        season.puntsBlocked.value += puntStat.puntsBlocked;
      }

      if (!season.puntTBs) {
        season.puntTBs = { value: puntStat.puntTBs, name: 'TBS' };
      } else {
        season.puntTBs.value += puntStat.puntTBs;
      }
    }
  }

  return seasonAggregation;
}

function formatSeasonStats(player: Player, stats: PlayerStats, teams: TeamList, logos: LeagueLogos) {
  const teamAbbr = getTeamAbbr(player.teamId, teams)
  const agg = aggregateSeason(stats)
  const formattedAgg = formatSeasonAggregation(agg)

  return `
  # ${getTeamEmoji(teamAbbr, logos)} ${player.position} ${player.firstName} ${player.lastName}
## ${getDevTraitName(player.devTrait, player.yearsPro)} **${player.playerBestOvr} OVR**
## Stats
${formattedAgg}
`
}

function formatPlayerList(players: Player[], teams: TeamList, logos: LeagueLogos) {
  let message = "# Player Results:\n";

  for (const player of players) {
    const teamName = getTeamAbbr(player.teamId, teams)
    const fullName = `${player.firstName} ${player.lastName}`;
    const heightFeet = Math.floor(player.height / 12);
    const heightInches = player.height % 12;
    const heightFormatted = `${heightFeet}'${heightInches}"`;
    const teamEmoji = getTeamEmoji(teamName, logos) === SnallabotTeamEmojis.NFL ? `**${teamName.toUpperCase()}**` : getTeamEmoji(teamName, logos)
    const experience = getSeasonFormatting(player.yearsPro)
    const devTraitEmoji = getDevTraitName(player.devTrait, player.yearsPro)
    message += `## ${teamEmoji} ${player.position} ${fullName} - ${player.playerBestOvr} OVR\n`;
    message += `${devTraitEmoji} | ${player.age} yrs | ${experience} | ${heightFormatted} | ${player.weight} lbs\n\n`;
  }

  return message;

}

type PlayerFound = { teamAbbr: string, rosterId: string, firstName: string, lastName: string, teamId: string, position: string }

async function searchPlayerForRosterId(query: string, leagueId: string): Promise<PlayerFound[]> {
  const [playersToSearch, teamsIndex] = await Promise.all([MaddenDB.getLatestPlayers(leagueId), teamSearchView.createView(leagueId)])
  if (teamsIndex) {
    const players = Object.fromEntries(playersToSearch.map(roster => {
      const abbr = roster.teamId === "0" ? "FA" : teamsIndex?.[roster.teamId]?.abbrName
      return [roster.rosterId, { teamAbbr: abbr, ...roster }]
    }))
    const results = fuzzysort.go(query, Object.values(players), {
      keys: ["firstName", "lastName", "position", "teamAbbr"], threshold: 0.4, limit: 25
    })
    return results.map(r => r.obj)
  }
  return []
}
const positions = POSITIONS.concat(POSITION_GROUP).map(p => ({ teamDisplayName: "", teamId: -1, teamNickName: "", position: p, rookie: "", retired: "" }))
const rookies = [{
  teamDisplayName: "", teamId: -1, teamNickName: "", position: "", rookie: "Rookies", retired: ""
}]
const rookiePositions = positions.map(p => ({ ...p, rookie: "Rookies" }))
const retired = [{
  teamDisplayName: "", teamId: -1, teamNickName: "", position: "", rookie: "", retired: "Retired"
}]
const retiredPositions = positions.map(p => ({ ...p, retired: "Retired" }))
type PlayerListSearchQuery = { teamDisplayName: string, teamId: number, teamNickName: string, position: string, rookie: string, retired: string }


// to boost top level queries like team names, position groups, rookies, retired
function isTopLevel(q: PlayerListSearchQuery) {
  if (q.teamDisplayName && !q.position && !q.rookie && !q.retired) {
    return true
  }
  if (!q.teamDisplayName && q.position && !q.rookie && !q.retired) {
    return true
  }
  if (!q.teamDisplayName && !q.position && q.rookie && !q.retired) {
    return true
  }
  if (!q.teamDisplayName && !q.position && !q.rookie && q.retired) {
    return true
  }
  return false
}

function formatQuery(q: PlayerListSearchQuery) {
  const retired = q.retired ? [q.retired] : []
  const teamName = q.teamDisplayName ? [q.teamDisplayName] : []
  const position = q.position ? [q.position] : []
  const rookie = q.rookie ? [q.rookie] : []
  return [retired, teamName, rookie, position].join(" ")
}

async function searchPlayerListForQuery(textQuery: string, leagueId: string): Promise<PlayerListSearchQuery[]> {
  const teamIndex = await teamSearchView.createView(leagueId)
  if (teamIndex) {
    const fullTeams = Object.values(teamIndex).map(t => ({ teamDisplayName: t.displayName, teamId: t.id, teamNickName: t.nickName, position: "", rookie: "", retired: "" })).concat([{ teamDisplayName: "Free Agents", teamId: 0, teamNickName: "FA", position: "", rookie: "", retired: "" }])
    const teamPositions = fullTeams.flatMap(t => positions.map(p => ({ teamDisplayName: t.teamDisplayName, teamId: t.teamId, teamNickName: t.teamNickName, position: p.position, rookie: "", retired: "" })))
    const teamRookies = fullTeams.map(t => ({ ...t, rookie: "Rookies" }))
    const teamRetired = fullTeams.map(t => ({ ...t, retired: "Retired" }))
    const allQueries: PlayerListSearchQuery[] = fullTeams.concat(positions).concat(rookies).concat(rookiePositions).concat(teamPositions).concat(teamRookies).concat(retired).concat(retiredPositions).concat(teamRetired)
    const results = fuzzysort.go(textQuery, allQueries, {
      keys: ["teamDisplayName", "teamNickName", "position", "rookie", "retired"],
      scoreFn: r => r.score * (isTopLevel(r.obj) ? 2 : 1),
      threshold: 0.4,
      limit: 25
    })
    return results.map(r => r.obj)
  }
  return []
}

async function retirePlayers(leagueId: string, token: string, client: DiscordClient) {
  try {

    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Retiring Players:
- ${SnallabotCommandReactions.LOADING} Updating Current players
- ${SnallabotCommandReactions.WAITING} Finding Retired Players
- ${SnallabotCommandReactions.WAITING} Finding New Retired Players`
        }
      ]
    })
    const league = Number(leagueId)
    const eaClient = await storedTokenClient(league)
    const exporter = await exporterForLeague(league, ExportContext.MANUAL)
    await exporter.exportCurrentWeek()
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Retiring Players:
- ${SnallabotCommandReactions.FINISHED} Updating Current players
- ${SnallabotCommandReactions.LOADING} Finding Retired Players
- ${SnallabotCommandReactions.WAITING} Finding New Retired Players`
        }
      ]
    })
    const leagueInfo = await eaClient.getLeagueInfo(league)
    const teams = leagueInfo.teamIdInfoList
    const playersInLeague = new Set<string>()
    for (let idx = 0; idx < teams.length; idx++) {
      const team = teams[idx];
      await client.editOriginalInteraction(token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `Retiring Players:
- ${SnallabotCommandReactions.FINISHED} Updating Current players
- ${SnallabotCommandReactions.LOADING} Finding Retired Players - Checking ${team.displayName}
- ${SnallabotCommandReactions.WAITING} Finding New Retired Players`
          }
        ]
      })
      const roster = await eaClient.getTeamRoster(league, team.teamId, idx);
      roster.rosterInfoList.forEach(player => playersInLeague.add(createPlayerKey(player)))
    }
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Retiring Players:
- ${SnallabotCommandReactions.FINISHED} Updating Current players
- ${SnallabotCommandReactions.LOADING} Finding Retired Players - Checking Free Agents
- ${SnallabotCommandReactions.WAITING} Finding New Retired Players`
        }
      ]
    })
    const freeAgents = await eaClient.getFreeAgents(league)
    freeAgents.rosterInfoList.forEach(player => playersInLeague.add(createPlayerKey(player)));
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Retiring Players:
- ${SnallabotCommandReactions.FINISHED} Updating Current players
- ${SnallabotCommandReactions.FINISHED} Finding Retired Players
- ${SnallabotCommandReactions.LOADING} Finding New Retired Players`
        }
      ]
    })
    const latestPlayers = await MaddenDB.getLatestPlayers(leagueId)
    const alreadyRetiredPlayerEvents = await EventDB.queryEvents<RetiredPlayersEvent>(leagueId, EventTypes.RETIRED_PLAYERS, new Date(0), {}, 1000000)
    const alreadyRetiredPlayers = new Set(alreadyRetiredPlayerEvents.flatMap(e => e.retiredPlayers).map(e => createPlayerKey(e)))
    const retiredPlayers = latestPlayers.filter(player => {
      const playerKey = createPlayerKey(player)
      return !playersInLeague.has(playerKey) && !alreadyRetiredPlayers.has(playerKey)
    }).sort((a, b) => b.playerBestOvr - a.playerBestOvr)
    if (retiredPlayers.length > 0) {
      await client.editOriginalInteraction(token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `Retiring Players:
- ${SnallabotCommandReactions.FINISHED} Updating Current players
- ${SnallabotCommandReactions.FINISHED} Finding Retired Players
- ${SnallabotCommandReactions.FINISHED} Finding New Retired Players\n
Snallabot found ${retiredPlayers.length} newly retired players. :saluting_face: hope they had a great career! use /player list to view them`
          }
        ]
      })
      const newRetiredPlayers = retiredPlayers.map(p => ({ presentationId: p.presentationId, birthYear: p.birthYear, birthMonth: p.birthMonth, birthDay: p.birthDay, rosterId: p.rosterId }))
      await EventDB.appendEvents<RetiredPlayersEvent>([{ key: leagueId, event_type: EventTypes.RETIRED_PLAYERS, retiredPlayers: newRetiredPlayers }], EventDelivery.EVENT_SOURCE)
    } else {
      await client.editOriginalInteraction(token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `Retiring Players:
- ${SnallabotCommandReactions.FINISHED} Updating Current players
- ${SnallabotCommandReactions.FINISHED} Finding Retired Players
- ${SnallabotCommandReactions.FINISHED} Finding New Retired Players\n
Snallabot did not find anymore retired players...`
          }
        ]
      })
    }
  } catch (e) {
    await
      client.editOriginalInteraction(token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `Could not finish retiring players, ${e}`
          }
        ]
      })
    console.error(e)
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id, token } = command
    if (!command.data.options) {
      throw new Error("logger command not defined properly")
    }
    const options = command.data.options
    const playerCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = playerCommand.name
    if (subCommand === "get") {
      if (!playerCommand.options || !playerCommand.options[0]) {
        throw new Error("player get misconfigured")
      }
      const playerSearch = (playerCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value
      showPlayerCard(playerSearch, client, token, guild_id)
      return deferMessage()

    } else if (subCommand === "list") {
      if (!playerCommand.options || !playerCommand.options[0]) {
        throw new Error("player get misconfigured")
      }
      const playerSearch = (playerCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value
      showPlayerList(playerSearch, client, token, guild_id)
      return deferMessage()
    } else if (subCommand === "retire") {
      const discordLeague = await discordLeagueView.createView(guild_id)
      const leagueId = discordLeague?.leagueId
      if (!leagueId) {
        throw new NoConnectedLeagueError(guild_id)
      }
      retirePlayers(leagueId, token, client)
      return deferMessage()
    }

    else {
      throw new Error(`Missing player command ${subCommand}`)
    }

  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "player",
      description: "retrieves the players in your league",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "get",
          description: "gets the player and shows their card",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "player",
              description:
                "search for the player",
              required: true,
              autocomplete: true
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "list",
          description: "list the players matching search",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "players",
              description:
                "players to search for",
              required: true,
              autocomplete: true
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "retire",
          description: "Finds and retires all players who are no longer in the league",
          options: [],
        }
      ],
      type: 1,
    }
  },
  async choices(command: Autocomplete) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("player command not defined properly")
    }
    const options = command.data.options
    const playerCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = playerCommand.name
    if (subCommand === "get") {
      const view = await discordLeagueView.createView(guild_id)
      const leagueId = view?.leagueId
      if (leagueId && (playerCommand?.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.focused && playerCommand?.options?.[0]?.value) {
        const playerSearchPhrase = playerCommand.options[0].value as string
        const results = await searchPlayerForRosterId(playerSearchPhrase, leagueId)
        return results.map(r => ({ name: `${r.teamAbbr} ${r.position.toUpperCase()} ${r.firstName} ${r.lastName}`, value: `${r.rosterId}` }))
      }
    } else if (subCommand === "list") {
      const view = await discordLeagueView.createView(guild_id)
      const leagueId = view?.leagueId
      if (leagueId && (playerCommand?.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.focused && playerCommand?.options?.[0]?.value) {
        const playerListSearchPhrase = playerCommand.options[0].value as string
        const results = await searchPlayerListForQuery(playerListSearchPhrase, leagueId)
        return results.map(r => {
          const { teamId, rookie, position, retired } = r
          return { name: formatQuery(r), value: JSON.stringify({ teamId: teamId, rookie: !!rookie, position: position, retired: !!retired }) }
        })
      }
    }

    return []
  },
  async handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient) {
    const customId = interaction.custom_id
    if (customId === "player_card") {
      const data = interaction.data as APIMessageStringSelectInteractionData
      if (data.values.length !== 1) {
        throw new Error("Somehow did not receive just one selection from player card " + data.values)
      }
      const { r: rosterId, s: selected, q: pagination } = JSON.parse(data.values[0]) as Selection
      try {
        if (selected === PlayerSelection.PLAYER_OVERVIEW) {
          showPlayerCard(`${rosterId}`, client, interaction.token, interaction.guild_id, pagination)
        } else if (selected === PlayerSelection.PLAYER_FULL_RATINGS) {
          showPlayerFullRatings(rosterId, client, interaction.token, interaction.guild_id, pagination)
        } else if (selected === PlayerSelection.PLAYER_WEEKLY_STATS) {
          showPlayerWeeklyStats(rosterId, client, interaction.token, interaction.guild_id, pagination)
        } else if (selected === PlayerSelection.PLAYER_SEASON_STATS) {
          showPlayerYearlyStats(rosterId, client, interaction.token, interaction.guild_id, pagination)
        } else {
          throw new Error(`Invalid Player Selection ${selected}`)
        }
      } catch (e) {
        await client.editOriginalInteraction(interaction.token, {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: `Could not show player card Error: ${e}`
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
                  type: ComponentType.StringSelect,
                  custom_id: "player_card",
                  placeholder: formatPlaceholder(PlayerSelection.PLAYER_OVERVIEW),
                  options: generatePlayerOptions(rosterId)
                }
              ]
            }
          ]
        })
      }
    } else {
      try {
        const { q: query, s: next, b: prev } = JSON.parse(customId) as PlayerPagination
        showPlayerList(JSON.stringify(fromShortQuery(query)), client, interaction.token, interaction.guild_id, next, prev)
      } catch (e) {
        await client.editOriginalInteraction(interaction.token, {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: `Could not list players Error: ${e}`
            }
          ]
        })
      }
    }
    return {
      type: InteractionResponseType.DeferredMessageUpdate,
    }
  }
}
