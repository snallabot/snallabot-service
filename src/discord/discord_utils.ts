import { ParameterizedContext } from "koa"
import { verifyKey } from "discord-interactions"
import { APIApplicationCommand, APIChannel, APIEmoji, APIGuild, APIGuildMember, APIMessage, APIThreadChannel, APIUser, ChannelType, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { CategoryId, ChannelId, DiscordIdType, MessageId, UserId } from "./settings_db"
import { createDashboard } from "./commands/dashboard"
import { GameResult, MaddenGame } from "../export/madden_league_types"
import { TeamList } from "../db/madden_db"
import { LeagueLogos, leagueLogosView } from "../db/view"

export enum CommandMode {
  INSTALL = "INSTALL",
  DELETE = "DELETE"
}

export type DiscordError = { message: string, code: number, retry_after?: number, errors?: { name: { _errors: { code: string, message: string }[] } } }

// https://discord.com/developers/docs/topics/opcodes-and-status-codes
export class DiscordRequestError extends Error {
  code: number
  originalError: DiscordError
  constructor(error: DiscordError) {
    super(JSON.stringify(error))
    this.name = "DiscordError"
    this.code = error.code
    this.originalError = error
  }

  isPermissionError() {
    return this.code == 50013 || this.code == 50001
  }
}

export class NoConnectedLeagueError extends Error {
  constructor(guild_id: string) {
    super(`There is no Madden league connected to this Discord server. To connect, setup the dashboard at this url: ${createDashboard(guild_id)}`)
  }
}

const UNKNOWN_MESSAGE = 10008
const UNKNOWN_CHANNEL = 10003

export class SnallabotDiscordError extends Error {
  guidance: string
  code: number
  constructor(error: DiscordRequestError, guidance: string) {
    super(error.message)
    this.name = "SnallabotDiscordError"
    this.guidance = guidance
    this.code = error.code
  }

  isDeletedChannel() {
    return this.code === UNKNOWN_CHANNEL
  }

  isDeletedMessage() {
    return this.code === UNKNOWN_MESSAGE
  }
}

export interface DiscordClient {
  interactionVerifier(ctx: ParameterizedContext): Promise<boolean>,
  handleSlashCommand(mode: CommandMode, command: RESTPostAPIApplicationCommandsJSONBody, guild?: string): Promise<void>,
  editOriginalInteraction(token: string, body: { [key: string]: any }): Promise<void>,
  editOriginalInteractionWithForm(token: string, body: FormData): Promise<void>,
  createMessage(channel: ChannelId, content: string, allowedMentions: string[]): Promise<MessageId>,
  editMessage(channel: ChannelId, messageId: MessageId, content: string, allowedMentions: string[]): Promise<void>,
  deleteMessage(channel: ChannelId, messageId: MessageId): Promise<void>,
  createChannel(guild_id: string, channelName: string, category: CategoryId): Promise<ChannelId>,
  deleteChannel(channelId: ChannelId): Promise<void>,
  getChannel(channelId: ChannelId): Promise<APIChannel>,
  reactToMessage(reaction: String, messageId: MessageId, channel: ChannelId): Promise<void>,
  getUsersReacted(reaction: String, messageId: MessageId, channel: ChannelId): Promise<UserId[]>,
  getMessagesInChannel(channelId: ChannelId, before?: MessageId): Promise<APIMessage[]>,
  createThreadInChannel(channel: ChannelId, channelName: string): Promise<ChannelId>,
  checkMessageExists(channel: ChannelId, messageId: MessageId): Promise<boolean>,
  getUsers(guild_id: string): Promise<APIGuildMember[]>,
  getGuildInformation(guild_id: string): Promise<APIGuild>,
  uploadEmoji(imageData: string, name: string): Promise<APIEmoji>
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
        const stringData = await res.text()
        let data: DiscordError = { message: "Snallabot Error, could not send to discord", code: 1 }
        try {
          data = JSON.parse(stringData) as DiscordError
        } catch (e) {
          tries = tries + 1
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (data.retry_after) {
          tries = tries + 1
          const retryTime = data.retry_after
          await new Promise((r) => setTimeout(r, retryTime * 1000))
        } else {
          throw new DiscordRequestError(data)
        }
      } else {
        return res
      }
    }
    throw new Error("max tries reached")
  }

  async function sendDiscordRequestForm(endpoint: string, body: FormData, options: { [key: string]: any }, maxTries: number = 10) {
    // append endpoint to root API URL
    const url = "https://discord.com/api/v10/" + endpoint
    let tries = 0
    while (tries < maxTries) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bot ${settings.botToken}`,
          // "Content-Type": "multipart/form-data; charset=UTF-8",
        },
        body: body,
        ...options
      })
      if (!res.ok) {
        const stringData = await res.text()
        let data: DiscordError = { message: "Snallabot Error, could not send to discord", code: 1 }
        try {
          data = JSON.parse(stringData) as DiscordError
        } catch (e) {
          tries = tries + 1
          await new Promise((r) => setTimeout(r, 1000))
        }
        if (data.retry_after) {
          tries = tries + 1
          const retryTime = data.retry_after
          await new Promise((r) => setTimeout(r, retryTime * 1000))
        } else {
          throw new DiscordRequestError(data)
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
      try {
        await sendDiscordRequest(`webhooks/${settings.appId}/${token}/messages/@original`, { method: "PATCH", body })
      } catch (e) {
      }
    },
    editOriginalInteractionWithForm: async (token: string, body: FormData) => {
      try {
        await sendDiscordRequestForm(`webhooks/${settings.appId}/${token}/messages/@original`, body, { method: "PATCH" })
      } catch (e) {
      }
    }
    ,
    createMessage: async (channel: ChannelId, content: string, allowedMentions = []): Promise<MessageId> => {
      try {
        const res = await sendDiscordRequest(`channels/${channel.id}/messages`, {
          method: "POST",
          body: {
            content: content,
            allowed_mentions: {
              parse: allowedMentions
            }
          }
        })
        const message = await res.json() as APIMessage
        return {
          id: message.id, id_type: DiscordIdType.MESSAGE
        }
      }
      catch (e) {
        if (e instanceof DiscordRequestError && e.isPermissionError()) {
          throw new SnallabotDiscordError(e, `Snallabot does not have permission to create a message in <#${channel.id}>`)
        }
        throw e
      }
    },
    editMessage: async (channel: ChannelId, messageId: MessageId, content: string, allowedMentions = []): Promise<void> => {
      try {
        await sendDiscordRequest(`channels/${channel.id}/messages/${messageId.id}`, {
          method: "PATCH",
          body: {
            content: content,
            allowed_mentions: {
              parse: allowedMentions
            }
          }
        })
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to edit message in channel <#${channel.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_MESSAGE) {
            throw new SnallabotDiscordError(e, `Snallabot cannot edit message, it may have been deleted? Full discord error ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL) {
            throw new SnallabotDiscordError(e, `Snallabot cannot edit message in channel because the channel (<#${channel.id}>) may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    deleteMessage: async (channel: ChannelId, messageId: MessageId): Promise<void> => {
      try {
        await sendDiscordRequest(`channels/${channel.id}/messages/${messageId.id}`, {
          method: "DELETE"
        })
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to delete message in channel <#${channel.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_MESSAGE) {
            throw new SnallabotDiscordError(e, `Snallabot cannot delete message, it may have been deleted? Full discord error ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL) {
            throw new SnallabotDiscordError(e, `Snallabot cannot delete message in channel because the channel (<#${channel.id}>) may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    createChannel: async (guild_id: string, channelName: string, category: CategoryId): Promise<ChannelId> => {
      try {
        const res = await sendDiscordRequest(`guilds/${guild_id}/channels`, {
          method: "POST",
          body: {
            type: ChannelType.GuildText,
            name: channelName,
            parent_id: category.id,
          },
        })
        const channel = await res.json() as APIChannel
        return { id: channel.id, id_type: DiscordIdType.CHANNEL }
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to create channel under category <#${category.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL) {
            throw new SnallabotDiscordError(e, `Snallabot could not create channel under category (<#${category.id}>) may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    deleteChannel: async (channel: ChannelId) => {
      try {
        await sendDiscordRequest(`/channels/${channel.id}`, { method: "DELETE" })
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to delete channel <#${channel.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL) {
            throw new SnallabotDiscordError(e, `Snallabot could not delete channel <#${channel.id}> may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    reactToMessage: async (reaction: String, message: MessageId, channel: ChannelId): Promise<void> => {
      try {
        await sendDiscordRequest(`channels/${channel.id}/messages/${message.id}/reactions/${reaction}/@me`, { method: "PUT" })
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to react to message in  channel <#${channel.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL || e.code === UNKNOWN_MESSAGE) {
            throw new SnallabotDiscordError(e, `Snallabot could not react to message in channel <#${channel.id}>. the channel or the message may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    getUsersReacted: async (reaction: string, message: MessageId, channel: ChannelId): Promise<UserId[]> => {
      try {
        const res = await sendDiscordRequest(
          `channels/${channel.id}/messages/${message.id}/reactions/${reaction}`,
          { method: "GET" }
        )
        const reactedUsers = await res.json() as APIUser[]
        return reactedUsers.filter(u => u.id !== SNALLABOT_USER && u.id !== SNALLABOT_TEST_USER).map(u => ({ id: u.id, id_type: DiscordIdType.USER }))
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to see users reacted to message in  channel <#${channel.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL || e.code === UNKNOWN_MESSAGE) {
            throw new SnallabotDiscordError(e, `Snallabot could not have permissions to see users reacted to message in <#${channel.id}>. the channel or the message may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    getMessagesInChannel: async function(channelId: ChannelId, before?: MessageId): Promise<APIMessage[]> {
      const requestUrl = `/channels/${channelId.id}/messages?limit=100${before ? "&before=" + before.id : ""}`
      try {
        const res = await sendDiscordRequest(requestUrl, { method: "GET" })
        return await res.json() as APIMessage[]
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to get messages from  <#${channelId.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL || e.code === UNKNOWN_MESSAGE) {
            throw new SnallabotDiscordError(e, `Snallabot could not get messages from  <#${channelId.id}>. the channel may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    createThreadInChannel: async function(channel: ChannelId, threadName: string): Promise<ChannelId> {
      try {
        const res = await sendDiscordRequest(`channels/${channel.id}/threads`, {
          method: "POST",
          body: {
            name: threadName,
            auto_archive_duration: 60,
            type: 11,
          }
        })
        const thread = (await res.json()) as APIThreadChannel
        const threadId = thread.id
        return { id: threadId, id_type: DiscordIdType.CHANNEL }
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to create thread in  <#${channel.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL || e.code === UNKNOWN_MESSAGE) {
            throw new SnallabotDiscordError(e, `Snallabot could not create a thread in  <#${channel.id}>. the channel may have been deleted? Full discord error: ${e.message}`)
          }
        }
        throw e
      }

    },
    checkMessageExists: async function(channel: ChannelId, message: MessageId) {
      try {
        await sendDiscordRequest(`channels/${channel.id}/messages/${message.id}`, {
          method: "GET",
        })
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to create thread in  <#${channel.id}>. Full discord error: ${e.message}`)
          } else if (e.code === UNKNOWN_CHANNEL || e.code === UNKNOWN_MESSAGE) {
            return false
          }
        }
        throw e
      }
      return true
    },
    getUsers: async function(guild_id: string) {
      try {
        const res = await sendDiscordRequest(
          `guilds/${guild_id}/members?limit=1000`,
          {
            method: "GET",
          }
        )
        return await res.json() as APIGuildMember[]
      } catch (e) {
        if (e instanceof DiscordRequestError) {
          if (e.isPermissionError()) {
            throw new SnallabotDiscordError(e, `Snallabot does not have permissions to get users so I can check their roles. Full discord error: ${e.message}`)
          }
        }
        throw e
      }
    },
    getChannel: async function(channel: ChannelId): Promise<APIChannel> {
      const channelInfoRes = await sendDiscordRequest(`channels/${channel.id}`, {
        method: "GET",
      })
      const channelInfo = (await channelInfoRes.json()) as APIChannel
      return channelInfo
    },
    getGuildInformation: async function(guildId: string) {
      const guildInfoRes = await sendDiscordRequest(`guilds/${guildId}`, {
        method: "GET",
      })
      const guildInfo = (await guildInfoRes.json()) as APIGuild
      return guildInfo
    },
    uploadEmoji: async function(image: string, name: string) {
      try {
        const res = await sendDiscordRequest(`applications/${settings.appId}/emojis`, {
          method: "POST",
          body: {
            name: name,
            image: image
          }
        })
        return (await res.json()) as APIEmoji;
      }
      catch (e) {
        if (e instanceof DiscordRequestError) {
          const errorData = e.originalError
          // Check for the specific duplicate emoji name error
          if (errorData.code === 50035 &&
            errorData.errors?.name?._errors?.[0]?.code === "APPLICATION_EMOJI_NAME_ALREADY_TAKEN") {

            // Get all existing emojis to find the one with the same name
            const existingEmojisRes = await sendDiscordRequest(`applications/${settings.appId}/emojis`, {
              method: "GET"
            });

            const existingEmojis = await existingEmojisRes.json() as { items: APIEmoji[] }
            const duplicateEmoji = existingEmojis.items.find((emoji) => emoji.name === name);

            if (duplicateEmoji) {
              // Delete the existing emoji
              await sendDiscordRequest(`applications/${settings.appId}/emojis/${duplicateEmoji.id}`, {
                method: "DELETE"
              });

              // Create the new emoji
              const newRes = await sendDiscordRequest(`applications/${settings.appId}/emojis`, {
                method: "POST",
                body: {
                  name: name,
                  image: image
                }
              });

              return (await newRes.json()) as APIEmoji;
            }
          }
        }
        // If it's a different error, throw it
        throw new Error(`Discord API Error: ${e}`);
      }
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

export function deferMessageInvisible() {
  return {
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: 64 }
  }
}

export function formatTeamMessageName(discordId: string | undefined, gamerTag: string | undefined) {
  if (discordId) {
    return `<@${discordId}>`
  }
  if (gamerTag) {
    return gamerTag
  }
  return "CPU"
}

export const SNALLABOT_USER = "970091866450198548"
export const SNALLABOT_TEST_USER = "1099768386352840807"

export enum SnallabotReactions {
  SCHEDULE = "%E2%8F%B0",
  GG = "%F0%9F%8F%86",
  HOME = "%F0%9F%8F%A0",
  AWAY = "%F0%9F%9B%AB",
  SIM = "%E2%8F%AD%EF%B8%8F",
}

export enum ResponseType {
  COMMAND,
  INTERACTION
}
export function createProdClient() {
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
  return createClient(prodSettings)
}

export enum SnallabotTeamEmojis {
  // AFC East
  NE = "<:snallabot_ne:1364103345752641587>",
  NYJ = "<:snallabot_nyj:1364103346985635900>",
  BUF = "<:snallabot_buf:1364103347862372434>",
  MIA = "<:snallabot_mia:1364103349091176468>",

  // AFC North
  CIN = "<:snallabot_cin:1364103477399130144>",
  PIT = "<:snallabot_pit:1364103356393455667>",
  BAL = "<:snallabot_bal:1364105429591785543>",
  CLE = "<:snallabot_cle:1364103360545820742>",

  // AFC South
  TEN = "<:snallabot_ten:1364103353201856562>",
  IND = "<:snallabot_ind:1364103350194278484>",
  JAX = "<:snallabot_jax:1364103352115400774>",
  HOU = "<:snallabot_hou:1364103351184396318>",

  // AFC West
  KC = "<:snallabot_kc:1364105564711288852>",
  LV = "<:snallabot_lv:1364105565885825114>",
  DEN = "<:snallabot_den:1364103366765973615>",
  LAC = "<:snallabot_lac:1364103363297411142>",

  // NFC East
  DAL = "<:snallabot_dal:1364105752087887902>",
  NYG = "<:snallabot_nyg:1364103377411244124>",
  PHI = "<:snallabot_phi:1364105809134354472>",
  WAS = "<:snallabot_was:1364103380728811572>",

  // NFC North
  MIN = "<:snallabot_min:1364106069160493066>",
  CHI = "<:snallabot_chi:1364103373825249331>",
  DET = "<:snallabot_det:1364106151796670526>",
  GB = "<:snallabot_gb:1364103370289184839>",

  // NFC South
  NO = "<:snallabot_no:1364103387758592051>",
  CAR = "<:snallabot_car:1364106419804045353>",
  TB = "<:snallabot_tb:1364103384222797904>",
  ATL = "<:snallabot_atl:1364106360383471737>",

  // NFC West
  ARI = "<:snallabot_ari:1364106640315646013>",
  LAR = "<:snallabot_lar:1364103394800701450>",
  SEA = "<:snallabot_sea:1364103391260840018>",
  SF = "<:snallabot_sf:1364106686083895336>",
  NFL = "<:snallabot_nfl:1364108784229810257>"
}

export function getTeamEmoji(teamAbbr: string, leagueCustomLogos: LeagueLogos): string {
  const customLogo = leagueCustomLogos[teamAbbr]
  if (customLogo) {
    console.log(customLogo)
    return `<:${customLogo.emoji_name}:${customLogo.emoji_id}>`
  }
  return SnallabotTeamEmojis[teamAbbr.toUpperCase() as keyof typeof SnallabotTeamEmojis] || SnallabotTeamEmojis.NFL
}
export function formatTeamEmoji(leagueCustomLogos: LeagueLogos, teamAbbr?: string) {
  if (teamAbbr) {
    return getTeamEmoji(teamAbbr, leagueCustomLogos)
  }
  return SnallabotTeamEmojis.NFL
}

export function formatGame(game: MaddenGame, teams: TeamList, leagueCustomLogos: LeagueLogos) {
  const awayTeam = teams.getTeamForId(game.awayTeamId)
  const homeTeam = teams.getTeamForId(game.homeTeamId)
  const awayEmoji = formatTeamEmoji(leagueCustomLogos, awayTeam?.abbrName)
  const homeEmoji = formatTeamEmoji(leagueCustomLogos, homeTeam?.abbrName)
  const awayDisplay = `${awayEmoji} ${awayTeam?.displayName}`;
  const homeDisplay = `${homeEmoji} ${homeTeam?.displayName}`;

  if (game.status === GameResult.NOT_PLAYED) {
    return `${awayDisplay} vs ${homeDisplay}`;
  } else {
    if (game.awayScore > game.homeScore) {
      return `**${awayDisplay} ${game.awayScore}** vs ${game.homeScore} ${homeDisplay}`;
    } else if (game.homeScore > game.awayScore) {
      return `${awayDisplay} ${game.awayScore} vs **${game.homeScore} ${homeDisplay}**`;
    }
    return `${awayDisplay} ${game.awayScore} vs ${game.homeScore} ${homeDisplay}`;
  }
}
