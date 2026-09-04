import { ParameterizedContext } from "koa"
import { APIChatInputApplicationCommandInteractionData, APIInteractionGuildMember } from "discord-api-types/payloads"
import { APIApplicationCommandInteractionDataOption, APIApplicationCommandOption, APIApplicationCommandStringOption, ApplicationCommandOptionType, APIAutocompleteApplicationCommandInteractionData, InteractionResponseType, InteractionType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { createMessageResponse, respond, DiscordClient, CommandMode, NoConnectedLeagueError } from "./discord_utils"
import { Firestore } from "firebase-admin/firestore"
import leagueExportHandler from "./commands/league_export"
import testHandler from "./commands/test"
import dashboardHandler from "./commands/dashboard"
import loggerHandler from "./commands/logger"
import waitlistHandler from "./commands/waitlist"
import broadcastsHandler from "./commands/broadcasts"
import streamsHandler from "./commands/streams"
import teamsHandler from "./commands/teams"
import schedulesHandler from "./commands/schedule"
import gameChannelHandler from "./commands/game_channels"
import exportHandler from "./commands/export"
import standingsHandler from "./commands/standings"
import playerHandler from "./commands/player"
import gameStatsHandler from "./commands/game_stats"
import bracketHandler from "./commands/bracket"
import simsHandler from "./commands/sims"
import playerConfigurationHandler from "./commands/player_configuration"
import statsHandler from "./commands/stats"
import tradeHandler from "./commands/trade"
import { APIMessageComponentInteractionData } from "discord-api-types/v9"
import { discordCommandsCounter } from "../debug/metrics"
import { discordLeagueView } from "../db/view"

export type Command = { command_name: string, token: string, guild_id: string, league_id?: string, data: APIChatInputApplicationCommandInteractionData, member: APIInteractionGuildMember }
export type Autocomplete = { command_name: string, guild_id: string, league_id?: string, data: APIAutocompleteApplicationCommandInteractionData }
export type MessageComponentInteraction = { custom_id: string, token: string, data: APIMessageComponentInteractionData, guild_id: string, member: APIInteractionGuildMember, league_id?: string }

// Commands which read or mutate league-specific settings/data. Dashboard, test,
// and league_export stay exempt because they are used before a league exists.
const LEAGUE_SELECTABLE_COMMANDS = new Set([
  "game_channels", "teams", "logger",
  "standings", "schedule", "player", "player_configuration", "stats",
  "playoffs", "export", "sims"
])

function findOption<Type extends InteractionType>(
  options: readonly APIApplicationCommandInteractionDataOption<Type>[] | undefined,
  name: string
): APIApplicationCommandInteractionDataOption<Type> | undefined {
  for (const option of options || []) {
    if (option.name === name) return option
    const nested = "options" in option ? findOption(option.options, name) : undefined
    if (nested) return nested
  }
}

async function connectedLeagues(guildId: string) {
  return (await discordLeagueView.createView(guildId))?.leagues || []
}

async function resolveLeagueId(guildId: string, requestedLeague?: string): Promise<string> {
  const connection = await discordLeagueView.createView(guildId)
  const leagueIds = connection?.leagues.map(league => league.leagueId) || []
  if (requestedLeague) {
    if (!leagueIds.includes(requestedLeague)) {
      throw new Error(`League ${requestedLeague} is not connected to this Discord server`)
    }
    return requestedLeague
  }

  const activeLeague = connection?.activeLeague?.league_id
  if (!activeLeague) {
    throw new NoConnectedLeagueError(guildId)
  }
  if (!leagueIds.includes(activeLeague)) {
    throw new Error(`Default league ${activeLeague} is not connected to this Discord server`)
  }
  return activeLeague
}

function withoutLeagueSelector<Type extends InteractionType>(
  options: readonly APIApplicationCommandInteractionDataOption<Type>[] | undefined
): APIApplicationCommandInteractionDataOption<Type>[] | undefined {
  if (!options) return undefined
  return options
    .filter(option => option.name !== "league")
    .map(option => {
      if (option.type === ApplicationCommandOptionType.Subcommand) {
        return {
          ...option,
          options: option.options?.filter(nestedOption => nestedOption.name !== "league")
        }
      }
      if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
        return {
          ...option,
          options: option.options
            .filter(subcommand => subcommand.name !== "league")
            .map(subcommand => ({
              ...subcommand,
              options: subcommand.options?.filter(nestedOption => nestedOption.name !== "league")
            }))
        }
      }
      return option
    })
}

