import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataRoleOption, APIApplicationCommandInteractionDataStringOption, APIApplicationCommandInteractionDataSubcommandGroupOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { LeagueSettings, BroadcastConfiguration, DiscordIdType } from "../settings_db"

export default {
    async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
        const { guild_id } = command
        if (!command.data.options) {
            throw new Error("misconfigured broadcast")
        }
        const subCommand = command.data.options[0] as APIApplicationCommandInteractionDataSubcommandOption | APIApplicationCommandInteractionDataSubcommandGroupOption
        const subCommandName = subCommand.name
        if (subCommandName === "configure") {
            const configureCommand = subCommand as APIApplicationCommandInteractionDataSubcommandOption
            if (!configureCommand.options) {
                throw new Error("misconfigued broadcast configure")
            }
            const titleKeyword = (configureCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value
            const channel = (configureCommand.options[1] as APIApplicationCommandInteractionDataChannelOption).value
            const role = (configureCommand.options?.[2] as APIApplicationCommandInteractionDataRoleOption)?.value
            const conf = {
                title_keyword: titleKeyword,
                channel: { id: channel, id_type: DiscordIdType.CHANNEL },
            } as BroadcastConfiguration
            if (role) {
                conf.role = { id: role, id_type: DiscordIdType.ROLE }
            }
            await db.collection("league_settings").doc(guild_id).set({
                commands: {
                    broadcast: conf
                }
            }, { merge: true })
            respond(ctx, createMessageResponse("Broadcast is configured!"))
        } else if (subCommandName === "youtube") {
            const subCommandGroup = subCommand as APIApplicationCommandInteractionDataSubcommandGroupOption
            if (!subCommandGroup || !subCommandGroup.options) {
                throw new Error("youtube command misconfigured")
            }
            const groupCommand = subCommandGroup.options[0] as APIApplicationCommandInteractionDataSubcommandOption
            const groupCommandName = groupCommand.name
            if (groupCommandName === "list") {
                const youtubeUrls = await fetch(
                    "https://snallabot-yt-notifier-46962131d2d5.herokuapp.com/list",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            discord_server: guild_id,
                        }),
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                ).then((res) => res.json())
                respond(ctx, createMessageResponse(`Here are your currently configured youtube channels:\n\n${youtubeUrls.join("\n")}`))
            } else if (groupCommandName === "add" || groupCommandName === "remove") {
                const event_type = groupCommandName === "add" ? "ADD_CHANNEL" : "REMOVE_CHANNEL"
                if (!groupCommand.options || !groupCommand.options[0]) {
                    throw new Error(`broadcast youtube ${groupCommandName} misconfigured`)
                }
                const youtubeUrl = (groupCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value
                const res = await fetch(
                    "https://snallabot-yt-notifier-46962131d2d5.herokuapp.com/configure",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            youtube_url: youtubeUrl,
                            discord_server: guild_id,
                            event_type: event_type,
                        }),
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                )
                if (!res.ok) {
                    const t = await res.text()
                    throw new Error("could not update youtube broadcast. Please make sure you input the whole youtube channel url. error: " + t)
                } else {
                    respond(ctx, createMessageResponse("Channel updated successfully"))
                }
            } else {
                throw new Error(`broadcast youtube ${groupCommandName}`)
            }
        } else if (subCommandName === "twitch") {
            const subCommandGroup = subCommand as APIApplicationCommandInteractionDataSubcommandGroupOption
            if (!subCommandGroup || !subCommandGroup.options) {
                throw new Error("twitch command misconfigured")
            }
            const groupCommand = subCommandGroup.options[0] as APIApplicationCommandInteractionDataSubcommandOption
            const groupCommandName = groupCommand.name
            if (groupCommandName === "list") {
                const twitchUrls = await fetch(
                    "https://snallabot-twitch-notifier-38043494ff8d.herokuapp.com/listTwitchNotifiers",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            discord_server: guild_id,
                        }),
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                ).then((res) => res.json())
                respond(ctx, createMessageResponse(`Here are your currently configured twitch channels:\n\n${twitchUrls.join("\n")}`))
            } else if (groupCommandName === "add" || groupCommandName === "remove") {
                const endpoint = groupCommandName === "add" ? "addTwitchNotifier" : "removeTwitchNotifier"
                if (!groupCommand.options || !groupCommand.options[0]) {
                    throw new Error(`broadcast twitch ${groupCommandName} misconfigured`)
                }
                const twitchUrl = (groupCommand.options[0] as APIApplicationCommandInteractionDataStringOption).value
                const res = await fetch(
                    `https://snallabot-twitch-notifier-38043494ff8d.herokuapp.com/${endpoint}`,
                    {
                        method: "POST",
                        body: JSON.stringify({
                            twitch_url: twitchUrl,
                            discord_server: guild_id,
                        }),
                        headers: {
                            "Content-Type": "application/json",
                        },
                    }
                )
                if (!res.ok) {
                    const t = await res.text()
                    throw new Error("Could not update twitch broadcast. Please make sure you input the whole twitch channel url. error: " + t)
                } else {
                    respond(ctx, createMessageResponse("Channel updated successfully"))
                }
            } else {
                throw new Error(`broadcast twitch ${groupCommandName} misconfigured`)
            }
        } else {
            throw new Error(`Broadcast SubCommand ${subCommandName} misconfigured`)
        }
    },
    commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
        return {
            name: "broadcasts",
            description: "sets up your league to start receiving twitch and youtube broadcasts",
            type: ApplicationCommandType.ChatInput,
            options: [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "configure",
                    description: "configures snallabot broadcaster",
                    options: [
                        {
                            type: ApplicationCommandOptionType.String,
                            name: "keyword",
                            description: "only show broadcasts with this keyword in the title",
                            required: true,
                        },
                        {
                            type: ApplicationCommandOptionType.Channel,
                            name: "channel",
                            description: "channel to send broadcasts to",
                            required: true,
                            channel_types: [ChannelType.GuildText],
                        },
                        {
                            type: ApplicationCommandOptionType.Role,
                            name: "notifier_role",
                            description: "optional role to notify on every broadcast",
                            required: false,
                        },
                    ]
                },
                {
                    type: ApplicationCommandOptionType.SubcommandGroup,
                    name: "youtube",
                    description: "configures youtube broadcasts",
                    options: [
                        {
                            type: ApplicationCommandOptionType.Subcommand,
                            name: "add",
                            description: "add youtube broadcast",
                            options: [
                                {
                                    type: ApplicationCommandOptionType.String,
                                    name: "youtube_channel",
                                    description:
                                        "the full youtube channel URL you want to show broadcasts for",
                                    required: true,
                                },
                            ],
                        },
                        {
                            type: ApplicationCommandOptionType.Subcommand,
                            name: "remove",
                            description: "remove youtube broadcast",
                            options: [
                                {
                                    type: ApplicationCommandOptionType.String,
                                    name: "youtube_channel",
                                    description: "the youtube channel you want to remove",
                                    required: true,
                                },
                            ],
                        },
                        {
                            type: ApplicationCommandOptionType.Subcommand,
                            name: "list",
                            description: "list all youtube broadcast",
                            options: [],
                        },
                    ],
                },
                {
                    type: ApplicationCommandOptionType.SubcommandGroup,
                    name: "twitch",
                    description: "configures twitch broadcasts",
                    options: [
                        {
                            type: ApplicationCommandOptionType.Subcommand,
                            name: "add",
                            description: "add twitch broadcast",
                            options: [
                                {
                                    type: ApplicationCommandOptionType.String,
                                    name: "twitch_channel",
                                    description: "the twitch channel you want to show broadcasts for",
                                    required: true,
                                },
                            ],
                        },
                        {
                            type: ApplicationCommandOptionType.Subcommand,
                            name: "remove",
                            description: "remove twitch broadcast",
                            options: [
                                {
                                    type: ApplicationCommandOptionType.String,
                                    name: "twitch_channel",
                                    description: "the twitch channel you want to remove",
                                    required: true,
                                },
                            ],
                        },
                        {
                            type: ApplicationCommandOptionType.Subcommand,
                            name: "list",
                            description: "list all twitch broadcast",
                            options: [],
                        },
                    ],
                },
            ]
        }
    }
} as CommandHandler
