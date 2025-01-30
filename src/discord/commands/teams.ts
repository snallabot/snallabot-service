import { ParameterizedContext } from "koa"
import { CommandHandler, Command, AutocompleteHandler, Autocomplete } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataBooleanOption, APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataRoleOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, APIApplicationCommandInteractionDataUserOption, APIMessage, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { FieldValue, Firestore } from "firebase-admin/firestore"
import { DiscordIdType, LeagueSettings, TeamAssignments } from "../settings_db"
import MaddenClient from "../../db/madden_db"
import { Team } from "../../export/madden_league_types"
import { teamSearchView } from "../../db/view"
import fuzzysort from "fuzzysort"
import MaddenDB from "../../db/madden_db"
import firebaseDB from "../../db/firebase"

async function moveTeamsMessage(client: DiscordClient, oldChannelId: string, newChannelId: string, oldMessageId: string, teamsMessage: string): Promise<string> {
  try {
    await client.requestDiscord(`channels/${oldChannelId}/messages/${oldMessageId}`, {
      method: "DELETE"
    })
  } catch (e) { }
  const res = await client.requestDiscord(`channels/${newChannelId}/messages`, {
    method: "POST",
    body: {
      content: teamsMessage,
      allowed_mentions: {
        parse: []
      }
    }
  })
  const message = await res.json() as APIMessage
  return message.id
}

function formatTeamMessage(teams: Team[], teamAssignments: TeamAssignments): string {
  const header = "# Teams"
  const teamsMessage = Object.entries(Object.groupBy(teams, team => team.divName))
    .sort((entry1, entry2) => entry1[0].localeCompare(entry2[0]))
    .map(entry => {
      const divisionalTeams = entry[1] || []
      const divisionName = entry[0]
      const divisionMessage = divisionalTeams.sort((t1, t2) => t1.displayName.localeCompare(t2.displayName))
        .map(team => {
          const user = teamAssignments?.[`${team.teamId}`]?.discord_user?.id
          const consoleUser = team.userName
          const assignment = [user ? [`<@${user}>`] : [], [consoleUser ? `\`${consoleUser}\`` : "`CPU`"]].flat().join(", ")
          return `${team.displayName}: ${assignment}`
        }).join("\n")
      const divisionHeader = `__**${divisionName}**__`
      return `${divisionHeader}\n${divisionMessage}`
    })
    .join("\n")

  const openTeams = teams.filter(t => !teamAssignments?.[`${t.teamId}`]?.discord_user?.id).map(t => t.displayName).join(", ")
  const openTeamsMessage = `OPEN TEAMS: ${openTeams}`
  return `${header}\n${teamsMessage}\n\n${openTeamsMessage}`
}

export async function fetchTeamsMessage(settings: LeagueSettings): Promise<string> {
  if (settings?.commands?.madden_league?.league_id) {
    const teams = await MaddenClient.getLatestTeams(settings.commands.madden_league.league_id)
    return createTeamsMessage(settings, teams.getLatestTeams())
  } else {
    return "# Teams\nNo Madden League connected. Connect Snallabot to your league and reconfigure"
  }
}

