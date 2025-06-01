import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, DiscordClient, deferMessage } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { LeagueSettings } from "../settings_db"
import MaddenDB from "../../db/madden_db"
import { Standing, formatRecord } from "../../export/madden_league_types"

function formatStandings(standings: Standing[]) {
  const standingsMessageFull = standings.map(standing => {
    const record = formatRecord(standing)
    const teamRank = `Net Points: ${standing.netPts}\nPoints For: ${standing.ptsFor} (${standing.ptsForRank})\nPoints Against: ${standing.ptsAgainst} (${standing.ptsAgainstRank})\nTurnover Diff: ${standing.tODiff}`
    const offenseRank = `### Offense Rank\nTotal: ${standing.offTotalYds}yds (${standing.offTotalYdsRank})\nPassing: ${standing.offPassYds}yds (${standing.offPassYdsRank})\nRushing: ${standing.offRushYds}yds (${standing.offRushYdsRank})`
    const defensiveRank = `### Defense Rank\nTotal: ${standing.defTotalYds}yds (${standing.defTotalYdsRank})\nPassing: ${standing.defPassYds}yds (${standing.defPassYdsRank})\nRushing: ${standing.defRushYds}yds (${standing.defRushYdsRank})`
    return `### ${standing.rank}. ${standing.teamName} (${record})\n${teamRank}\n${offenseRank}\n${defensiveRank}`
  }).join("\n")
  const standingsMessageLight = standings.map(standing => {
    const record = formatRecord(standing)
    const teamRank = `Net Points: ${standing.netPts}\nOffense Yards: ${standing.offTotalYds} (${standing.offTotalYdsRank})\nDefense: ${standing.defTotalYds} (${standing.defTotalYdsRank})\nTurnover Diff: ${standing.tODiff}`
    return `### ${standing.rank}. ${standing.teamName} (${record})\n${teamRank}`
  }).join("\n")
  const standingsMessageBare = standings.map(standing => {
    const record = formatRecord(standing)
    return `### ${standing.rank}. ${standing.teamName} (${record})`
  }).join("\n")

  return [standingsMessageFull, standingsMessageLight, standingsMessageBare].filter(s => s.length < 2000)[0]
}

async function handleCommand(client: DiscordClient, token: string, league: string, subCommand: string, top: number) {
  try {
    const standings = await MaddenDB.getLatestStandings(league)
    const standingsToFormat = (() => {
      if (subCommand === "nfl") {
        return standings
      } else if (subCommand === "afc") {
        return standings.filter(s => s.conferenceName.toLowerCase() === "afc")
      } else if (subCommand === "nfc") {
        return standings.filter(s => s.conferenceName.toLowerCase() === "nfc")
      }
      throw new Error("unknown conference " + subCommand)
    })()
    if (!standingsToFormat) {
      throw new Error("no standings")
    }
    const message = formatStandings(standingsToFormat.sort((s1, s2) => s1.rank - s2.rank).slice(0, top))
    await client.editOriginalInteraction(token, {
      content: message
    })
  } catch (e) {
    await client.editOriginalInteraction(token, {
      content: "Standings failed: Error: " + e
    })
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id, token } = command
    if (!command.data.options) {
      throw new Error("game channels command not defined properly")
    }
    const options = command.data.options
    const standingsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = standingsCommand.name
    const doc = await db.collection("league_settings").doc(guild_id).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    if (!leagueSettings?.commands?.madden_league?.league_id) {
      throw new Error("No madden league linked. Setup snallabot with your Madden league first")
    }
    const league = leagueSettings.commands.madden_league.league_id
    const top = Number(standingsCommand?.options?.[0] ? (standingsCommand.options[0] as APIApplicationCommandInteractionDataIntegerOption).value : 32)
    if (standingsCommand?.options?.[0]) {

    }
    respond(ctx, deferMessage())
    handleCommand(client, token, league, subCommand, top)
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "standings",
      description: "display the current team standings",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "nfl",
          description: "standings for the entire league",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "top",
              description: "get only the top teams",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "nfc",
          description: "standings for the nfc",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "top",
              description: "get only the top teams",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "afc",
          description: "standings for the afc",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "top",
              description: "get only the top teams",
              required: false,
            },
          ],
        }
      ]
    }
  }
} as CommandHandler
