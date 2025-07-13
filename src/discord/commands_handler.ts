import { ParameterizedContext } from "koa"
import { APIChatInputApplicationCommandInteractionData, APIInteractionGuildMember } from "discord-api-types/payloads"
import { APIApplicationCommandOptionChoice, APIAutocompleteApplicationCommandInteractionData, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { createMessageResponse, respond, DiscordClient, CommandMode, SnallabotDiscordError } from "./discord_utils"
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
import { APIMessageComponentInteractionData } from "discord-api-types/v9"

export type Command = { command_name: string, token: string, guild_id: string, data: APIChatInputApplicationCommandInteractionData, member: APIInteractionGuildMember }
export type Autocomplete = { command_name: string, guild_id: string, data: APIAutocompleteApplicationCommandInteractionData }
export type MessageComponentInteraction = { custom_id: string, token: string, data: APIMessageComponentInteractionData, guild_id: string }
export interface CommandHandler {
  handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext): Promise<void>
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody
}

export interface AutocompleteHandler {
  choices(query: Autocomplete): Promise<{ name: string, value: string }[]>
}
export interface MessageComponentHandler {
  handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient): Promise<void>
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
  "player": playerHandler
}

const AutocompleteCommands: AutocompleteHandlers = {
  "teams": teamsHandler,
  "player": playerHandler
}

const MessageComponents: MessageComponentHandlers = {
  "player_card": playerHandler
}

export async function handleCommand(command: Command, ctx: ParameterizedContext, discordClient: DiscordClient, db: Firestore) {
  const commandName = command.command_name
  const handler = SlashCommands[commandName]
  if (handler) {
    try {
      await handler.handleCommand(command, discordClient, db, ctx)
    } catch (e) {
      const error = e as Error
      ctx.status = 200
      if (error instanceof SnallabotDiscordError) {
        respond(ctx, createMessageResponse(`Discord Error in ${commandName}: ${error.message} Guidance: ${error.guidance}`))
      } else {
        respond(ctx, createMessageResponse(`Fatal Error in ${commandName}: ${error.message}`))
      }
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
      await handler.handleInteraction(interaction, client)
      ctx.status = 200
      ctx.set("Content-Type", "application/json")
      ctx.body = {
        type: InteractionResponseType.DeferredMessageUpdate,
      }
    } catch (e) {
      const error = e as Error
      ctx.status = 500
      console.error(error)
    }
  } else {
    try {
      const parsedCustomId = JSON.parse(custom_id)
      if (parsedCustomId.q) {
        await playerHandler.handleInteraction(interaction, client)
        ctx.status = 200
        ctx.set("Content-Type", "application/json")
        ctx.body = {
          type: InteractionResponseType.DeferredMessageUpdate,
        }
      } else {
        ctx.status = 500
      }
    } catch (e) {
      ctx.status = 500
      console.error(e)
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
