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
    return [teamId, t.displayName]
  }))
  // 0 team id means the player is a free agent
  teamsDisplayNames["0"] = "Free Agent"
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

  // Common attributes for all positions
  attributes.push(
    { name: "Speed", value: player.speedRating },
    { name: "Acceleration", value: player.accelRating },
    { name: "Strength", value: player.strengthRating },
    { name: "Agility", value: player.agilityRating },
    { name: "Awareness", value: player.awareRating }
  )

  // Position specific attributes
  switch (player.position) {
    case "QB":
      attributes.push(
        { name: "Throw Power", value: player.throwPowerRating },
        { name: "Short Accuracy", value: player.throwAccShortRating },
        { name: "Medium Accuracy", value: player.throwAccMidRating },
        { name: "Deep Accuracy", value: player.throwAccDeepRating },
        { name: "Throw Under Pressure", value: player.throwUnderPressureRating }
      )
      break
    case "HB":
    case "FB":
      attributes.push(
        { name: "Carrying", value: player.carryRating },
        { name: "Break Tackle", value: player.breakTackleRating },
        { name: "Truck", value: player.truckRating },
        { name: "Juke Move", value: player.jukeMoveRating },
        { name: "Spin Move", value: player.spinMoveRating }
      )
      break
    case "WR":
    case "TE":
      attributes.push(
        { name: "Catching", value: player.catchRating },
        { name: "Spectacular Catch", value: player.specCatchRating },
        { name: "Short Route", value: player.routeRunShortRating },
        { name: "Medium Route", value: player.routeRunMedRating },
        { name: "Deep Route", value: player.routeRunDeepRating }
      )
      break
    case "LT":
    case "LG":
    case "C":
    case "RG":
    case "RT":
      attributes.push(
        { name: "Pass Block", value: player.passBlockRating },
        { name: "Pass Block Power", value: player.passBlockPowerRating },
        { name: "Pass Block Finesse", value: player.passBlockFinesseRating },
        { name: "Run Block", value: player.runBlockRating },
        { name: "Run Block Power", value: player.runBlockPowerRating }
      )
      break
    case "LE":
    case "RE":
    case "DT":
      attributes.push(
        { name: "Block Shedding", value: player.blockShedRating },
        { name: "Power Moves", value: player.powerMovesRating },
        { name: "Finesse Moves", value: player.finesseMovesRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Tackle", value: player.tackleRating }
      )
      break
    case "LOLB":
    case "MLB":
    case "ROLB":
      attributes.push(
        { name: "Tackle", value: player.tackleRating },
        { name: "Pursuit", value: player.pursuitRating },
        { name: "Zone Coverage", value: player.zoneCoverRating },
        { name: "Man Coverage", value: player.manCoverRating },
        { name: "Hit Power", value: player.hitPowerRating }
      )
      break
    case "CB":
    case "FS":
    case "SS":
      attributes.push(
        { name: "Man Coverage", value: player.manCoverRating },
        { name: "Zone Coverage", value: player.zoneCoverRating },
        { name: "Press", value: player.pressRating },
        { name: "Play Recognition", value: player.playRecRating },
        { name: "Catching", value: player.catchRating }
      )
      break
    case "K":
    case "P":
      attributes.push(
        { name: "Kick Power", value: player.kickPowerRating },
        { name: "Kick Accuracy", value: player.kickAccRating },
        { name: "Stamina", value: player.staminaRating },
        { name: "Injury", value: player.injuryRating }
      )
      break
  }

  return attributes
}


function getDevTraitName(devTrait: number): string {
  switch (devTrait) {
    case 0: return "Normal"
    case 1: return "Star"
    case 2: return "Superstar"
    case 3: return "X-Factor"
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


function formatPlayerCard(player: Player, teams: { [key: string]: string }) {

  const teamName = teams[`${player.teamId}`]

  const heightFeet = Math.floor(player.height / 12)
  const heightInches = player.height % 12
  const formattedHeight = `${heightFeet}'${heightInches}"`

  const birthDate = new Date(player.birthYear, player.birthMonth - 1, player.birthDay)
  // TODO fix age with right date
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  if (today.getMonth() < birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) {
    age--
  }

  const contractStatus = player.isFreeAgent ? "Free Agent" :
    `${player.contractYearsLeft} years left, $${(player.contractSalary / 1000000).toFixed(2)}M/yr`

  const injuryStatus = player.isOnIR ? "⚠️ On Injured Reserve" :
    player.isOnPracticeSquad ? "Practice Squad" : player.isActive ? "Active" : "Inactive"

  const topAttributes = getTopAttributesByPosition(player)

  const abilities = player.signatureSlotList && player.signatureSlotList.length > 0
    ? "\n**Abilities:** " + player.signatureSlotList
      .filter(ability => !ability.isEmpty)
      .map(ability => {
        return ability.signatureAbility?.signatureTitle || "Unnamed Ability"
      })
      .join(", ")
    : ""

  return `
# ${player.firstName} ${player.lastName} | ${player.position} ${teamName} | #${player.jerseyNum}
## Physical
> **Age:** ${age} (Born: ${player.birthMonth}/${player.birthDay}/${player.birthYear})
> **Height/Weight:** ${formattedHeight}, ${player.weight} lbs
> **College:** ${player.college}
> **Hometown:** ${player.homeTown}, ${getStateNameFromCode(player.homeState)}
> **Experience:** ${player.yearsPro} years (Drafted: Round ${player.draftRound}, Pick ${player.draftPick})
## Status
> ${injuryStatus}
> **Contract:** ${contractStatus}
> **Development Trait:** ${getDevTraitName(player.devTrait)}
> **Scheme Fit:** ${player.playerSchemeOvr}%
## Top Ratings
${topAttributes.map(attr => `> **${attr.name}:** ${attr.value}`).join('\n')}${abilities}
## Overall Grades
> **Physical:** ${getGradeLetter(player.physicalGrade)}
> **Production:** ${getGradeLetter(player.productionGrade)}
> **Intangible:** ${getGradeLetter(player.intangibleGrade)}
> **Size:** ${getGradeLetter(player.sizeGrade)}
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
