import { ParameterizedContext } from "koa"
import { CommandHandler, Command, AutocompleteHandler, Autocomplete } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, deferMessage } from "../discord_utils"
import { APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { playerSearchIndex, discordLeagueView, teamSearchView } from "../../db/view"
import fuzzysort from "fuzzysort"
import MaddenDB from "../../db/madden_db"
import { Player } from "../../export/madden_league_types"

async function showPlayerCard(playerSearch: string, client: DiscordClient, db: Firestore, token: string, guild_id: string) {
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
    content: formatPlayerCard(player, teamsDisplayNames)
  })
}

function getGradeLetter(grade: number): string {
  if (grade >= 90) return "A+"
  if (grade >= 85) return "A"
  if (grade >= 80) return "A-"
  if (grade >= 75) return "B+"
  if (grade >= 70) return "B"
  if (grade >= 65) return "B-"
  if (grade >= 60) return "C+"
  if (grade >= 55) return "C"
  if (grade >= 50) return "C-"
  if (grade >= 45) return "D+"
  if (grade >= 40) return "D"
  if (grade >= 35) return "D-"
  return "F"
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


function getDevTraitName(devTrait: number): string {
  switch (devTrait) {
    case 0: return SnallabotDevEmojis.NORMAL
    case 1: return SnallabotDevEmojis.STAR
    case 2: return SnallabotDevEmojis.SUPERSTAR
    case 3: return SnallabotDevEmojis.XFACTOR
    default: return "Unknown"
  }
}

function getStateNameFromCode(stateCode: number): string {
  const states: { [key: number]: string } = {
    1: "AL", 2: "AK", 3: "AZ", 4: "AR", 5: "CA", 6: "CO", 7: "CT", 8: "DE", 9: "FL", 10: "GA",
    11: "HI", 12: "ID", 13: "IL", 14: "IN", 15: "IA", 16: "KS", 17: "KY", 18: "LA", 19: "ME", 20: "MD",
    21: "MA", 22: "MI", 23: "MN", 24: "MS", 25: "MO", 26: "MT", 27: "NE", 28: "NV", 29: "NH", 30: "NJ",
    31: "NM", 32: "NY", 33: "NC", 34: "ND", 35: "OH", 36: "OK", 37: "OR", 38: "PA", 39: "RI", 40: "SC",
    41: "SD", 42: "TN", 43: "TX", 44: "UT", 45: "VT", 46: "VA", 47: "WA", 48: "WV", 49: "WI", 50: "WY",
    51: "DC"
  }
  return states[stateCode] || "Unknown"
}

function getTeamEmoji(abbr: string): string {
  switch (abbr.toLowerCase()) {
    // AFC East
    case "ne":
      return "<:snallabot_ne:1364103345752641587>"
    case "nyj":
      return "<:snallabot_nyj:1364103346985635900>"
    case "buf":
      return "<:snallabot_buf:1364103347862372434>"
    case "mia":
      return "<:snallabot_mia:1364103349091176468>"
    // AFC North
    case "cin":
      return "<:snallabot_cin:1364103477399130144>"
    case "pit":
      return "<:snallabot_pit:1364103356393455667>"
    case "bal":
      return "<:snallabot_bal:1364105429591785543>"
    case "cle":
      return "<:snallabot_cle:1364103360545820742>"
    // AFC South
    case "ten":
      return "<:snallabot_ten:1364103353201856562>"
    case "ind":
      return "<:snallabot_ind:1364103350194278484>"
    case "jax":
      return "<:snallabot_jax:1364103352115400774>"
    case "hou":
      return "<:snallabot_hou:1364103351184396318>"
    // AFC West
    case "kc":
      return "<:snallabot_kc:1364105564711288852>"
    case "lv":
      return "<:snallabot_lv:1364105565885825114>"
    case "den":
      return "<:snallabot_den:1364103366765973615>"
    case "lac":
      return "<:snallabot_lac:1364103363297411142>"
    // NFC East
    case "dal":
      return "<:snallabot_dal:1364105752087887902>"
    case "nyg":
      return "<:snallabot_nyg:1364103377411244124>"
    case "phi":
      return "<:snallabot_phi:1364105809134354472>"
    case "was":
      return "<:snallabot_was:1364103380728811572>"
    // NFC North
    case "min":
      return "<:snallabot_min:1364106069160493066>"
    case "chi":
      return "<:snallabot_chi:1364103373825249331>"
    case "det":
      return "<:snallabot_det:1364106151796670526>"
    case "gb":
      return "<:snallabot_gb:1364103370289184839>"
    // NFC South
    case "no":
      return "<:snallabot_no:1364103387758592051>"
    case "car":
      return "<:snallabot_car:1364106419804045353>"
    case "tb":
      return "<:snallabot_tb:1364103384222797904>"
    case "atl":
      return "<:snallabot_atl:1364106360383471737>"
    // NFC West
    case "ari":
      return "<:snallabot_ari:1364106640315646013>"
    case "lar":
      return "<:snallabot_lar:1364103394800701450>"
    case "sea":
      return "<:snallabot_sea:1364103391260840018>"
    case "sf":
      return "<:snallabot_sf:1364106686083895336>"
    // NFL Logo as default
    default:
      return "<:snallabot_nfl:1364108784229810257>"
  }
}

enum SnallabotDevEmojis {
  NORMAL = "<:snallabot_normal_dev:1363761484131209226>",
  STAR = "<:snallabot_star_dev:1363761179805220884>",
  SUPERSTAR = "<:snallabot_superstar_dev:1363761181525020703>",
  XFACTOR = "<:snallabot_xfactor_dev:1363761178622562484>",
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
      .filter(ability => !ability.isEmpty)
      .map(ability => {
        return ability.signatureAbility?.signatureTitle || "Unnamed Ability"
      })
      .join(", ")
    : ""
  const experience = player.yearsPro === 0 ? "Rookie" : `${player.yearsPro} Yrs Experience`
  return `
# ${getTeamEmoji(teamAbbr)} ${player.position} ${player.firstName} ${player.lastName} | ${player.playerBestOvr} OVR
${getDevTraitName(player.devTrait)} | ${age} yrs | ${formattedHeight}, ${player.weight} lbs
${experience}
${player.yearsPro} yrs
## Contract
${contractStatus}
## Ratings
${topAttributes.map(attr => `> **${attr.name}:** ${attr.value}`).join('\n')}${abilities}
`
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

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id, token } = command
    if (!command.data.options) {
      throw new Error("logger command not defined properly")
    }
    const options = command.data.options
    const playerCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = playerCommand.name
    const doc = await db.collection("league_settings").doc(guild_id).get()
    if (subCommand === "get") {
      if (!playerCommand.options || !playerCommand.options[0]) {
        throw new Error("player get misconfigured")
      }
      const playerSearch = (playerCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value
      respond(ctx, deferMessage())
      showPlayerCard(playerSearch, client, db, token, guild_id)
    } else if (subCommand === "list") {
      respond(ctx, createMessageResponse("wip"))
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
        }],
      type: 1,
    }
  },
  async choices(command: Autocomplete) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("logger command not defined properly")
    }
    const options = command.data.options
    const playerCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = playerCommand.name
    const view = await discordLeagueView.createView(guild_id)
    const leagueId = view?.leagueId
    if (leagueId && (playerCommand?.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.focused && playerCommand?.options?.[0]?.value) {
      const playerSearchPhrase = playerCommand.options[0].value as string
      const results = await searchPlayerForRosterId(playerSearchPhrase, leagueId)
      return results.map(r => ({ name: `${r.teamAbbr} ${r.position.toUpperCase()} ${r.firstName} ${r.lastName}`, value: `${r.rosterId}` }))
    }
    return []
  }
} as CommandHandler | AutocompleteHandler