function addLeagueSelector(definition: RESTPostAPIApplicationCommandsJSONBody): RESTPostAPIApplicationCommandsJSONBody {
  if (!LEAGUE_SELECTABLE_COMMANDS.has(definition.name)) return definition
  const leagueOption: APIApplicationCommandStringOption = {
    type: ApplicationCommandOptionType.String,
    name: "league",
    description: "Madden league to use; defaults to this server's default league",
    required: false,
    autocomplete: true
  }
  const options: APIApplicationCommandOption[] = [...(definition.options || [])]
  const hasSubcommands = options.some(option => option.type === ApplicationCommandOptionType.Subcommand || option.type === ApplicationCommandOptionType.SubcommandGroup)
  if (!hasSubcommands) return { ...definition, options: [...options, leagueOption] }
  return {
    ...definition,
    options: options.map(option => {
      if (option.type === ApplicationCommandOptionType.Subcommand) {
        return { ...option, options: [...(option.options || []), leagueOption] }
      }
      if (option.type === ApplicationCommandOptionType.SubcommandGroup) {
        return { ...option, options: (option.options || []).map(sub => ({ ...sub, options: [...(sub.options || []), leagueOption] })) }
      }
      return option
    })
  }
}

export interface CommandHandler {
  handleCommand(command: Command, client: DiscordClient): Promise<any>
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody
}

export interface AutocompleteHandler {
  choices(query: Autocomplete): Promise<{ name: string, value: string }[]>
}
export interface MessageComponentHandler {
  handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient): Promise<any>
}

export type CommandsHandler = { [key: string]: CommandHandler | undefined }
export type AutocompleteHandlers = Record<string, AutocompleteHandler>
export type MessageComponentHandlers = Record<string, MessageComponentHandler>
const SlashCommands: CommandsHandler = {
  "league_export": leagueExportHandler,
  "dashboard": dashboardHandler,
  "game_channels": gameChannelHandler,
  "teams": teamsHandler,
  "streams": streamsHandler,
  "broadcasts": broadcastsHandler,
  "waitlist": waitlistHandler,
  "schedule": schedulesHandler,
  "logger": loggerHandler,
  "export": exportHandler,
  "test": testHandler,
  "standings": standingsHandler,
  "player": playerHandler,
  "player_configuration": playerConfigurationHandler,
  "playoffs": bracketHandler,
  "sims": simsHandler,
  "stats": statsHandler,
  "trade": tradeHandler
}

const AutocompleteCommands: AutocompleteHandlers = {
  "teams": teamsHandler,
  "player": playerHandler,
  "schedule": schedulesHandler,
  "trade": tradeHandler
}

const MessageComponents: MessageComponentHandlers = {
  "player_card": playerHandler,
  "week_selector": schedulesHandler,
  "season_selector": schedulesHandler,
  "team_season_selector": schedulesHandler,
  "game_stats": gameStatsHandler,
  "standings_filter": standingsHandler,
  "sims_season_selector": simsHandler,
  "season_stat_type_selector": statsHandler,
  "season_season_selector": statsHandler,
  "weekly_stat_type_selector": statsHandler,
  "weekly_week_selector": statsHandler,
  "weekly_season_selector": statsHandler
}

export async function handleCommand(command: Command, ctx: ParameterizedContext, discordClient: DiscordClient, db: Firestore) {
  const commandName = command.command_name
  const handler = SlashCommands[commandName]
  if (handler) {
    try {
      discordCommandsCounter.inc({ command_name: command.command_name, command_type: "SLASH" })
      const isLeagueSelectable = LEAGUE_SELECTABLE_COMMANDS.has(commandName)
      const leagueOption = isLeagueSelectable ? findOption(command.data.options, "league") : undefined
      const requestedLeague = leagueOption?.type === ApplicationCommandOptionType.String ? leagueOption.value : undefined
      const resolvedLeague = isLeagueSelectable
        ? await resolveLeagueId(command.guild_id, requestedLeague)
        : undefined
      // Keep positional option indexes stable while passing the selected league
      // explicitly to the command handler.
      const handlerCommand = {
        ...command,
        ...(isLeagueSelectable ? { league_id: resolvedLeague } : {}),
        data: { ...command.data, options: withoutLeagueSelector(command.data.options) }
      }
      const res = await handler.handleCommand(handlerCommand, discordClient)
      respond(ctx, res)
    } catch (e) {
      const error = e as Error
      ctx.status = 200
      respond(ctx, createMessageResponse(`Error in ${commandName}: ${error.message}`))
    }
  } else {
    ctx.status = 200
    respond(ctx, createMessageResponse(`command ${commandName} not implemented`))
  }
}

