import { DiscordClient, SnallabotDiscordError } from "./discord_utils"
import { ChannelId, DiscordIdType, LoggerConfiguration, UserId } from "./settings_db"
import { APIChannel, APIMessage, APIThreadChannel } from "discord-api-types/v10"

// feels like setting a max is a good idea. 1000 messages
const MAX_PAGES = 10
const dateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

async function getMessages(channelId: ChannelId, client: DiscordClient): Promise<APIMessage[]> {
  let messages: APIMessage[] = await client.getMessagesInChannel(channelId)
  let newMessages = messages
  let page = 0
  while (newMessages.length === 100 && page < MAX_PAGES) {
    const lastMessage = messages[messages.length - 1]
    newMessages = await client.getMessagesInChannel(channelId, { id: lastMessage.id, id_type: DiscordIdType.MESSAGE })
    messages = messages.concat(newMessages)
    page = page + 1
  }
  return messages.reverse()
}

interface Logger {
  logUsedCommand(command: string, author: UserId, client: DiscordClient): Promise<void>,
  logChannels(channels: ChannelId[], loggedAuthors: UserId[], client: DiscordClient): Promise<void>
}

function joinUsers(users: UserId[]) {
  return users.map((uId) => `<@${uId.id}>`).join("")
}

export default (config: LoggerConfiguration) => ({
  logUsedCommand: async (command: string, author: UserId, client: DiscordClient) => {
    const loggerChannel = config.channel
    try {
      await client.createMessage(loggerChannel, `${command} by <@${author.id}>`, [])
    } catch (e) {

    }
  },
  logChannels: async (channels: ChannelId[], loggedAuthors: UserId[], client: DiscordClient) => {
    const loggerChannels = channels.map(async channel => {
      try {
        const messages = await getMessages(channel, client)
        const logMessages = messages.map(m => ({ content: m.content, user: m.author.id, time: m.timestamp }))
        const channelInfo = await client.getChannel(channel)
        const channelName = channelInfo.name
        await client.deleteChannel({ id: channelInfo.id, id_type: DiscordIdType.CHANNEL })
        const loggerChannel = config.channel
        const threadId = await client.createThreadInChannel(loggerChannel, `${channelName} channel log`)
        const messagePromise = logMessages.reduce((p, message) => {
          return p.then(async (_) => {
            try {
              await client.createMessage(threadId, `<@${message.user}>: ${message.content} (<t:${Math.round(new Date(message.time).getTime() / 1000)}>)`, [])
            } catch (e) { }
            return Promise.resolve()
          }
          )
        }, Promise.resolve())
        messagePromise.then(async (_) => {
          try {
            await client.createMessage(threadId, `cleared by ${joinUsers(loggedAuthors)}`, [])
          } catch (e) { }
        })
        return messagePromise
      } catch (e) {
        if (e instanceof SnallabotDiscordError && e.isDeletedChannel()) {
          return
        }
      }
    })
    await Promise.all(loggerChannels)
  }
} as Logger)