function createTeamsMessage(settings: LeagueSettings, teams: Team[]): string {
  if (settings?.commands?.madden_league?.league_id) {
    return formatTeamMessage(teams, settings.commands.teams?.assignments || {})
  } else {
    return "# Teams\nNo Madden League connected. Connect Snallabot to your league and reconfigure"
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("logger command not defined properly")
    }
    const options = command.data.options
    const teamsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = teamsCommand.name
    const doc = await db.collection("league_settings").doc(guild_id).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    if (subCommand === "configure") {
      if (!teamsCommand.options || !teamsCommand.options[0]) {
        throw new Error("teams configure misconfigured")
      }
      const channel = (teamsCommand.options[0] as APIApplicationCommandInteractionDataChannelOption).value
      const useRoleUpdates = (teamsCommand.options?.[1] as APIApplicationCommandInteractionDataBooleanOption)?.value || false
      const oldChannelId = leagueSettings?.commands?.teams?.channel?.id
      const oldMessageId = leagueSettings?.commands?.teams?.messageId?.id || ""
      if (oldChannelId && oldChannelId !== channel) {
        const message = await fetchTeamsMessage(leagueSettings)
        const newMessageId = await moveTeamsMessage(client, oldChannelId, channel, oldMessageId, message)
        await db.collection("league_settings").doc(guild_id).set({
          commands: {
            teams: {
              channel: { id: channel, id_type: DiscordIdType.CHANNEL },
              messageId: { id: newMessageId, id_type: DiscordIdType.MESSAGE },
              useRoleUpdates: useRoleUpdates,
              assignments: leagueSettings?.commands?.teams?.assignments || {},
            }
          }
        }, { merge: true })
        respond(ctx, createMessageResponse("Teams Configured"))
      } else {
        const oldMessageId = leagueSettings?.commands?.teams?.messageId.id
        if (oldMessageId) {
          try {
            await client.requestDiscord(`channels/${channel}/messages/${oldMessageId}`, { method: "GET" })
            await db.collection("league_settings").doc(guild_id).set({
              commands: {
                teams: {
                  useRoleUpdates: useRoleUpdates,
                  assignments: leagueSettings?.commands.teams?.assignments || {},
                }
              }
            }, { merge: true })
            const message = await fetchTeamsMessage(leagueSettings)
            await client.requestDiscord(`channels/${channel}/messages/${oldMessageId}`, { method: "PATCH", body: { content: message, allowed_mentions: { parse: [] } } })
            respond(ctx, createMessageResponse("Teams Configured"))
            return
          } catch (e) {
            console.debug(e)
          }
        }
        const message = await fetchTeamsMessage(leagueSettings)
        const res = await client.requestDiscord(`channels/${channel}/messages`, {
          method: "POST", body: {
            content: message,
            allowed_mentions: { parse: [] }
          }
        })
        const messageData = await res.json() as APIMessage
        await db.collection("league_settings").doc(guild_id).set({
          commands: {
            teams: {
              channel: { id: channel, id_type: DiscordIdType.CHANNEL },
              messageId: { id: messageData.id, id_type: DiscordIdType.MESSAGE },
              useRoleUpdates: useRoleUpdates,
              assignments: leagueSettings?.commands?.teams?.assignments || {},
            }
          }
        }, { merge: true })
        respond(ctx, createMessageResponse("Teams Configured"))
      }
    } else if (subCommand === "assign") {
      if (!teamsCommand.options || !teamsCommand.options[0] || !teamsCommand.options[1]) {
        throw new Error("teams assign misconfigured")
      }
      const teamSearchPhrase = (teamsCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value.toLowerCase()
      const user = (teamsCommand.options[1] as APIApplicationCommandInteractionDataUserOption).value
      if (!leagueSettings?.commands?.madden_league?.league_id) {
        throw new Error("No Madden league linked, setup the bot with your madden league first.")
      }
      if (!leagueSettings?.commands?.teams?.channel.id) {
        throw new Error("Teams not configured, run /teams configure first")
      }
      const leagueId = leagueSettings.commands.madden_league.league_id
      const teams = await MaddenDB.getLatestTeams(leagueId)
      const teamsToSearch = await teamSearchView.createView(leagueId)
      const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.9 })
      if (results.length < 1) {
        throw new Error(`Could not find team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs`)
      } else if (results.length > 1) {
        throw new Error(`Found more than one  team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs.Found teams: ${results.map(t => t.obj.displayName).join(", ")} `)
      }
      const assignedTeam = results[0].obj
      const role = (teamsCommand?.options?.[2] as APIApplicationCommandInteractionDataRoleOption)?.value
      const roleAssignment = role ? { discord_role: { id: role, id_type: DiscordIdType.ROLE } } : {}
      const assignments = { ...leagueSettings.commands.teams?.assignments, [teams.getTeamForId(assignedTeam.id).teamId]: { discord_user: { id: user, id_type: DiscordIdType.USER }, ...roleAssignment } }
      leagueSettings.commands.teams.assignments = assignments
      await db.collection("league_settings").doc(guild_id).set({
        commands: {
          teams: {
            assignments: assignments
          }
        }
      }, { merge: true })
      const message = createTeamsMessage(leagueSettings, teams.getLatestTeams())
      try {
        await client.requestDiscord(`channels/${leagueSettings.commands.teams.channel.id}/messages/${leagueSettings.commands.teams.messageId.id} `,
          { method: "PATCH", body: { content: message, allowed_mentions: { parse: [] } } })
        respond(ctx, createMessageResponse("Team Assigned"))
      } catch (e) {
        respond(ctx, createMessageResponse("Could not update teams message, this could be a permission issue. The assignment was saved, Error: " + e))
      }
    } else if (subCommand === "free") {
      if (!teamsCommand.options || !teamsCommand.options[0]) {
        throw new Error("teams free misconfigured")
      }
      const teamSearchPhrase = (teamsCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value.toLowerCase()
      if (!leagueSettings?.commands?.madden_league?.league_id) {
        throw new Error("No Madden league linked, setup the bot with your madden league first.")
      }
      if (!leagueSettings.commands.teams?.channel.id) {
        throw new Error("Teams not configured, run /teams configure first")
      }
      const leagueId = leagueSettings.commands.madden_league.league_id
      const teams = await MaddenClient.getLatestTeams(leagueId)
      const teamsToSearch = await teamSearchView.createView(leagueId)
      const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.9 })
      if (results.length < 1) {
        throw new Error(`Could not find team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs`)
      } else if (results.length > 1) {
        throw new Error(`Found more than one  team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs.Found teams: ${results.map(t => t.obj.displayName).join(", ")}`)
      }
      const assignedTeam = results[0].obj
      const teamIdToDelete = teams.getTeamForId(assignedTeam.id).teamId
      const currentAssignments = { ...leagueSettings.commands.teams.assignments }
      delete currentAssignments[`${teamIdToDelete}`]
      leagueSettings.commands.teams.assignments = currentAssignments
      await db.collection("league_settings").doc(guild_id).update({
        [`commands.teams.assignments.${teamIdToDelete}`]: FieldValue.delete()
      })
      const message = createTeamsMessage(leagueSettings, teams.getLatestTeams())
      try {
        await client.requestDiscord(`channels/${leagueSettings.commands.teams.channel.id}/messages/${leagueSettings.commands.teams.messageId.id} `,
          { method: "PATCH", body: { content: message, allowed_mentions: { parse: [] } } })
        respond(ctx, createMessageResponse("Team Freed"))
      } catch (e) {
        respond(ctx, createMessageResponse("Could not update teams message, this could be a permission issue. The assignment was freed1, Error: " + e))
      }
    } else if (subCommand === "reset") {
      if (!leagueSettings.commands.teams?.channel.id) {
        throw new Error("Teams not configured, run /teams configure first")
      }
      await db.collection("league_settings").doc(guild_id).update({
        [`commands.teams.assignments`]: FieldValue.delete()
      })
      if (leagueSettings.commands.teams?.assignments) {
        leagueSettings.commands.teams.assignments = {}
      }
      const message = await fetchTeamsMessage(leagueSettings)
      try {
        await client.requestDiscord(`channels/${leagueSettings.commands.teams.channel.id}/messages/${leagueSettings.commands.teams.messageId.id}`,
          { method: "PATCH", body: { content: message, allowed_mentions: { parse: [] } } })
        respond(ctx, createMessageResponse("Team Assignments Reset"))
      } catch (e) {
        respond(ctx, createMessageResponse("Could not update teams message, this could be a permission issue. The teams were still reset, Error: " + e))
      }
    } else {
      throw new Error(`teams ${subCommand} misconfigured`)
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "teams",
      description: "Displays the current teams in your league with the members the teams are assigned to",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "assign",
          description: "assign a discord user to the specified team",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "team",
              description:
                "the team city, name, or abbreviation. Ex: Buccaneers, TB, Tampa Bay",
              required: true,
              autocomplete: true
            },
            {
              type: ApplicationCommandOptionType.User,
              name: "user",
              description: "the discord member you want to assign to this team",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Role,
              name: "role",
              description: "the role that will be tracked with this team",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "free",
          description: "remove the user assigned to this team, making the team open",
          options: [
            {
              type: ApplicationCommandOptionType.String,
              name: "team",
              description:
                "the team city, name, or abbreviation. Ex: Buccaneers, TB, Tampa Bay",
              required: true,
              autocomplete: true
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "sets channel that will display all the teams and the members assigned to them",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "channel",
              description: "channel to display your teams in",
              required: true,
              channel_types: [ChannelType.GuildText],
            },
            {
              type: ApplicationCommandOptionType.Boolean,
              name: "use_role_updates",
              description: "turn on role updates to auto assign teams based on team roles",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "reset",
          description: "resets all teams assignments making them all open",
          options: [],
        },
      ],
      type: 1,
    }
  },
  async choices(command: Autocomplete) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("logger command not defined properly")
    }
    const options = command.data.options
    const teamsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = teamsCommand.name
    const doc = await firebaseDB.collection("league_settings").doc(guild_id).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    const leagueId = leagueSettings?.commands?.madden_league?.league_id
    if (leagueId && (teamsCommand?.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.focused && teamsCommand?.options?.[0]?.value) {
      const teamSearchPhrase = teamsCommand.options[0].value as string
      const teams = await MaddenClient.getLatestTeams(leagueId)
      const teamsToSearch = await teamSearchView.createView(leagueId)
      const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.4, limit: 25 })
      return results.map(r => ({ name: r.obj.displayName, value: r.obj.displayName }))
    } else {
      return []
    }
  }
} as CommandHandler | AutocompleteHandler
