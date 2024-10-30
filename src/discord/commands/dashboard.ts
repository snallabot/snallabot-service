import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"

export default {
    async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
        const { guild_id } = command
        respond(ctx, createMessageResponse(`Snallabot Dashboard: https://nallapareddy.com/snallabot/?league=${guild_id}`))
    },
    commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
        return {
            name: "dashboard",
            description: "snallabot dashboard link",
            type: ApplicationCommandType.ChatInput,
        }
    }
} as CommandHandler
