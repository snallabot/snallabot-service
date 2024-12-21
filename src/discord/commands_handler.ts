import { ParameterizedContext } from "koa"
import { APIChatInputApplicationCommandInteractionData, APIInteractionGuildMember } from "discord-api-types/payloads"
import { RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
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

export type Command = { command_name: string, token: string, guild_id: string, data: APIChatInputApplicationCommandInteractionData, member: APIInteractionGuildMember }

export interface CommandHandler {
    handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext): Promise<void>
    commandDefinition(): RESTPostAPIApplicationCommandsJSONBody
}

export type CommandsHandler = { [key: string]: CommandHandler | undefined }

const SlashCommands = {
    "league_export": leagueExportHandler,
    "dashboard": dashboardHandler,
    "game_channels": gameChannelHandler,
    "teams": teamsHandler,
    "streams": streamsHandler,
    "broadcasts": broadcastsHandler,
    "waitlist": waitlistHandler,
    "schedule": schedulesHandler,
    "logger": loggerHandler,
    "export": undefined,
    "test": testHandler
} as CommandsHandler

export async function handleCommand(command: Command, ctx: ParameterizedContext, discordClient: DiscordClient, db: Firestore) {
    const commandName = command.command_name
    const handler = SlashCommands[commandName]
    if (handler) {
        try {
            await handler.handleCommand(command, discordClient, db, ctx)
        } catch (e) {
            ctx.status = 200
            respond(ctx, createMessageResponse(`Fatal Error in ${commandName}: ${e.message}`))
            console.error(e)

        }
    } else {
        ctx.status = 200
        respond(ctx, createMessageResponse(`command ${commandName} not implemented`))
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
