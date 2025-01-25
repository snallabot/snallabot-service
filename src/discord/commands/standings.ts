import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, deferMessage } from "../discord_utils"
import { APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { LeagueSettings } from "../settings_db"
import MaddenDB from "../../db/madden_db"
import { Standing, formatRecord } from "../../export/madden_league_types"

function formatStandings(standings: Standing[]) {
  const sortedStandings = standings.sort((s1, s2) => s2.rank - s1.rank)
  const standingsMessage = sortedStandings.map(standing => {
    const record = formatRecord(standing)
    const teamRank = `### Team Rank\nNet Points: ${standing.netPts}\nPoints For: ${standing.ptsFor} (${standing.ptsForRank})\nPoints Against: ${standing.ptsAgainst} (${standing.ptsAgainstRank})\nTurnovers: ${standing.tODiff}`
    const offenseRank = `### Offense Rank\nTotal:${standing.offTotalYds} yds (${standing.offTotalYdsRank})\nPassing: ${standing.offPassYds} yds (${standing.offPassYdsRank})\nRushing: ${standing.offRushYds} yds (${standing.offRushYdsRank})\n`
    const defensiveRank = `### Defense Rank\nTotal:${standing.defTotalYds} yds (${standing.defTotalYdsRank})\nPassing: ${standing.defPassYds} yds (${standing.defPassYdsRank})\nRushing: ${standing.defRushYds} yds (${standing.defRushYdsRank})\n`
    return `## ${standing.rank}. ${standing.teamName} (${record})\n${teamRank}\n${offenseRank}\n${defensiveRank}`
  }).join("\n")
  return standingsMessage
}

async function handleCommand(client: DiscordClient, token: string, league: string, subCommand: string) {
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
    const message = formatStandings(standingsToFormat)
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
    respond(ctx, deferMessage())
    handleCommand(client, token, league, subCommand)
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
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "nfc",
          description: "standings for the nfc",
          options: [
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "afc",
          description: "standings for the afc",
          options: [
          ],
        }
      ]
    }
  }
} as CommandHandler
