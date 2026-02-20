import { ParameterizedContext } from "koa"
import { APIChatInputApplicationCommandInteractionData, APIInteractionGuildMember } from "discord-api-types/payloads"
import { APIAutocompleteApplicationCommandInteractionData, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { createMessageResponse, respond, DiscordClient, CommandMode } from "./discord_utils"
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
import { APIMessageComponentInteractionData } from "discord-api-types/v9"
import { discordCommandsCounter } from "../debug/metrics"

export type Command = { command_name: string, token: string, guild_id: string, data: APIChatInputApplicationCommandInteractionData, member: APIInteractionGuildMember }
export type Autocomplete = { command_name: string, guild_id: string, data: APIAutocompleteApplicationCommandInteractionData }
export type MessageComponentInteraction = { custom_id: string, token: string, data: APIMessageComponentInteractionData, guild_id: string }
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
  "stats": statsHandler
}

const AutocompleteCommands: AutocompleteHandlers = {
  "teams": teamsHandler,
  "player": playerHandler,
  "schedule": schedulesHandler
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
      const res = await handler.handleCommand(command, discordClient)
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
  if (handler) {
    try {
      discordCommandsCounter.inc({ command_name: command.command_name, command_type: "AUTOCOMPLETE" })
      const choices = await handler.choices(command)
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
  const handler = MessageComponents[custom_id]
  if (handler) {
    try {
      discordCommandsCounter.inc({ command_name: custom_id, command_type: "MESSAGE_COMPONENT" })
      const body = await handler.handleInteraction(interaction, client)
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
        const body = await playerHandler.handleInteraction(interaction, client)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.t != null) {
        discordCommandsCounter.inc({ command_name: "BROADCAST", command_type: "MESSAGE_COMPONENT" })
        const body = await broadcastsHandler.handleInteraction(interaction, client)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.p != null && parsedCustomId.si != null) {
        discordCommandsCounter.inc({ command_name: "SIMS", command_type: "MESSAGE_COMPONENT" })
        const body = await simsHandler.handleInteraction(interaction, client)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      }
      else if (parsedCustomId.si != null) {
        discordCommandsCounter.inc({ command_name: "SCHEDULE", command_type: "MESSAGE_COMPONENT" })
        const body = await schedulesHandler.handleInteraction(interaction, client)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.f != null) {
        discordCommandsCounter.inc({ command_name: "STANDINGS", command_type: "MESSAGE_COMPONENT" })
        const body = await standingsHandler.handleInteraction(interaction, client)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = body
      } else if (parsedCustomId.st != null && parsedCustomId.p != null) {
        discordCommandsCounter.inc({ command_name: "STATS", command_type: "MESSAGE_COMPONENT" })
        const body = await statsHandler.handleInteraction(interaction, client)
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
      await client.handleSlashCommand(mode, handler.commandDefinition(), guildId)
      console.log(`${mode} ${name}`)
    }
  }))
}