export async function handleAutocomplete(command: Autocomplete, ctx: ParameterizedContext) {
  const commandName = command.command_name
  const handler = AutocompleteCommands[commandName]
  const focused = findOption(command.data.options, "league")
  if (focused?.type === ApplicationCommandOptionType.String && focused.focused && LEAGUE_SELECTABLE_COMMANDS.has(commandName)) {
    const query = `${focused.value || ""}`.toLowerCase()
    const leagues = await connectedLeagues(command.guild_id)
    ctx.status = 200
    ctx.set("Content-Type", "application/json")
    ctx.body = {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: {
        choices: leagues
          .filter(league => league.leagueId.toLowerCase().includes(query) || league.leagueName.toLowerCase().includes(query))
          .slice(0, 25)
          .map(league => ({ name: league.leagueName, value: league.leagueId }))
      }
    }
    return
  }
  if (handler) {
    try {
      discordCommandsCounter.inc({ command_name: command.command_name, command_type: "AUTOCOMPLETE" })
      const isLeagueSelectable = LEAGUE_SELECTABLE_COMMANDS.has(commandName)
      const leagueOption = isLeagueSelectable ? findOption(command.data.options, "league") : undefined
      const requestedLeague = leagueOption?.type === ApplicationCommandOptionType.String ? leagueOption.value : undefined
      const resolvedLeague = isLeagueSelectable
        ? await resolveLeagueId(command.guild_id, requestedLeague)
        : undefined
      const handlerCommand = {
        ...command,
        ...(isLeagueSelectable ? { league_id: resolvedLeague } : {}),
        data: { ...command.data, options: withoutLeagueSelector(command.data.options) }
      }
      const choices = await handler.choices(handlerCommand)
      ctx.status = 200
      ctx.set("Content-Type", "application/json")
      ctx.body = {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: choices
        }
      }
    } catch (e) {
      ctx.status = 200
      ctx.set("Content-Type", "application/json")
      ctx.body = {
        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
        data: {
          choices: []
        }
      }
    }
  } else {
    ctx.status = 200
    ctx.set("Content-Type", "application/json")
    ctx.body = {
      type: InteractionResponseType.ApplicationCommandAutocompleteResult,
      data: {
        choices: []
      }
    }
  }
}

export async function handleMessageComponent(interaction: MessageComponentInteraction, ctx: ParameterizedContext, client: DiscordClient) {
  const custom_id = interaction.custom_id
  let requestedLeague: string | undefined
  try {
    const componentData = custom_id.startsWith("{")
      ? JSON.parse(custom_id)
      : JSON.parse(("values" in interaction.data ? interaction.data.values[0] : undefined) || "{}")
    requestedLeague = componentData.l || componentData.q?.l
  } catch (_) {
    // Components that predate multi-league support simply use the active league.
  }
  const invoke = async (componentHandler: MessageComponentHandler) => {
    if (requestedLeague) {
      const leagueIds = (await connectedLeagues(interaction.guild_id)).map(league => league.leagueId)
      if (!leagueIds.includes(requestedLeague)) throw new Error(`League ${requestedLeague} is not connected to this Discord server`)
    }
    return componentHandler.handleInteraction({ ...interaction, league_id: requestedLeague }, client)
  }
  const handler = custom_id.startsWith("trade_vote:") ? tradeHandler : MessageComponents[custom_id]
  if (handler) {
    try {
      discordCommandsCounter.inc({ command_name: custom_id, command_type: "MESSAGE_COMPONENT" })
      const body = await invoke(handler)
      ctx.status = 200
      ctx.set("Content-Type", "application/json")
      ctx.body = body
    } catch (e) {
      const error = e as Error
      ctx.status = 500
    }
  } else {
    try {
      // TODO use typeof and fix this, its bad 
      const parsedCustomId = JSON.parse(custom_id)
      if (parsedCustomId.q != null) {
        discordCommandsCounter.inc({ command_name: "PLAYER_LIST", command_type: "MESSAGE_COMPONENT" })
        const body = await invoke(playerHandler)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.t != null) {
        discordCommandsCounter.inc({ command_name: "BROADCAST", command_type: "MESSAGE_COMPONENT" })
        const body = await invoke(broadcastsHandler)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.p != null && parsedCustomId.si != null) {
        discordCommandsCounter.inc({ command_name: "SIMS", command_type: "MESSAGE_COMPONENT" })
        const body = await invoke(simsHandler)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      }
      else if (parsedCustomId.si != null) {
        discordCommandsCounter.inc({ command_name: "SCHEDULE", command_type: "MESSAGE_COMPONENT" })
        const body = await invoke(schedulesHandler)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.f != null) {
        discordCommandsCounter.inc({ command_name: "STANDINGS", command_type: "MESSAGE_COMPONENT" })
        const body = await invoke(standingsHandler)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.st != null && parsedCustomId.p != null) {
        discordCommandsCounter.inc({ command_name: "STATS", command_type: "MESSAGE_COMPONENT" })
        const body = await invoke(statsHandler)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      }
      else {
        ctx.status = 500
      }
    } catch (e) {
      ctx.status = 500

    }
  }
}


export async function commandsInstaller(client: DiscordClient, commandNames: string[], mode: CommandMode, guildId?: string) {
  const commandsToHandle = commandNames.length === 0 ? Object.keys(SlashCommands) : commandNames
  await Promise.all(commandsToHandle.map(async (name) => {
    const handler = SlashCommands[name]
    if (handler) {
      await client.handleSlashCommand(mode, addLeagueSelector(handler.commandDefinition()), guildId)
      console.log(`${mode} ${name}`)
    }
  }))
}
