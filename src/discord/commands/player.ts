import { ParameterizedContext } from "koa"
import { CommandHandler, Command, AutocompleteHandler, Autocomplete, MessageComponentHandler, MessageComponentInteraction } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, deferMessage } from "../discord_utils"
import { APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, APIMessageStringSelectInteractionData, ApplicationCommandOptionType, ButtonStyle, ComponentType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { playerSearchIndex, discordLeagueView, teamSearchView } from "../../db/view"
import fuzzysort from "fuzzysort"
import MaddenDB, { PlayerListQuery, PlayerStatType, PlayerStats } from "../../db/madden_db"
import { CoverBallTrait, DevTrait, LBStyleTrait, MADDEN_SEASON, MaddenGame, POSITIONS, POSITION_GROUP, PenaltyTrait, PlayBallTrait, Player, QBStyleTrait, SensePressureTrait, YesNoTrait } from "../../export/madden_league_types"

enum PlayerSelection {
  PLAYER_OVERVIEW = "player_overview",
  PLAYER_FULL_RATINGS = "player_full_ratings",
  PLAYER_WEEKLY_STATS = "player_weekly_stats",
  PLAYER_SEASON_STATS = "player_season_stats"
}

type Selection = { rosterId: number, selected: PlayerSelection }

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

function generatePlayerOptions(rosterId: number) {
  return [
    {
      label: "Overview",
      value: { rosterId: rosterId, selected: PlayerSelection.PLAYER_OVERVIEW },
    },
    {
      label: "Full Ratings",
      value: { rosterId: rosterId, selected: PlayerSelection.PLAYER_FULL_RATINGS }
    },
    {
      label: "Weekly Stats",
      value: { rosterId: rosterId, selected: PlayerSelection.PLAYER_WEEKLY_STATS }
    },
    {
      label: "Season Stats",
      value: { rosterId: rosterId, selected: PlayerSelection.PLAYER_SEASON_STATS }
    }
  ].map(option => ({ ...option, value: JSON.stringify(option.value) }))
}

async function showPlayerCard(playerSearch: string, client: DiscordClient, token: string, guild_id: string) {
  try {
    const discordLeague = await discordLeagueView.createView(guild_id)
    const leagueId = discordLeague?.leagueId
    if (!leagueId) {
      throw new Error(`No League connected to snallabot`)
    }
    let searchRosterId = Number(playerSearch)
    if (isNaN(searchRosterId)) {
      // get top search result
      const results = await searchPlayerForRosterId(playerSearch, leagueId)
      if (results.length === 0) {
        throw new Error(`No player results for ${playerSearch} in ${leagueId}`)
      }
      searchRosterId = results[0].rosterId
    }
    const player = await MaddenDB.getPlayer(leagueId, `${searchRosterId}`)
    const teamView = await teamSearchView.createView(leagueId)
    if (!teamView) {
      throw new Error("Missing teams?? Maybe try the command again")
    }
    const teamsDisplayNames = Object.fromEntries(Object.entries(teamView).map(teamEntry => {
      const [teamId, t] = teamEntry
      return [teamId, t.abbrName]
    }))
    // 0 team id means the player is a free agent
    teamsDisplayNames["0"] = "FA"

    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: formatPlayerCard(player, teamsDisplayNames)
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
              options: generatePlayerOptions(searchRosterId)
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
          content: `Could not show player card Error: ${e}`
        }
      ]
    })
  }
}

async function showPlayerFullRatings(rosterId: number, client: DiscordClient, token: string, guild_id: string) {
  const discordLeague = await discordLeagueView.createView(guild_id)
  const leagueId = discordLeague?.leagueId
  if (!leagueId) {
    throw new Error(`No League connected to snallabot`)
  }
  const player = await MaddenDB.getPlayer(leagueId, `${rosterId}`)
  const teamView = await teamSearchView.createView(leagueId)
  if (!teamView) {
    throw new Error("Missing teams?? Maybe try the command again")
  }
  const teamsDisplayNames = Object.fromEntries(Object.entries(teamView).map(teamEntry => {
    const [teamId, t] = teamEntry
    return [teamId, t.abbrName]
  }))
  // 0 team id means the player is a free agent
  teamsDisplayNames["0"] = "FA"
  await client.editOriginalInteraction(token, {
    flags: 32768,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: formatFullRatings(player, teamsDisplayNames)
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
            options: generatePlayerOptions(rosterId)
          }
        ]
      }
    ]
  })
}

