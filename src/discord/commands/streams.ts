import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, deferMessage } from "../discord_utils"
import { APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataSubcommandOption, APIApplicationCommandInteractionDataUserOption, APIMessage, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { ChannelId, DiscordIdType, LeagueSettings, MessageId, StreamCountConfiguration, UserStreamCount } from "../settings_db"

async function moveStreamCountMessage(client: DiscordClient, oldChannelId: ChannelId, oldMessageId: MessageId, newChannelId: ChannelId, counts: Array<UserStreamCount>): Promise<MessageId> {
  try {
    await client.deleteMessage(oldChannelId, oldMessageId)
    const message = await client.createMessage(newChannelId, createStreamCountMessage(counts), [])
    return { id: message.id, id_type: DiscordIdType.MESSAGE }
  } catch (e) { }
  return { id: "0", id_type: DiscordIdType.MESSAGE }
}

function createStreamCountMessage(counts: Array<UserStreamCount>) {
  const sortedCountsList = counts.sort((a, b) =>
    a.count > b.count ? -1 : 1
  )
  return (
    "# Streams \n" +
    sortedCountsList
      .map((userCount) => `1. <@${userCount.user.id}>: ${userCount.count}`)
      .join("\n")
      .trim()
  )
}

async function updateStreamMessage(ctx: ParameterizedContext, streamConfiguration: Required<StreamCountConfiguration>, client: DiscordClient, newStreamMessage: string): Promise<string> {
  const channel = streamConfiguration.channel
  const currentMessage = streamConfiguration.message
  try {
    await client.editMessage(channel, currentMessage, newStreamMessage, [])
    respond(ctx, createMessageResponse("count updated!", { flags: 64 }))
    return currentMessage.id
  } catch (e) {
    try {
      const message = await client.createMessage(channel, newStreamMessage, [])
      respond(ctx, createMessageResponse("count updated!", { flags: 64 }))
      return message.id
    } catch (e) {
      respond(ctx, createMessageResponse("count was recorded, but I could not update the discord message error: " + e))
      return currentMessage.id
    }
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id, token } = command
    if (!command.data.options) {
      throw new Error("logger command not defined properly")
    }
    const options = command.data.options
    const streamsCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = streamsCommand.name
    const doc = await db.collection("league_settings").doc(guild_id).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    if (subCommand === "configure") {
      if (!streamsCommand.options || !streamsCommand.options[0]) {
        throw new Error("streams configure misconfigured")
      }
      const channel: ChannelId = { id: (streamsCommand.options[0] as APIApplicationCommandInteractionDataChannelOption).value, id_type: DiscordIdType.CHANNEL }
      const oldChannelId = leagueSettings?.commands?.stream_count?.channel
      const counts = leagueSettings?.commands?.stream_count?.counts ?? []
      if (oldChannelId && oldChannelId.id !== channel.id) {
        respond(ctx, deferMessage())
        // don't await so we can process these in the background
        const oldMessage = leagueSettings.commands?.stream_count?.message || {} as MessageId
        const update = async (newMessageId: MessageId) => {
          const streamConfiguration = {
            channel: channel,
            counts: counts,
            message: newMessageId
          } as StreamCountConfiguration
          await db.collection("league_settings").doc(guild_id).set({
            commands: {
              stream_count: streamConfiguration
            }
          }, { merge: true })
          await client.editOriginalInteraction(token, {
            content: "Stream count re configured and moved"
          })
        }
        moveStreamCountMessage(client, oldChannelId, oldMessage, channel, counts).then(update).catch(e => client.editOriginalInteraction(token, { content: `could not update stream configuration ${e}` }))
      } else {
        const oldMessage = leagueSettings?.commands?.stream_count?.message
        if (oldMessage) {
          try {
            const messageExists = await client.checkMessageExists(channel, oldMessage)
            if (messageExists) {
              respond(ctx, createMessageResponse("Stream already configured"))
            }
            return
          } catch (e) {
            console.log(e)
          }
        }
        const messageId = await client.createMessage(channel, createStreamCountMessage(counts), [])
        const streamConfiguration = {
          channel: channel,
          counts: counts,
          message: messageId
        } as StreamCountConfiguration
        await db.collection("league_settings").doc(guild_id).set({
          commands: {
            stream_count: streamConfiguration
          }
        }, { merge: true })
        respond(ctx, createMessageResponse("Stream Count configured"))
      }
    } else if (subCommand === "count") {
      if (!streamsCommand.options || !streamsCommand.options[0]) {
        throw new Error("streams count misconfigured")
      }
      const user = (streamsCommand.options[0] as APIApplicationCommandInteractionDataUserOption).value
      if (leagueSettings?.commands?.stream_count?.channel?.id) {
        const currentCounts = leagueSettings?.commands?.stream_count?.counts ?? []
        const step = Number((streamsCommand?.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value || 1)
        const idx = currentCounts.findIndex(u => u.user.id === user)
        const newCounts = idx !== -1 ? currentCounts.map(u => u.user.id === user ? { user: u.user, count: u.count + step } : u) : currentCounts.concat([{ user: { id: user, id_type: DiscordIdType.USER }, count: 1 }])
        const newStreamMessage = createStreamCountMessage(newCounts)
        const newMessage = await updateStreamMessage(ctx, leagueSettings.commands.stream_count, client, newStreamMessage)
        await db.collection("league_settings").doc(guild_id).set({
          commands: {
            stream_count: {
              counts: newCounts,
              message: {
                id: newMessage,
                id_type: DiscordIdType.MESSAGE
              }
            }
          }
        }, { merge: true })
      } else {
        respond(ctx, createMessageResponse("Streams is not configured. run /streams configure"))
      }
    } else if (subCommand === "remove") {
      if (!streamsCommand.options || !streamsCommand.options[0]) {
        throw new Error("streams remove misconfigured")
      }
      const user = (streamsCommand.options[0] as APIApplicationCommandInteractionDataUserOption).value
      if (leagueSettings?.commands?.stream_count?.channel?.id) {
        const currentCounts = leagueSettings?.commands?.stream_count?.counts ?? []
        const newCounts = currentCounts.filter(u => u.user.id !== user)
        const newStreamMessage = createStreamCountMessage(newCounts)
        const newMessage = await updateStreamMessage(ctx, leagueSettings.commands.stream_count, client, newStreamMessage)
        await db.collection("league_settings").doc(guild_id).set({
          commands: {
            stream_count: {
              counts: newCounts,
              message: {
                id: newMessage,
                id_type: DiscordIdType.MESSAGE
              }
            }
          }
        }, { merge: true })
      } else {
        respond(ctx, createMessageResponse("Streams is not configured. run /streams configure"))
      }
    } else if (subCommand === "reset") {
      if (leagueSettings?.commands?.stream_count?.channel?.id) {
        const newCounts = [] as Array<UserStreamCount>
        const newStreamMessage = createStreamCountMessage(newCounts)
        const newMessage = await updateStreamMessage(ctx, leagueSettings.commands.stream_count, client, newStreamMessage)
        await db.collection("league_settings").doc(guild_id).set({
          commands: {
            stream_count: {
              counts: newCounts,
              message: {
                id: newMessage,
                id_type: DiscordIdType.MESSAGE
              }
            }
          }
        }, { merge: true })
      } else {
        respond(ctx, createMessageResponse("Streams is not configured. run /streams configure"))
      }
    } else {
      throw new Error(`streams ${subCommand} misconfigured`)
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      type: ApplicationCommandType.ChatInput,
      name: "streams",
      description: "streams: configure, count, remove, reset",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "sets channel",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "channel",
              description: "channel to send message in",
              required: true,
              channel_types: [ChannelType.GuildText],
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "count",
          description: "ups the stream count by 1, optionally override the count",
          options: [
            {
              type: ApplicationCommandOptionType.User,
              name: "user",
              description: "user to count the stream for",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "increment",
              description:
                "changes the increment from 1 to your choice. can be negative",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand, // sub command
          name: "remove",
          description: "removes the user stream counts",
          options: [
            {
              type: ApplicationCommandOptionType.User,
              name: "user",
              description: "user to remove",
              required: true,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "reset",
          description: "DANGER resets all users to 0",
          options: [],
        },
      ],
    }

  }
} as CommandHandler
