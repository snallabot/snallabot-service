import { ParameterizedContext } from "koa"
import { CommandHandler, Command, AutocompleteHandler, Autocomplete } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { LeagueSettings } from "../settings_db"
import { playerSearchIndex, discordLeagueView, teamSearchView } from "../../db/view"
import fuzzysort from "fuzzysort"


export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
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
      respond(ctx, createMessageResponse(playerSearch))
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
      const [playersToSearch, teamsIndex] = await Promise.all([playerSearchIndex.createView(leagueId), teamSearchView.createView(leagueId)])
      if (playersToSearch && teamsIndex) {
        const players = Object.fromEntries(Object.entries(playersToSearch).map(entry => {
          const [rosterId, roster] = entry
          const displayName = roster.teamId === 0 ? "FA" : teamsIndex?.[roster.teamId]?.abbrName
          return [rosterId, { teamAbbr: displayName, ...roster }]
        }))
        const results = fuzzysort.go(playerSearchPhrase, Object.values(players), {
          keys: ["firstName", "lastName", "position", "teamAbbr"], threshold: 0.4, limit: 25
        })
        return results.map(r => ({ name: `${r.obj.teamAbbr} ${r.obj.position.toUpperCase()} ${r.obj.firstName} ${r.obj.lastName}`, value: `${r.obj.rosterId}` }))
      }
    }
    return []
  }
} as CommandHandler | AutocompleteHandler
