import { DiscordClient } from "./discord_utils"
import { ChannelId, LoggerConfiguration, UserId } from "./settings_db"
import { APIChannel, APIMessage, APIThreadChannel } from "discord-api-types/v10"

// feels like setting a max is a good idea. 1000 messages
const MAX_PAGES = 10

async function getMessages(channelId: ChannelId, client: DiscordClient): Promise<APIMessage[]> {
  let messages: APIMessage[] = await client.requestDiscord(
    `/channels/${channelId.id}/messages?limit=100`,
    {
      method: "GET",
    }
  ).then((r) => r.json())
  let newMessages = messages
  let page = 0
  while (newMessages.length === 100 && page < MAX_PAGES) {
    const lastMessage = messages[messages.length - 1]
    newMessages = await client.requestDiscord(
      `/channels/${channelId}/messages?limit=100&before=${lastMessage.id}`,
      {
        method: "GET",
      }
    ).then((r) => r.json()) as APIMessage[]
    messages = messages.concat(newMessages)
    page = page + 1
  }
  return messages.reverse()
}

interface Logger {
  logUsedCommand(command: string, author: string, client: DiscordClient): Promise<void>,
  logChannels(channels: ChannelId[], client: DiscordClient): Promise<void>
}

function joinUsers(users: UserId[]) {
    return users.map((uId) => `<@${uId.id}>`).join("")
}

export default (config: LoggerConfiguration) => ({
  logUsedCommand: async (command: string, author: UserId, client: DiscordClient) => {
    const loggerChannel = config.channel.id
    await client.requestDiscord(`channels/${loggerChannel}/messages`, {
      method: "POST",
      body: {
        content: `${command} by <@${author.id}>`,
        allowed_mentions: {
          parse: [],
        },
      },
    })
  },
  logChannels: async (channels: ChannelId[], client: DiscordClient) => {
    const loggerChannels = channels.map(async channel => {
      const messages = await getMessages(channel, client)
      const logMessages = messages.map(m => ({ content: m.content, user: m.author.id, time: m.timestamp }))
      const channelInfoRes = await client.requestDiscord(`channels/${channel.id}`, {
        method: "GET",
      })
      const channelInfo = (await channelInfoRes.json()) as APIChannel
      const channelName = channelInfo.name
      await client.requestDiscord(`channels/${channel.id}`, {
        method: "DELETE",
      }) // delete channel and then start logging
      const loggerChannel = config.channel.id
      const res = await client.requestDiscord(`channels/${loggerChannel}/threads`, {
        method: "POST",
        body: {
          name: `${channelName} channel log`,
          auto_archive_duration: 60,
          type: 11,
        },
      })
      const thread = (await res.json()) as APIThreadChannel
      const threadId = thread.id
      const messagePromise = logMessages.reduce((p, message) => {
        return p.then(async (_) => {
          await client.requestDiscord(`channels/${threadId}/messages`, {
            method: "POST",
            body: {
              content: `(${message.time}) <@${message.user}>: ${message.content}`,
              allowed_mentions: {
                parse: [],
              },
            },
        })
    },
    logChannels: async (channels: ChannelId[], loggedAuthors: UserId[], client: DiscordClient) => {
        const loggerChannels = channels.map(async channel => {
            const messages = await getMessages(channel, client)
            const logMessages = messages.map(m => ({ content: m.content, user: m.author.id, time: m.timestamp }))
            const channelInfoRes = await client.requestDiscord(`channels/${channel.id}`, {
                method: "GET",
            })
            const channelInfo = (await channelInfoRes.json()) as APIChannel
            const channelName = channelInfo.name
            await client.requestDiscord(`channels/${channel.id}`, {
                method: "DELETE",
            }) // delete channel and then start logging
            const loggerChannel = config.channel.id
            const res = await client.requestDiscord(`channels/${loggerChannel}/threads`, {
                method: "POST",
                body: {
                    name: `${channelName} channel log`,
                    auto_archive_duration: 60,
                    type: 11,
                },
            })
            const thread = (await res.json()) as APIThreadChannel
            const threadId = thread.id
            const messagePromise = logMessages.reduce((p, message) => {
                return p.then(async (_) => {
                    await client.requestDiscord(`channels/${threadId}/messages`, {
                        method: "POST",
                        body: {
                            content: `(${message.time}) <@${message.user}>: ${message.content}`,
                            allowed_mentions: {
                                parse: [],
                            },
                        },
                    })
                    return Promise.resolve()
                }
                )
            }, Promise.resolve())
            messagePromise.then(async (_) => {
                await client.requestDiscord(`channels/${threadId}/messages`, {
                    method: "POST",
                    body: {
                        content: `cleared by ${joinUsers(loggedAuthors)}`,
                        allowed_mentions: {
                            parse: [],
                        },
                    },
                })
            })
            return messagePromise
        })
        await Promise.all(loggerChannels)
    }
})
