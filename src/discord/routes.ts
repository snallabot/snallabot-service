import { ParameterizedContext } from "koa"
import Router from "@koa/router"
import { CommandMode, DiscordClient, createClient } from "./discord_utils"
import { APIInteraction, InteractionType, InteractionResponseType, APIChatInputApplicationCommandGuildInteraction } from "discord-api-types/payloads"
import db from "../db/firebase"
import EventDB, { StoredEvent } from "../db/events_db"
import { handleCommand, commandsInstaller } from "./commands_handler"
import { BroadcastConfigurationEvent, MaddenBroadcastEvent } from "../db/events"
import { Client } from "oceanic.js"
import { LeagueSettings } from "./settings_db"

const router = new Router({ prefix: "/discord/webhook" })

if (!process.env.PUBLIC_KEY) {
    throw new Error("No Public Key passed for interaction verification")
}

if (!process.env.DISCORD_TOKEN) {
    throw new Error("No Discord Token passed for interaction verification")
}
if (!process.env.APP_ID) {
    throw new Error("No App Id passed for interaction verification")
}

const prodSettings = { publicKey: process.env.PUBLIC_KEY, botToken: process.env.DISCORD_TOKEN, appId: process.env.APP_ID }

const prodClient = createClient(prodSettings)

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
}).post("/commandsHandler", async (ctx) => {
    const req = ctx.request.body as CommandsHandlerRequest
    await commandsInstaller(prodClient, req.commandNames || [], req.mode, req.guildId)
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

const discordClient = new Client({
    auth: `Bot ${process.env.DISCORD_TOKEN}`,
    gateway: {
        intents: ["GUILD_MESSAGE_REACTIONS", "GUILD_MEMBERS"]
    }
})

discordClient.on("ready", () => console.log("Ready as", discordClient.user.tag));
discordClient.on("error", (error) => {
    console.error("Something went wrong:", error);
});


discordClient.on("guildMemberRemove", async (user, guild) => {

});

discordClient.on("guildMemberUpdate", async (member, old) => {

});
const SNALLABOT_USER = "970091866450198548"
const SNALLABOT_TEST_USER = "1099768386352840807"

const validReactions = ["🏆", "⏭️"];


discordClient.on("messageReactionAdd", async (msg, reactor, reaction) => {
    // don't respond when bots react!
    if (reactor.id === SNALLABOT_USER || reactor.id === SNALLABOT_TEST_USER) {
        return
    }
    const guild = msg.guildID
    if (!guild) {
        return
    }
    if (!validReactions.includes(reaction.emoji.name)) {
        return
    }
    const reactionChannel = msg.channelID
    const reactionMessage = msg.id
    const doc = await db.collection("league_settings").doc(guild).get()
    if (!doc.exists) {
        return
    }
    const leagueSettings = doc.data() as LeagueSettings
    const weeklyStates = leagueSettings.commands?.game_channel?.weekly_states || {}
    Object.values(weeklyStates).map(weeklyState => {
        Object.entries(weeklyState.channel_states).map(channelEntry => {
            const [channelId, channelState] = channelEntry
            if (channelId === reactionChannel && channelState.message.id === reactionMessage) {
                //UPDATE NOTIFIER
            }
        })
    })
})

export default router
