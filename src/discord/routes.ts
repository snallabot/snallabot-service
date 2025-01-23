import { ParameterizedContext } from "koa"
import Router from "@koa/router"
import { CommandMode, DiscordClient, SNALLABOT_TEST_USER, SNALLABOT_USER, createClient, createWeekKey } from "./discord_utils"
import { APIInteraction, InteractionType, InteractionResponseType, APIChatInputApplicationCommandGuildInteraction } from "discord-api-types/payloads"
import db from "../db/firebase"
import EventDB, { StoredEvent } from "../db/events_db"
import { handleCommand, commandsInstaller } from "./commands_handler"
import { BroadcastConfigurationEvent, ConfirmedSim, MaddenBroadcastEvent } from "../db/events"
import { Client } from "oceanic.js"
import { BroadcastConfiguration, DiscordIdType, LeagueSettings, TeamAssignments } from "./settings_db"
import { APIGuildMember } from "discord-api-types/v9"
import { FieldValue } from "firebase-admin/firestore"
import { fetchTeamsMessage } from "./commands/teams"
import createNotifier from "./notifier"
import MaddenClient from "../db/madden_db"
import { formatScoreboard } from "./commands/game_channels"
import MaddenDB from "../db/madden_db"
import { MaddenGame } from "../export/madden_league_types"

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
  ctx.status = 200
})
EventDB.on<MaddenBroadcastEvent>("MADDEN_BROADCAST", async (events) => {
  events.map(async broadcastEvent => {
    const discordServer = broadcastEvent.key
    const doc = await db.collection("league_settings").doc(discordServer).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    const configuration = leagueSettings.commands?.broadcast
    if (!configuration) {
      console.error(`${discordServer} is not configured for Broadcasts`)
    } else {
      const channel = configuration.channel.id
      const role = configuration.role ? `<@&${configuration.role.id}>` : ""
      await prodClient.requestDiscord(`channels/${channel}/messages`, {
        method: "POST",
        body: {
          content: `${role} ${broadcastEvent.title}\n\n${broadcastEvent.video}`
        }
      })
    }
  })
})

async function updateScoreboard(leagueSettings: LeagueSettings, guildId: string, seasonIndex: number, week: number) {
  const leagueId = leagueSettings.commands.madden_league?.league_id
  if (!leagueId) {
    return
  }
  const weekState = leagueSettings.commands.game_channel?.weekly_states?.[createWeekKey(seasonIndex, week)]
  const scoreboard_channel = leagueSettings.commands.game_channel?.scoreboard_channel
  if (!scoreboard_channel) {
    return
  }
  const scoreboard = weekState?.scoreboard
  if (!scoreboard) {
    return
  }
  const teams = await MaddenClient.getLatestTeams(leagueId)
  const games = await MaddenClient.getWeekScheduleForSeason(leagueId, week, seasonIndex)
  const sims = await EventDB.queryEvents<ConfirmedSim>(guildId, "CONFIRMED_SIM", new Date(0), { week: week, seasonIndex: seasonIndex }, 30)
  const message = formatScoreboard(week, seasonIndex, games, teams, sims)
  try {
    await prodClient.requestDiscord(`channels/${scoreboard_channel.id}/messages/${scoreboard.id}`, { method: "PATCH", body: { content: message, allowed_mentions: { parse: [] } } })
  } catch (e) {
    console.warn(`could not update scoreboard ${e}`)
  }
}

EventDB.on<ConfirmedSim>("CONFIRMED_SIM", async (events) => {
  await Promise.all(events.map(async sim => {
    const guild_id = sim.key
    const doc = await db.collection("league_settings").doc(guild_id).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    await updateScoreboard(leagueSettings, guild_id, sim.seasonIndex, sim.week)
  }))
})

