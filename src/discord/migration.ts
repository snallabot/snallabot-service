import db from "../db/firebase"
import { initializeApp, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import { readFileSync } from "node:fs";
import { BroadcastConfiguration, DiscordIdType, GameChannelConfiguration, LeagueSettings, LoggerConfiguration, MaddenLeagueConfiguration, StreamCountConfiguration, TeamAssignment, TeamConfiguration, UserId, WaitlistConfiguration } from "./settings_db";
import EventDB, { StoredEvent } from "../db/events_db";
import { BroadcastConfigurationEvent } from "../db/events";

if (!process.env.SERVICE_ACCOUNT_OLD_FILE) {
  throw new Error("need SA")
}
const serviceAccount = JSON.parse(readFileSync(process.env.SERVICE_ACCOUNT_OLD_FILE, 'utf8'))
const oldDB = initializeApp({
  credential: cert(serviceAccount),
  projectId: "championslounge-f0f36",
  storageBucket: "championslounge-f0f36.appspot.com",
}, "old")

const oDb = getFirestore(oldDB)

async function convertGameChannels(old: any): Promise<GameChannelConfiguration | undefined> {

  if (old.adminRole && old.category && old.fwChannel && old.waitPing) {
    // TODO: delete channels
    return {
      admin: { id: old.adminRole, id_type: DiscordIdType.ROLE },
      default_category: { id: old.category, id_type: DiscordIdType.CATEGORY },
      scoreboard_channel: { id: old.fwChannel, id_type: DiscordIdType.CHANNEL },
      wait_ping: old.waitPing,
      weekly_states: {}
    }
  }
  return undefined
}

async function convertLogger(old: any): Promise<LoggerConfiguration | undefined> {
  if (old.on) {
    return {
      channel: { id: old.channel, id_type: DiscordIdType.CHANNEL }
    }
  } else {
    undefined
  }
}

async function convertStreamCounts(old: any): Promise<StreamCountConfiguration | undefined> {
  if (old.channel && old.message) {
    return {
      channel: { id: old.channel, id_type: DiscordIdType.CHANNEL },
      counts: Object.entries(old.counts || {}).map(entry => {
        const user = entry[0] as string
        const count = entry[1] as number
        return { user: { id: entry[0], id_type: DiscordIdType.USER }, count: count }
      }),
      message: { id: old.message, id_type: DiscordIdType.MESSAGE }
    }
  }
}

async function convertWaitlist(old: any): Promise<WaitlistConfiguration> {
  return {
    current_waitlist: (old as string[]).map(u => ({ id: u, id_type: DiscordIdType.USER }))
  }
}

async function convertMaddenLeague(league: string): Promise<MaddenLeagueConfiguration> {
  return {
    league_id: league
  }
}

async function convertTeams(old: any, teams: any): Promise<TeamConfiguration | undefined> {
  if (old.channel && old.message) {
    const assignments = Object.fromEntries(Object.entries(teams).flatMap(entry => {
      const teamId = entry[0] as string
      const team = entry[1] as any
      if (team.discordUser || team.trackingRole) {
        const assignment: TeamAssignment = {}
        if (team.discordUser) {
          assignment.discord_user = { id: team.discordUser, id_type: DiscordIdType.USER }
        }
        if (team.trackingRole) {
          assignment.discord_role = { id: team.trackingRole, id_type: DiscordIdType.ROLE }
        }
        return [[teamId, assignment]]
      }
      return []
    }))
    return {
      channel: { id: old.channel, id_type: DiscordIdType.CHANNEL },
      messageId: { id: old.message, id_type: DiscordIdType.MESSAGE },
      useRoleUpdates: old.autoUpdate || false,
      assignments: assignments
    }
  }
}

async function migrateBroadcast(guild: string): Promise<BroadcastConfiguration | undefined> {
  const broadcastEvents = await EventDB.queryEvents<BroadcastConfigurationEvent>(guild, "BROADCAST_CONFIGURATION", new Date(0), {}, 1)
  const sortedEvents = broadcastEvents.sort((a: StoredEvent<BroadcastConfigurationEvent>, b: StoredEvent<BroadcastConfigurationEvent>) => b.timestamp.getTime() - a.timestamp.getTime())
  if (sortedEvents.length !== 0) {
    const configuration = sortedEvents[0]
    const newConf = {
      title_keyword: configuration.title_keyword,
      channel: { id: configuration.channel_id, id_type: DiscordIdType.CHANNEL }

    } as BroadcastConfiguration
    if (configuration.role) {
      newConf.role = { id: configuration.role, id_type: DiscordIdType.ROLE }
    }
    return newConf
  }
}

async function convertLeagues() {
  const docSnapshot = await oDb.collection('leagues').get()
  await Promise.all(docSnapshot.docs.map(async doc => {
    const guild = doc.id
    const oldLeagueData = doc.data() as any
    const newSettings = { commands: {} } as LeagueSettings
    if (oldLeagueData.commands?.game_channels) {
      const translatedGameChannels = await convertGameChannels(oldLeagueData.commands.game_channels)
      if (translatedGameChannels) {
        newSettings.commands.game_channel = translatedGameChannels
      }
    }
    if (oldLeagueData.commands?.logger?.on) {
      const translatedLogger = await convertLogger(oldLeagueData.commands.logger)
      if (translatedLogger) {
        newSettings.commands.logger = translatedLogger
      }
    }
    if (oldLeagueData.commands?.streams) {
      const translatedStreams = await convertStreamCounts(oldLeagueData.commands.streams)
      if (translatedStreams) {
        newSettings.commands.stream_count = translatedStreams
      }
    }
    if (oldLeagueData.commands?.waitlist) {
      const waitlist = await convertWaitlist(oldLeagueData.commands.waitlist)
      if (waitlist) {
        newSettings.commands.waitlist = waitlist
      }
    }
    if (oldLeagueData.commands?.teams) {
      const teams = await convertTeams(oldLeagueData.commands.teams, oldLeagueData.teams)
      if (teams) {
        newSettings.commands.teams = teams
      }
    }
    if (oldLeagueData.commands?.league_id) {
      const league = await convertMaddenLeague(oldLeagueData.commands.league_id)
      if (league) {
        newSettings.commands.madden_league = league
      }
    }
    const broadcast = await migrateBroadcast(guild)
    if (broadcast) {
      newSettings.commands.broadcast = broadcast
    }
    console.log("successfully migrated league " + guild)
  }))
}

convertLeagues()
