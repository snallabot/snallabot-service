import { ParameterizedContext } from "koa"
import { CommandHandler, Command, AutocompleteHandler, Autocomplete } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, SnallabotDiscordError, NoConnectedLeagueError } from "../discord_utils"
import { APIApplicationCommandInteractionDataAttachmentOption, APIApplicationCommandInteractionDataBooleanOption, APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataRoleOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandOption, APIApplicationCommandInteractionDataUserOption, ApplicationCommandOptionType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { FieldValue, Firestore } from "firebase-admin/firestore"
import LeagueSettingsDB, { ChannelId, DiscordIdType, LeagueSettings, MessageId, TeamAssignments } from "../settings_db"
import MaddenClient, { TeamList } from "../../db/madden_db"
import { Team } from "../../export/madden_league_types"
import { teamSearchView, discordLeagueView } from "../../db/view"
import fuzzysort from "fuzzysort"
import MaddenDB from "../../db/madden_db"


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
    return createTeamsMessage(settings, teams)
  } else {
    return "# Teams\nNo Madden League connected. Connect Snallabot to your league and reconfigure"
  }
}

function createTeamsMessage(settings: LeagueSettings, teams: TeamList): string {
  if (settings?.commands?.madden_league?.league_id) {
    return formatTeamMessage(teams.getLatestTeams(), teams.getLatestTeamAssignments(settings.commands.teams?.assignments || {}))
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
    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(guild_id)
    if (subCommand === "configure") {
      if (!teamsCommand.options || !teamsCommand.options[0]) {
        throw new Error("teams configure misconfigured")
      }
      const channel: ChannelId = { id: (teamsCommand.options[0] as APIApplicationCommandInteractionDataChannelOption).value, id_type: DiscordIdType.CHANNEL }
      const useRoleUpdates = (teamsCommand.options?.[1] as APIApplicationCommandInteractionDataBooleanOption)?.value || false
      const oldChannelId = leagueSettings?.commands?.teams?.channel
      const oldMessageId = leagueSettings?.commands?.teams?.messageId
      if (oldChannelId && oldChannelId !== channel) {
        const message = await fetchTeamsMessage(leagueSettings)
        try {
          await client.deleteMessage(oldChannelId, oldMessageId || { id: "", id_type: DiscordIdType.MESSAGE })
        } catch (e) { }
        const newMessageId = await client.createMessage(channel, message, [])
        await LeagueSettingsDB.updateTeamConfiguration(guild_id, {
          channel: channel,
          messageId: newMessageId,
          useRoleUpdates: useRoleUpdates,
          assignments: leagueSettings?.commands?.teams?.assignments || {},
        })

        respond(ctx, createMessageResponse("Teams Configured"))
      } else {
        const oldMessageId = leagueSettings?.commands?.teams?.messageId
        if (leagueSettings.commands.teams && oldMessageId) {
          try {
            const messageExists = await client.checkMessageExists(channel, oldMessageId)
            if (messageExists) {
              await LeagueSettingsDB.updateTeamConfiguration(guild_id, {
                ...leagueSettings.commands.teams,
                useRoleUpdates: useRoleUpdates,
                assignments: leagueSettings?.commands.teams?.assignments || {},
              })
              const message = await fetchTeamsMessage(leagueSettings)
              await client.editMessage(channel, oldMessageId, message, [])
              respond(ctx, createMessageResponse("Teams Configured"))
            }
            return
          } catch (e) {
            console.debug(e)
          }
        }
        const message = await fetchTeamsMessage(leagueSettings)
        const messageId = await client.createMessage(channel, message, [])
        await LeagueSettingsDB.updateTeamConfiguration(guild_id, {
          channel: channel,
          messageId: messageId,
          useRoleUpdates: useRoleUpdates,
          assignments: leagueSettings?.commands?.teams?.assignments || {},
        })
        respond(ctx, createMessageResponse("Teams Configured"))
      }
    } else if (subCommand === "assign") {
      if (!teamsCommand.options || !teamsCommand.options[0] || !teamsCommand.options[1]) {
        throw new Error("teams assign misconfigured")
      }
      const teamSearchPhrase = (teamsCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value.toLowerCase()
      const user = (teamsCommand.options[1] as APIApplicationCommandInteractionDataUserOption).value
      if (!leagueSettings?.commands?.madden_league?.league_id) {
        throw new NoConnectedLeagueError(guild_id)
      }
      if (!leagueSettings?.commands?.teams?.channel.id) {
        throw new Error("Teams not configured, run /teams configure first")
      }
      const leagueId = leagueSettings.commands.madden_league.league_id
      const teams = await MaddenDB.getLatestTeams(leagueId)
      const teamsToSearch = await teamSearchView.createView(leagueId)
      if (!teamsToSearch) {
        throw new Error("no teams found")
      }
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
      await LeagueSettingsDB.updateAssignment(guild_id, assignments)
      const message = createTeamsMessage(leagueSettings, teams)
      try {
        await client.editMessage(leagueSettings.commands.teams.channel, leagueSettings.commands.teams.messageId, message, [])
        respond(ctx, createMessageResponse("Team Assigned"))
      } catch (e) {
        if (e instanceof SnallabotDiscordError) {
          if (e.isDeletedChannel()) {
            respond(ctx, createMessageResponse("The assignment was saved, but the channel the teams message was in got deleted. Do /teams configure again to pick a new one Error: " + e))
          } else if (e.isDeletedMessage()) {
            respond(ctx, createMessageResponse("The assignment was saved, but my original message was deleted. do /teams configure for me to resend it Error: " + e))
          } else {
            respond(ctx, createMessageResponse(`The assignment was saved, but I could not edit my message. Guidance: ${e.guidance} Error: ${e}`))
          }
        } else {
          respond(ctx, createMessageResponse("Could not update teams message. The assignment was saved, Error: " + e))
        }
      }
    } else if (subCommand === "free") {
      if (!teamsCommand.options || !teamsCommand.options[0]) {
        throw new Error("teams free misconfigured")
      }
      const teamSearchPhrase = (teamsCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value.toLowerCase()
      if (!leagueSettings?.commands?.madden_league?.league_id) {
        throw new NoConnectedLeagueError(guild_id)
      }
      if (!leagueSettings.commands.teams?.channel.id) {
        throw new Error("Teams not configured, run /teams configure first")
      }
      const leagueId = leagueSettings.commands.madden_league.league_id
      const [teams, teamsToSearch] = await Promise.all([MaddenClient.getLatestTeams(leagueId), teamSearchView.createView(leagueId)])
      if (!teamsToSearch) {
        throw new Error("no teams found")
      }
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
      await LeagueSettingsDB.removeAssignment(guild_id, teamIdToDelete)
      const message = createTeamsMessage(leagueSettings, teams)
      try {
        await client.editMessage(leagueSettings.commands.teams.channel, leagueSettings.commands.teams.messageId, message, [])
        respond(ctx, createMessageResponse("Team Freed"))
      } catch (e) {
        if (e instanceof SnallabotDiscordError) {
          if (e.isDeletedChannel()) {
            respond(ctx, createMessageResponse("The assignment was freed, but the channel the teams message was in got deleted. Do /teams configure again to pick a new one Error: " + e))
          } else if (e.isDeletedMessage()) {
            respond(ctx, createMessageResponse("The assignment was freed, but my original message was deleted. do /teams configure for me to resend it Error: " + e))
          } else {
            respond(ctx, createMessageResponse(`The assignment was freed, but I could not edit my message. Guidance: ${e.guidance} Error: ${e}`))
          }
        } else {
          respond(ctx, createMessageResponse("Could not update teams message. The assignment was freed, Error: " + e))
        }
      }
    } else if (subCommand === "reset") {
      if (!leagueSettings.commands.teams?.channel.id) {
        throw new Error("Teams not configured, run /teams configure first")
      }
      await LeagueSettingsDB.removeAllAssignments(guild_id)
      if (leagueSettings.commands.teams?.assignments) {
        leagueSettings.commands.teams.assignments = {}
      }
      const message = await fetchTeamsMessage(leagueSettings)
      try {
        await client.editMessage(leagueSettings.commands.teams.channel, leagueSettings.commands.teams.messageId, message, [])
        respond(ctx, createMessageResponse("Team Assignments Reset"))
      } catch (e) {
        if (e instanceof SnallabotDiscordError) {
          if (e.isDeletedChannel()) {
            respond(ctx, createMessageResponse("The assignment was reset, but the channel the teams message was in got deleted. Do /teams configure again to pick a new one Error: " + e))
          } else if (e.isDeletedMessage()) {
            respond(ctx, createMessageResponse("The assignment was reset, but my original message was deleted. do /teams configure for me to resend it Error: " + e))
          } else {
            respond(ctx, createMessageResponse(`The assignment was reset, but I could not edit my message. Guidance: ${e.guidance} Error: ${e}`))
          }
        } else {
          respond(ctx, createMessageResponse("Could not update teams message. The assignment was reset, Error: " + e))
        }

      }
    } else if (subCommand === "customize_logo") {
      if (!teamsCommand.options || !teamsCommand.options[0] || !teamsCommand.resolved) {
        throw new Error("teams customize_logo misconfigured")
      }
      console.log(teamsCommand)
      const teamSearchPhrase = (teamsCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value.toLowerCase()
      const image = (teamsCommand.options[1] as APIApplicationCommandInteractionDataAttachmentOption)
      if (!leagueSettings?.commands?.madden_league?.league_id) {
        throw new NoConnectedLeagueError(guild_id)
      }
      const leagueId = leagueSettings.commands.madden_league.league_id
      const [teams, teamsToSearch] = await Promise.all([MaddenClient.getLatestTeams(leagueId), teamSearchView.createView(leagueId)])
      if (!teamsToSearch) {
        throw new Error("no teams found")
      }
      const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.9 })
      if (results.length < 1) {
        throw new Error(`Could not find team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs`)
      } else if (results.length > 1) {
        throw new Error(`Found more than one  team for phrase ${teamSearchPhrase}.Enter a team name, city, abbreviation, or nickname.Examples: Buccaneers, TB, Tampa Bay, Bucs.Found teams: ${results.map(t => t.obj.displayName).join(", ")}`)
      }
      const assignedTeam = results[0].obj
      const teamIdToCustomize = teams.getTeamForId(assignedTeam.id).teamId
      console.log(image)
      respond(ctx, createMessageResponse("wip"))
    }
    else {
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
          name: "customize_logo",
          description: "customize the logo for a specific team",
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
              type: ApplicationCommandOptionType.Attachment,
              name: "image_file",
              description: "image file to use as the team logo",
              required: true,
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
    const view = await discordLeagueView.createView(guild_id)
    const leagueId = view?.leagueId
    if (leagueId && (teamsCommand?.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.focused && teamsCommand?.options?.[0]?.value) {
      const teamSearchPhrase = teamsCommand.options[0].value as string
      const teamsToSearch = await teamSearchView.createView(leagueId)
      if (teamsToSearch) {
        const results = fuzzysort.go(teamSearchPhrase, Object.values(teamsToSearch), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.4, limit: 25 })
        return results.map(r => ({ name: r.obj.displayName, value: r.obj.displayName }))
      }
    }
    return []
  }
} as CommandHandler & AutocompleteHandler
