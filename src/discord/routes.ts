import { ParameterizedContext } from "koa"
import Router from "@koa/router"
import { CommandMode, DiscordClient, createClient } from "./discord_utils"
import { APIInteraction, InteractionType, InteractionResponseType, APIChatInputApplicationCommandGuildInteraction } from "discord-api-types/payloads"
import db from "../db/firebase"
import EventDB, { StoredEvent } from "../db/events_db"
import { handleCommand, commandsInstaller } from "./commands_handler"
import { BroadcastConfigurationEvent, MaddenBroadcastEvent } from "../db/events"

const router = new Router({ prefix: "/discord/webhook" })

if (!process.env.PUBLIC_KEY) {
    throw new Error("No Public Key passed for interaction verification")
}
if (!process.env.TEST_PUBLIC_KEY) {
    throw new Error("No Test Public Key passed for interaction verification")
}
if (!process.env.DISCORD_TOKEN) {
    throw new Error("No Discord Token passed for interaction verification")
}
if (!process.env.TEST_DISCORD_TOKEN) {
    throw new Error("No Test Discord Token passed for interaction verification")
}
if (!process.env.APP_ID) {
    throw new Error("No App Id passed for interaction verification")
}
if (!process.env.TEST_APP_ID) {
    throw new Error("No Test App Id passed for interaction verification")
}

const prodSettings = { publicKey: process.env.PUBLIC_KEY, botToken: process.env.DISCORD_TOKEN, appId: process.env.APP_ID }
const testSettings = { publicKey: process.env.TEST_PUBLIC_KEY, botToken: process.env.TEST_DISCORD_TOKEN, appId: process.env.TEST_APP_ID }

const prodClient = createClient(prodSettings)
const testClient = createClient(testSettings)

async function handleInteraction(ctx: ParameterizedContext, client: DiscordClient) {
    const verified = await client.interactionVerifier(ctx)
    if (!verified) {
        ctx.status = 401
        return
    }
    const interaction = ctx.request.body as APIInteraction
    const { type: interactionType } = interaction
    if (interactionType === InteractionType.Ping) {
        ctx.status = 200
        ctx.body = { type: InteractionResponseType.Pong }
        return
    }
    if (interactionType === InteractionType.ApplicationCommand) {

        const slashCommandInteraction = interaction as APIChatInputApplicationCommandGuildInteraction
        const { token, guild_id, data, member } = slashCommandInteraction
        const { name } = data
        await handleCommand({ command_name: name, token, guild_id, data, member }, ctx, client, db)
        return
    }
    // anything else fail the command
    ctx.status = 404
}

type CommandsHandlerRequest = { commandNames?: string[], mode: CommandMode, guildId?: string }

router.post("/slashCommand", async (ctx) => {
    await handleInteraction(ctx, prodClient)
}).post("/testSlashCommand", async (ctx) => {
    await handleInteraction(ctx, testClient)
}).post("/productionCommandsHandler", async (ctx) => {
    const req = ctx.request.body as CommandsHandlerRequest
    await commandsInstaller(prodClient, req.commandNames || [], req.mode, req.guildId)
}).post("/testCommandsHandler", async (ctx) => {
    const req = ctx.request.body as CommandsHandlerRequest
    await commandsInstaller(testClient, req.commandNames || [], req.mode, req.guildId)
    ctx.status = 200
})
EventDB.on<MaddenBroadcastEvent>("MADDEN_BROADCAST", async (events) => {
    events.map(async broadcastEvent => {
        const discordServer = broadcastEvent.key
        const broadcastEvents = await EventDB.queryEvents<BroadcastConfigurationEvent>(discordServer, "BROADCAST_CONFIGURATION", new Date(0), {}, 1)
        const sortedEvents = broadcastEvents.sort((a: StoredEvent<BroadcastConfigurationEvent>, b: StoredEvent<BroadcastConfigurationEvent>) => b.timestamp.getTime() - a.timestamp.getTime())
        if (sortedEvents.length === 0) {
            console.error(`${discordServer} is not configured for Broadcasts`)
        } else {
            const configuration = sortedEvents[0]
            const channel = configuration.channel_id
            const role = configuration.role ? `<@&${configuration.role}>` : ""
            await prodClient.requestDiscord(`channels/${channel}/messages`, {
                method: "POST",
                body: {
                    content: `${role} ${broadcastEvent.title}\n\n${broadcastEvent.video}`
                }
            })
        }
    })
})

export default router