async function showPlayerWeeklyStats(rosterId: number, client: DiscordClient, token: string, guild_id: string) {
  const discordLeague = await discordLeagueView.createView(guild_id)
  const leagueId = discordLeague?.leagueId
  if (!leagueId) {
    throw new Error(`No League connected to snallabot`)
  }
  const player = await MaddenDB.getPlayer(leagueId, `${rosterId}`)
  const teamView = await teamSearchView.createView(leagueId)
  if (!teamView) {
    throw new Error("Missing teams?? Maybe try the command again")
  }
  const teamsDisplayNames = Object.fromEntries(Object.entries(teamView).map(teamEntry => {
    const [teamId, t] = teamEntry
    return [teamId, t.abbrName]
  }))
  // 0 team id means the player is a free agent
  teamsDisplayNames["0"] = "FA"
  const playerStats = await MaddenDB.getPlayerStats(leagueId, player)
  const statGames = new Map<String, { id: number, week: number, season: number }>()
  Object.values(playerStats).flat().forEach(p => statGames.set(`${p.scheduleId}|${p.weekIndex}|${p.seasonIndex}`, { id: p.scheduleId, week: p.weekIndex + 1, season: p.seasonIndex }))
  const games = await MaddenDB.getGamesForSchedule(leagueId, Array.from(statGames.values()))
  await client.editOriginalInteraction(token, {
    flags: 32768,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: formatWeeklyStats(player, teamsDisplayNames, playerStats, games)
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
            options: generatePlayerOptions(rosterId)
          }
        ]
      }
    ]
  })
}

async function showPlayerYearlyStats(rosterId: number, client: DiscordClient, token: string, guild_id: string) {
  const discordLeague = await discordLeagueView.createView(guild_id)
  const leagueId = discordLeague?.leagueId
  if (!leagueId) {
    throw new Error(`No League connected to snallabot`)
  }
  const player = await MaddenDB.getPlayer(leagueId, `${rosterId}`)
  const playerStats = await MaddenDB.getPlayerStats(leagueId, player)
  const teamView = await teamSearchView.createView(leagueId)
  if (!teamView) {
    throw new Error("Missing teams?? Maybe try the command again")
  }

  const teamsDisplayNames = Object.fromEntries(Object.entries(teamView).map(teamEntry => {
    const [teamId, t] = teamEntry
    return [teamId, t.abbrName]
  }))
  // 0 team id means the player is a free agent
  teamsDisplayNames["0"] = "FA"
  await client.editOriginalInteraction(token, {
    flags: 32768,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: formatSeasonStats(player, playerStats, teamsDisplayNames)
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
            options: generatePlayerOptions(rosterId)
          }
        ]
      }
    ]
  })
}

type PlayerPagination = { q: PlayerListQuery, l: number, league: string }