MaddenDB.on<MaddenGame>("MADDEN_SCHEDULE", async (events) => {
  Object.entries(Object.groupBy(events, e => e.key)).map(async entry => {
    const [leagueId, groupedGames] = entry
    const games = groupedGames || []
    const finishedGames = games.filter(g => g.status !== 1)
    const finishedGame = finishedGames[0]
    const querySnapshot = await db.collection("league_settings").where("commands.madden_league.league_id", "==", leagueId).get()
    await Promise.all(querySnapshot.docs.map(async leagueSettingsDoc => {
      const settings = leagueSettingsDoc.data() as LeagueSettings
      const guild_id = leagueSettingsDoc.id
      if (finishedGame) {
        const season = finishedGame.seasonIndex
        const week = finishedGame.weekIndex + 1
        await updateScoreboard(settings, guild_id, season, week)
        const notifier = createNotifier(prodClient, guild_id, settings)
        const gameIds = new Set(finishedGames.map(g => g.scheduleId))
        await Promise.all(Object.values(settings.commands.game_channel?.weekly_states?.[createWeekKey(season, week)]?.channel_states || {}).map(async channelState => {
          if (gameIds.has(channelState.scheduleId)) {
            try {
              await notifier.deleteGameChannel(channelState, season, week, [{ id: SNALLABOT_USER, id_type: DiscordIdType.USER }])
            } catch (e) {
              console.log("could not delete channel: " + channelState.channel.id)
            }
          }
        }))
      }
    }))
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
  const guildId = guild.id
  const doc = await db.collection("league_settings").doc(guildId).get()
  if (!doc.exists) {
    return
  }
  const leagueSettings = doc.data() as LeagueSettings
  if (leagueSettings.commands.teams) {
    const assignments = leagueSettings.commands.teams?.assignments || {} as TeamAssignments
    await Promise.all(Object.entries(assignments).map(async entry => {
      const [teamId, assignment] = entry
      if (assignment.discord_user?.id === user.id) {
        await db.collection("league_settings").doc(guildId).update({
          [`commands.teams.assignments.${teamId}.discord_user`]: FieldValue.delete()
        })
        delete assignments[teamId].discord_user
      }
    }))
    const message = await fetchTeamsMessage(leagueSettings)
    try {
      await prodClient.requestDiscord(`channels/${leagueSettings.commands.teams.channel.id}/messages/${leagueSettings.commands.teams.messageId.id}`,
        { method: "PATCH", body: { content: message, allowed_mentions: { parse: [] } } })
    } catch (e) {
      console.log("could not update team message " + e)
    }
  }
});

discordClient.on("guildMemberUpdate", async (member, old) => {

  const guildId = member.guildID
  console.log("role updated " + guildId)
  const doc = await db.collection("league_settings").doc(guildId).get()
  if (!doc.exists) {
    return
  }
  const leagueSettings = doc.data() as LeagueSettings
  if (leagueSettings.commands.teams?.useRoleUpdates) {
    const res = await prodClient.requestDiscord(
      `guilds/${guildId}/members?limit=1000`,
      {
        method: "GET",
      }
    )
    const users = await res.json() as APIGuildMember[]
    const userWithRoles = users.map((u) => ({ id: u.user.id, roles: u.roles }))
    const assignments = leagueSettings.commands.teams.assignments || {} as TeamAssignments
    await Promise.all(Object.entries(assignments).map(async entry => {
      const [teamId, assignment] = entry
      if (assignment.discord_role?.id) {
        const userInTeam = userWithRoles.filter(u => u.roles.includes(assignment.discord_role?.id || ""))
        if (userInTeam.length === 0) {
          await db.collection("league_settings").doc(guildId).update({
            [`commands.teams.assignments.${teamId}.discord_user`]: FieldValue.delete()
          })
          delete assignments[teamId].discord_user

        } else if (userInTeam.length === 1) {
          await db.collection("league_settings").doc(guildId).update({
            [`commands.teams.assignments.${teamId}.discord_user`]: { id: userInTeam[0].id, id_type: DiscordIdType.USER }
          })
          assignments[teamId].discord_user = { id: userInTeam[0].id, id_type: DiscordIdType.USER }
        } else {
          console.log(`Found multiple users ${userInTeam.map(u => u.id)} with role ${assignment.discord_role.id}`)
        }
      }
    }))
    const message = await fetchTeamsMessage(leagueSettings)
    try {
      await prodClient.requestDiscord(`channels/${leagueSettings.commands.teams.channel.id}/messages/${leagueSettings.commands.teams.messageId.id}`,
        { method: "PATCH", body: { content: message, allowed_mentions: { parse: [] } } })
    } catch (e) {
      console.log("could not update team message " + e)
    }
  }
});

const validReactions = ["🏆", "⏭️"];

function getRandomInt(max: number) {
  return Math.floor(Math.random() * max);
}


discordClient.on("messageReactionAdd", async (msg, reactor, reaction) => {
  // don't respond when bots react!
  if (reactor.id === SNALLABOT_USER || reactor.id === SNALLABOT_TEST_USER
  ) {
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
  await Promise.all(Object.values(weeklyStates).map(async weeklyState => {
    await Promise.all(Object.entries(weeklyState.channel_states).map(async channelEntry => {
      const [channelId, channelState] = channelEntry
      if (channelId === reactionChannel && channelState.message.id === reactionMessage) {
        const notifier = createNotifier(prodClient, guild, leagueSettings)
        // wait for users to confirm/unconfirm
        const jitter = getRandomInt(10)
        await new Promise((r) => setTimeout(r, 5000 + jitter * 1000));
        try {

          await notifier.update(channelState, weeklyState.seasonIndex, weeklyState.week)
        } catch (e) {
          console.log("could not update notifier " + e)
        }
      }
    }))
  }))
})
if (process.env.APP_ID !== SNALLABOT_TEST_USER) {
  discordClient.connect()
}


export default router
