import { ParameterizedContext } from "koa"
import { verifyKey } from "discord-interactions"
import { APIApplicationCommand, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"

export enum CommandMode {
    INSTALL = "INSTALL",
    DELETE = "DELETE"
}

export interface DiscordClient {
    requestDiscord(endpoint: string, options: { [key: string]: any }, maxTries?: number): Promise<Response>,
    interactionVerifier(ctx: ParameterizedContext): Promise<boolean>,
    handleSlashCommand(mode: CommandMode, command: RESTPostAPIApplicationCommandsJSONBody, guild?: string): Promise<void>,
    editOriginalInteraction(token: string, body: { [key: string]: any }): Promise<void>
}

type DiscordSettings = { publicKey: string, botToken: string, appId: string }
export function createClient(settings: DiscordSettings): DiscordClient {
    async function sendDiscordRequest(endpoint: string, options: { [key: string]: any }, maxTries: number = 10) {
        // append endpoint to root API URL
        const url = "https://discord.com/api/v10/" + endpoint
        if (options.body) options.body = JSON.stringify(options.body)
        let tries = 0
        while (tries < maxTries) {
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bot ${settings.botToken}`,
                    "Content-Type": "application/json; charset=UTF-8",
                },
                ...options,
            })
            if (!res.ok) {
                const data = await res.json()
                if (data["retry_after"]) {
                    tries = tries + 1
                    await new Promise((r) => setTimeout(r, data["retry_after"] * 1000))
                } else {
                    console.log(res)
                    throw new Error(JSON.stringify(data))
                }
            } else {
                return res
            }
        }
        throw new Error("max tries reached")
    }

    async function installCommand(command: RESTPostAPIApplicationCommandsJSONBody, guildId?: string) {
        const endpoint = guildId ? `applications/${settings.appId}/guilds/${guildId}/commands` : `applications/${settings.appId}/commands`
        await sendDiscordRequest(endpoint, { method: "POST", body: command })
    }

    async function deleteCommand(command: RESTPostAPIApplicationCommandsJSONBody, guildId?: string) {
        const getEndpoint = guildId ? `applications/${settings.appId}/guilds/${guildId}/commands` : `applications/${settings.appId}/commands`
        const getCommandResponse = await sendDiscordRequest(getEndpoint, { method: "GET" })
        const commands = await getCommandResponse.json() as APIApplicationCommand[]
        const commandsToBeDeleted = commands.filter(c => c.name === command.name)
            .map(c => c.id)
        await Promise.all(commandsToBeDeleted.map(async (c) => {
            const deleteEndpoint = guildId ? `applications/${settings.appId}/guilds/${guildId}/commands/${c}` : `applications/${settings.appId}/commands/${c}`
            await sendDiscordRequest(deleteEndpoint, { method: "DELETE" })
        }))
    }

    return {
        requestDiscord: sendDiscordRequest,
        interactionVerifier: async (ctx: ParameterizedContext) => {
            const signature = ctx.get("x-signature-ed25519")
            const timestamp = ctx.get("x-signature-timestamp")
            return await verifyKey(
                ctx.request.rawBody,
                signature,
                timestamp,
                settings.publicKey
            )

        },
        handleSlashCommand: async (mode: CommandMode, command: RESTPostAPIApplicationCommandsJSONBody, guildId?: string) => {
            if (mode === CommandMode.INSTALL) {
                await installCommand(command, guildId)
            } else if (mode === CommandMode.DELETE) {
                await deleteCommand(command, guildId)
            } else {
                throw new Error("invalid mode " + mode)
            }
        },
        editOriginalInteraction: async (token: string, body: { [key: string]: any }) => {
            await sendDiscordRequest(`webhooks/${settings.appId}/${token}/messages/@original`, { method: "PATCH", body })
        }
    }
}

export function respond(ctx: ParameterizedContext, body: any) {
    ctx.status = 200
    ctx.set("Content-Type", "application/json")
    ctx.body = body
}

export function createMessageResponse(content: string, options = {}) {
    return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
            content: content,
            ...options
        }
    }
}

export function deferMessage() {
    return {
        type: InteractionResponseType.DeferredChannelMessageWithSource,
    }
}