async function showPlayerList(playerSearch: string, client: DiscordClient, token: string, guild_id: string, lastPlayer?: Player) {
  try {
    const discordLeague = await discordLeagueView.createView(guild_id)
    const leagueId = discordLeague?.leagueId
    if (!leagueId) {
      throw new Error(`No League connected to snallabot`)
    }
    let query: PlayerListQuery;
    try {
      query = JSON.parse(playerSearch) as PlayerListQuery
    } catch (e) {
      const results = await searchPlayerListForQuery(playerSearch, leagueId)
      if (results.length === 0) {
        throw new Error(`No listable results for ${playerSearch} in ${leagueId}`)
      }
      query = results[0]
    }
    const players = await MaddenDB.getPlayers(leagueId, query, lastPlayer)
    const teamView = await teamSearchView.createView(leagueId)
    if (!teamView) {
      throw new Error("Missing teams?? Maybe try the command again")
    }
    const teamsDisplayNames = Object.fromEntries(Object.entries(teamView).map(teamEntry => {
      const [teamId, t] = teamEntry
      return [teamId, t.abbrName]
    }))
    // 0 team id means the player is a free agent
    teamsDisplayNames["0"] = "FA"
    const message = players.length === 0 ? `# No results` : formatPlayerList(players, teamsDisplayNames)
    const backDisabled = lastPlayer ? false : true
    const nextDisabled = players.length === 0 ? true : false
    const nextLastPlayer = players.length === 0 ? lastPlayer?.rosterId : players[players.length - 1].rosterId
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
              custom_id: `${JSON.stringify({ q: query, l: lastPlayer?.rosterId, league: leagueId })}`
            },
            {
              type: ComponentType.Button,
              style: ButtonStyle.Secondary,
              label: "Next",
              custom_id: `${JSON.stringify({ q: query, l: nextLastPlayer, league: leagueId })}`,
              disabled: nextDisabled
            }
          ]
        },
        {
          type: ComponentType.Separator,
          divider: true,
          spacing: SeparatorSpacingSize.Large
        },
        // {
        //   type: ComponentType.ActionRow,
        //   components: [
        //     {
        //       type: ComponentType.StringSelect,
        //       custom_id: "player_card",
        //       placeholder: formatPlaceholder(PlayerSelection.PLAYER_OVERVIEW),
        //       options: generatePlayerOptions(searchRosterId)
        //     }
        //   ]
        // }
      ]
    })
  } catch (e) {
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Could not list players  Error: ${e}`
        }
      ]
    })
  }
}

function getTopAttributesByPosition(player: Player): Array<{ name: string, value: number }> {
  const attributes: Array<{ name: string, value: number }> = []
  attributes.push(
    { name: "Speed", value: player.speedRating },
    { name: "Acceleration", value: player.accelRating },
    { name: "Agility", value: player.agilityRating },
    { name: "Awareness", value: player.awareRating },
    { name: "Injury", value: player.injuryRating }
  )

  switch (player.position) {
    case "QB":
      attributes.push(
        { name: "Throw Power", value: player.throwPowerRating },
        { name: "Deep Accuracy", value: player.throwAccDeepRating },
        { name: "Medium Accuracy", value: player.throwAccMidRating },
        { name: "Short Accuracy", value: player.throwAccShortRating },
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
      )
      break
    case "LE":
    case "RE":
      attributes.push(
        { name: "Power Moves", value: player.powerMovesRating },
        { name: "Finesse Moves", value: player.finesseMovesRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Play Recognition", value: player.playRecRating },
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
        { name: "Play Recognition", value: player.playRecRating },
      )
      break
    case "LOLB":
    case "ROLB":
      attributes.push(
        { name: "Hit Power", value: player.hitPowerRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Power Moves", value: player.powerMovesRating },
        { name: "Finesse Moves", value: player.finesseMovesRating },
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Play Recognition", value: player.playRecRating },
      )
      break
    case "MLB":
      attributes.push(
        { name: "Tackle", value: player.tackleRating },
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Hit Power", value: player.hitPowerRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Play Recognition", value: player.playRecRating },
        { name: "Strength", value: player.strengthRating },
        { name: "Zone Coverage", value: player.zoneCoverRating },
      )
      break
    case "CB":
      attributes.push(
        { name: "Man Coverage", value: player.manCoverRating },
        { name: "Zone Coverage", value: player.zoneCoverRating },
        { name: "Play Recognition", value: player.playRecRating },
        { name: "Press", value: player.pressRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Jumping", value: player.jumpRating },
        { name: "Catching", value: player.catchRating },
      )
      break
    case "FS":
    case "SS":
      attributes.push(
        { name: "Zone Coverage", value: player.zoneCoverRating },
        { name: "Tackle", value: player.tackleRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Play Recognition", value: player.playRecRating },
        { name: "Man Coverage", value: player.manCoverRating },
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
        { name: "Penalty", value: formatPenaltyTrait(player.penaltyTrait) },
      )
      yesNoAttributes.push({ name: "Throw Away", value: player.throwAwayTrait },
        { name: "Tight Spiral", value: player.tightSpiralTrait })
      break
    case "FB":
    case "HB":
    case "WR":
    case "TE":
      attributes.push(
        { name: "Cover Ball", value: formatCoverBallTrait(player.coverBallTrait) },
        { name: "Penalty", value: formatPenaltyTrait(player.penaltyTrait) },
      )
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
      attributes.push(
        { name: "Penalty", value: formatPenaltyTrait(player.penaltyTrait) },
      )
      break
    case "LE":
    case "RE":
    case "DT":
      attributes.push(
        { name: "Penalty", value: formatPenaltyTrait(player.penaltyTrait) },
      )
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
        { name: "Penalty", value: formatPenaltyTrait(player.penaltyTrait) },
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
        { name: "Penalty", value: formatPenaltyTrait(player.penaltyTrait) },
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
  return `${yesNoTraits}\n${customAttributes}`

}


function getDevTraitName(devTrait: DevTrait): string {
  switch (devTrait) {
    case DevTrait.NORMAL: return SnallabotDevEmojis.NORMAL
    case DevTrait.STAR: return SnallabotDevEmojis.STAR
    case DevTrait.SUPERSTAR: return SnallabotDevEmojis.SUPERSTAR
    case DevTrait.XFACTOR: return SnallabotDevEmojis.XFACTOR
    default: return "Unknown"
  }
}

enum SnallabotTeamEmojis {
  // AFC East
  NE = "<:snallabot_ne:1364103345752641587>",
  NYJ = "<:snallabot_nyj:1364103346985635900>",
  BUF = "<:snallabot_buf:1364103347862372434>",
  MIA = "<:snallabot_mia:1364103349091176468>",

  // AFC North
  CIN = "<:snallabot_cin:1364103477399130144>",
  PIT = "<:snallabot_pit:1364103356393455667>",
  BAL = "<:snallabot_bal:1364105429591785543>",
  CLE = "<:snallabot_cle:1364103360545820742>",

  // AFC South
  TEN = "<:snallabot_ten:1364103353201856562>",
  IND = "<:snallabot_ind:1364103350194278484>",
  JAX = "<:snallabot_jax:1364103352115400774>",
  HOU = "<:snallabot_hou:1364103351184396318>",

  // AFC West
  KC = "<:snallabot_kc:1364105564711288852>",
  LV = "<:snallabot_lv:1364105565885825114>",
  DEN = "<:snallabot_den:1364103366765973615>",
  LAC = "<:snallabot_lac:1364103363297411142>",

  // NFC East
  DAL = "<:snallabot_dal:1364105752087887902>",
  NYG = "<:snallabot_nyg:1364103377411244124>",
  PHI = "<:snallabot_phi:1364105809134354472>",
  WAS = "<:snallabot_was:1364103380728811572>",

  // NFC North
  MIN = "<:snallabot_min:1364106069160493066>",
  CHI = "<:snallabot_chi:1364103373825249331>",
  DET = "<:snallabot_det:1364106151796670526>",
  GB = "<:snallabot_gb:1364103370289184839>",

  // NFC South
  NO = "<:snallabot_no:1364103387758592051>",
  CAR = "<:snallabot_car:1364106419804045353>",
  TB = "<:snallabot_tb:1364103384222797904>",
  ATL = "<:snallabot_atl:1364106360383471737>",

  // NFC West
  ARI = "<:snallabot_ari:1364106640315646013>",
  LAR = "<:snallabot_lar:1364103394800701450>",
  SEA = "<:snallabot_sea:1364103391260840018>",
  SF = "<:snallabot_sf:1364106686083895336>",
  NFL = "<:snallabot_nfl:1364108784229810257>"
}

function getTeamEmoji(teamAbbr: string): SnallabotTeamEmojis {
  return SnallabotTeamEmojis[teamAbbr.toUpperCase() as keyof typeof SnallabotTeamEmojis] || SnallabotTeamEmojis.NFL
}

enum SnallabotDevEmojis {
  NORMAL = "<:snallabot_normal_dev:1363761484131209226>",
  STAR = "<:snallabot_star_dev:1363761179805220884>",
  SUPERSTAR = "<:snallabot_superstar_dev:1363761181525020703>",
  XFACTOR = "<:snallabot_xfactor_dev:1363761178622562484>",
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

function formatPlayerCard(player: Player, teams: { [key: string]: string }) {

  const teamAbbr = teams[`${player.teamId}`]

  const heightFeet = Math.floor(player.height / 12)
  const heightInches = player.height % 12
  const formattedHeight = `${heightFeet}'${heightInches}"`

  let age = player.age

  const contractStatus = player.isFreeAgent ? "Free Agent" :
    `> **Length**: ${player.contractYearsLeft}/${player.contractLength} yrs\n> **Salary**: $${(player.contractSalary / 1000000).toFixed(2)}M\n> **Cap Hit**: $${(player.capHit / 1000000).toFixed(2)}M\n> **Bonus**: $${(player.contractBonus / 10000000).toFixed(2)}M\n> **Savings**: $${(player.capReleaseNetSavings / 10000000).toFixed(2)}M\n> **Penalty**: $${(player.capReleasePenalty / 10000000).toFixed(2)}M`

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
# ${getTeamEmoji(teamAbbr)} ${player.position} ${player.firstName} ${player.lastName}
## ${getDevTraitName(player.devTrait)} **${player.playerBestOvr} OVR**
**${age} yrs** | **${getSeasonFormatting(player.yearsPro)}** | **${formattedHeight}, ${player.weight} lbs**
## Contract
${contractStatus}
## Ratings
${topAttributes.map(attr => `> **${attr.name}:** ${attr.value}`).join('\n')}
${getPositionalTraits(player)}${abilities}
`
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

function formatPenaltyTrait(penalty: PenaltyTrait) {
  switch (penalty) {
    case PenaltyTrait.DISCIPLINED: return "Disciplined"
    case PenaltyTrait.NORMAL: return "Balanced"
    case PenaltyTrait.UNDISCIPLINED: return "Undisciplined"
  }
}

function formatPlayBallTrait(playBallTrait: PlayBallTrait) {
  switch (playBallTrait) {
    case PlayBallTrait.AGGRESSIVE: return "Aggressive"
    case PlayBallTrait.BALANCED: return "Balanced"
    case PlayBallTrait.CONSERVATIVE: return "Conservative"
  }
}

function formatCoverBallTrait(coverBallTrait: CoverBallTrait) {
  switch (coverBallTrait) {
    case CoverBallTrait.ALWAYS: return "Always"
    case CoverBallTrait.FOR_ALL_HITS: return "For All Hits"
    case CoverBallTrait.NEVER: return "Never"
    case CoverBallTrait.ON_BIG_HITS: return "On Big Hits"
    case CoverBallTrait.ON_MEDIUM_HITS: return "On Medium Hits"
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


function formatFullRatings(player: Player, teams: { [key: string]: string }) {
  const teamAbbr = teams[`${player.teamId}`]

  return `
# ${getTeamEmoji(teamAbbr)} ${player.position} ${player.firstName} ${player.lastName}
## ${getDevTraitName(player.devTrait)} **${player.playerBestOvr} OVR**
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
**Penalty:** ${formatPenaltyTrait(player.penaltyTrait)}
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
**Cover Ball:** ${formatCoverBallTrait(player.coverBallTrait)}
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

function formatGameEmoji(game: MaddenGame, playerTeam: number) {
  if (game.awayScore === game.homeScore) {
    return SnallabotGameResult.TIE
  }
  if (game.awayScore > game.homeScore) {
    return game.awayTeamId === playerTeam ? SnallabotGameResult.WIN : SnallabotGameResult.LOSS
  }
  if (game.awayScore < game.homeScore) {
    return game.homeTeamId === playerTeam ? SnallabotGameResult.WIN : SnallabotGameResult.LOSS
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

function formatGame(game: MaddenGame, player: Player, teams: { [key: string]: string }) {
  const playerTeam = player.teamId
  const homeTeam = game.homeTeamId
  const awayTeam = game.awayTeamId
  const opponentTeam = playerTeam === awayTeam ? homeTeam : awayTeam
  const opponent = teams[opponentTeam]
  return `${formatWeek(game)} vs ${opponent.padEnd(3)} ${formatGameEmoji(game, playerTeam)} ${formatScore(game)}:`
}

function formatWeeklyStats(player: Player, teams: { [key: string]: string }, stats: PlayerStats, games: MaddenGame[]) {
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

  const teamAbbr = teams[`${player.teamId}`]
  const joinedWeekStats = weekStats.join("\n")
  return `
# ${getTeamEmoji(teamAbbr)} ${player.position} ${player.firstName} ${player.lastName}
## ${getDevTraitName(player.devTrait)} **${player.playerBestOvr} OVR**
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

function formatSeasonStats(player: Player, stats: PlayerStats, teams: { [key: string]: string }) {

  const teamAbbr = teams[`${player.teamId}`]
  const agg = aggregateSeason(stats)
  const formattedAgg = formatSeasonAggregation(agg)

  return `
# ${getTeamEmoji(teamAbbr)} ${player.position} ${player.firstName} ${player.lastName}
## ${getDevTraitName(player.devTrait)} **${player.playerBestOvr} OVR**
## Stats
${formattedAgg}
`
}

function formatPlayerList(players: Player[], teams: { [key: string]: string }) {
  let message = "# Player Results:\n";

  for (const player of players) {
    const teamName = teams[`${player.teamId}`]
    const fullName = `${player.firstName} ${player.lastName}`;
    const heightFeet = Math.floor(player.height / 12);
    const heightInches = player.height % 12;
    const heightFormatted = `${heightFeet}'${heightInches}"`;
    const teamEmoji = getTeamEmoji(teamName) === SnallabotTeamEmojis.NFL ? `**${teamName.toUpperCase()}**` : getTeamEmoji(teamName)
    const experience = getSeasonFormatting(player.yearsPro)
    const devTraitEmoji = getDevTraitName(player.devTrait)
    message += `## ${teamEmoji} ${player.position} ${fullName} - ${player.playerBestOvr} OVR\n`;
    message += `${devTraitEmoji} | ${player.age} yrs | ${experience} | ${heightFormatted} | ${player.weight} lbs\n\n`;
  }

  return message;

}

type PlayerFound = { teamAbbr: string, rosterId: number, firstName: string, lastName: string, teamId: number, position: string }

async function searchPlayerForRosterId(query: string, leagueId: string): Promise<PlayerFound[]> {
  const [playersToSearch, teamsIndex] = await Promise.all([playerSearchIndex.createView(leagueId), teamSearchView.createView(leagueId)])
  if (playersToSearch && teamsIndex) {
    const players = Object.fromEntries(Object.entries(playersToSearch).map(entry => {
      const [rosterId, roster] = entry
      const abbr = roster.teamId === 0 ? "FA" : teamsIndex?.[roster.teamId]?.abbrName
      return [rosterId, { teamAbbr: abbr, ...roster }]
    }))
    const results = fuzzysort.go(query, Object.values(players), {
      keys: ["firstName", "lastName", "position", "teamAbbr"], threshold: 0.4, limit: 25
    })
    return results.map(r => r.obj)
  }
  return []
}
const positions = POSITIONS.concat(POSITION_GROUP).map(p => ({ teamDisplayName: "", teamId: -1, teamNickName: "", position: p, rookie: "" }))
const rookies = [{
  teamDisplayName: "", teamId: -1, teamNickName: "", position: "", rookie: "Rookies"
}]
const rookiePositions = positions.map(p => ({ ...p, rookie: "Rookies" }))
type PlayerListSearchQuery = { teamDisplayName: string, teamId: number, teamNickName: string, position: string, rookie: string }


// to boost top level queries like team names, position groups, and rookies
function isTopLevel(q: PlayerListSearchQuery) {
  if (q.teamDisplayName && !q.position && !q.rookie) {
    return true
  }
  if (!q.teamDisplayName && q.position && !q.rookie) {
    return true
  }
  if (!q.teamDisplayName && !q.position && q.rookie) {
    return true
  }
  return false
}

function formatQuery(q: PlayerListSearchQuery) {
  const teamName = q.teamDisplayName ? [q.teamDisplayName] : []
  const position = q.position ? [q.position] : []
  const rookie = q.rookie ? [q.rookie] : []
  return [teamName, rookie, position].join(" ")
}

async function searchPlayerListForQuery(textQuery: string, leagueId: string): Promise<PlayerListSearchQuery[]> {
  const teamIndex = await teamSearchView.createView(leagueId)
  if (teamIndex) {
    const fullTeams = Object.values(teamIndex).map(t => ({ teamDisplayName: t.displayName, teamId: t.id, teamNickName: t.nickName, position: "", rookie: "" })).concat([{ teamDisplayName: "Free Agents", teamId: 0, teamNickName: "FA", position: "", rookie: "" }])
    const teamPositions = fullTeams.flatMap(t => positions.map(p => ({ teamDisplayName: t.teamDisplayName, teamId: t.teamId, teamNickName: t.teamNickName, position: p.position, rookie: "" })))
    const teamRookies = fullTeams.map(t => ({ ...t, rookie: "Rookies" }))
    const allQueries: PlayerListSearchQuery[] = fullTeams.concat(positions).concat(rookies).concat(rookiePositions).concat(teamPositions).concat(teamRookies)
    const results = fuzzysort.go(textQuery, allQueries, {
      keys: ["teamDisplayName", "teamNickName", "position", "rookie"],
      scoreFn: r => r.score * (isTopLevel(r.obj) ? 2 : 1),
      threshold: 0.4,
      limit: 25
    })
    return results.map(r => r.obj)
  }
  return []
}

export default {
  async handleCommand(command: Command, client: DiscordClient, _: Firestore, ctx: ParameterizedContext) {
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
      respond(ctx, deferMessage())
      showPlayerCard(playerSearch, client, token, guild_id)
    } else if (subCommand === "list") {
      if (!playerCommand.options || !playerCommand.options[0]) {
        throw new Error("player get misconfigured")
      }
      const playerSearch = (playerCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value
      respond(ctx, deferMessage())
      showPlayerList(playerSearch, client, token, guild_id)
    } else {
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
          const { teamDisplayName, teamNickName, ...rest } = r
          return { name: formatQuery(r), value: JSON.stringify(rest) }
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
      const { rosterId, selected } = JSON.parse(data.values[0]) as Selection
      try {
        if (selected === PlayerSelection.PLAYER_OVERVIEW) {
          showPlayerCard(`${rosterId}`, client, interaction.token, interaction.guild_id)
        } else if (selected === PlayerSelection.PLAYER_FULL_RATINGS) {
          showPlayerFullRatings(rosterId, client, interaction.token, interaction.guild_id)
        } else if (selected === PlayerSelection.PLAYER_WEEKLY_STATS) {
          showPlayerWeeklyStats(rosterId, client, interaction.token, interaction.guild_id)
        } else if (selected === PlayerSelection.PLAYER_SEASON_STATS) {
          showPlayerYearlyStats(rosterId, client, interaction.token, interaction.guild_id)
        } else {
          console.error("should not have gotten here")
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
        const { q: query, l: rosterId, league } = JSON.parse(customId) as PlayerPagination
        if (rosterId) {
          const player = await MaddenDB.getPlayer(league, `${rosterId}`)
          showPlayerList(JSON.stringify(query), client, interaction.token, interaction.guild_id, player)
        } else {
          showPlayerList(JSON.stringify(query), client, interaction.token, interaction.guild_id)
        }
      } catch (e) {
        await client.editOriginalInteraction(interaction.token, {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: `Could not list players  Error: ${e}`
            }
          ]
        })
      }
    }
  }
} as CommandHandler & AutocompleteHandler & MessageComponentHandler
