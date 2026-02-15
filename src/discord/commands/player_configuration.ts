import { discordLeagueView } from "../../db/view"
import { Command } from "../commands_handler"
import { createMessageResponse, deferMessage, DiscordClient, NoConnectedLeagueError, SnallabotCommandReactions } from "../discord_utils"
import { APIApplicationCommandInteractionDataBooleanOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, ComponentType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import LeagueSettingsDB from "../settings_db"
import EventDB, { EventDelivery } from "../../db/events_db"
import { EventTypes, RetiredPlayersEvent } from "../../db/events"
import MaddenDB, { createPlayerKey } from "../../db/madden_db"
import { ExportContext, exporterForLeague, storedTokenClient } from "../../dashboard/ea_client"

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
    const exporter = exporterForLeague(league, ExportContext.MANUAL)
    const { waitUntilDone } = exporter.exportCurrentWeek()
    await waitUntilDone.catch(e => { throw e })
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
      throw new Error("player configure command not defined properly")
    }
    const options = command.data.options
    const playerCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = playerCommand.name
    if (subCommand === "retire") {
      const discordLeague = await discordLeagueView.createView(guild_id)
      const leagueId = discordLeague?.leagueId
      if (!leagueId) {
        throw new NoConnectedLeagueError(guild_id)
      }
      retirePlayers(leagueId, token, client)
      return deferMessage()
    } else if (subCommand === "configure") {
      const subCommandOptions = playerCommand.options
      if (!subCommandOptions) {
        throw new Error("missing player configure options!")
      }
      const hiddenDevs = (subCommandOptions[0] as APIApplicationCommandInteractionDataBooleanOption
      ).value
      await LeagueSettingsDB.configurePlayer(guild_id, { useHiddenDevs: hiddenDevs })
      return createMessageResponse(`Player Configuration:\n  - Hidden Devs: ${hiddenDevs ? "on" : "off"}`)
    }

    else {
      throw new Error(`Missing player command ${subCommand}`)
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "player_configuration",
      description: "configures the players command in your league",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "retire",
          description: "Finds and retires all players who are no longer in the league",
          options: [],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "configures settings for players",
          options: [
            {
              type: ApplicationCommandOptionType.Boolean,
              name: "hidden_devs",
              description:
                "Turn on/off rookie hidden devs",
              required: true
            },
          ],
        },
      ],
      type: 1,
    }
  }
}
