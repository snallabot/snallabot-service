import { Autocomplete, Command, MessageComponentInteraction } from "../commands_handler"
import { createMessageResponse, DiscordClient, NoConnectedLeagueError } from "../discord_utils"
import LeagueSettingsDB, { ChannelId, DiscordIdType, RoleId } from "../settings_db"
import TradeDB, { TradeAsset, TradeSubmission, TradeVote } from "../trade_db"
import MaddenDB from "../../db/madden_db"
import { DevTrait, MADDEN_SEASON, Player } from "../../export/madden_league_types"
import { discordLeagueView } from "../../db/view"
import { retrieveTeam } from "./teams"
import fuzzysort from "fuzzysort"
import {
  APIApplicationCommandInteractionDataIntegerOption,
  APIApplicationCommandInteractionDataStringOption,
  APIApplicationCommandInteractionDataSubcommandOption,
  APIApplicationCommandInteractionDataChannelOption,
  APIApplicationCommandInteractionDataRoleOption,
  ApplicationCommandOptionType,
  ButtonStyle,
  ChannelType,
  ComponentType,
  InteractionResponseType,
  RESTPostAPIApplicationCommandsJSONBody
} from "discord-api-types/v10"

const PLAYER_OPTIONS = ["team_a_player_1", "team_a_player_2", "team_a_player_3", "team_b_player_1", "team_b_player_2", "team_b_player_3"]
const PICK_OPTIONS = ["team_a_pick_1", "team_a_pick_2", "team_a_pick_3", "team_b_pick_1", "team_b_pick_2", "team_b_pick_3"]

function optionMap(subcommand: APIApplicationCommandInteractionDataSubcommandOption) {
  return new Map((subcommand.options || []).map(option => [option.name, option]))
}

function stringOption(options: Map<string, any>, name: string): string | undefined {
  return (options.get(name) as APIApplicationCommandInteractionDataStringOption | undefined)?.value
}

function devName(dev: DevTrait) {
  return DevTrait[dev]?.replace("XFACTOR", "X-Factor").replace("SUPERSTAR", "Superstar").replace("STAR", "Star").replace("NORMAL", "Normal") || "Unknown"
}

function playerAsset(player: Player): TradeAsset {
  return {
    type: "PLAYER",
    rosterId: player.rosterId,
    name: `${player.firstName} ${player.lastName}`,
    position: player.position,
    age: player.age,
    overall: player.playerBestOvr,
    dev: devName(player.devTrait)
  }
}

function assetLine(asset: TradeAsset) {
  if (asset.type === "PICK") return `• 🏈 ${asset.label}`
  return `• **${asset.position} ${asset.name}** — Age ${asset.age} | ${asset.overall} OVR | ${asset.dev}`
}

function tradeMessage(trade: TradeSubmission) {
  const approvals = Object.values(trade.votes).filter(v => v === "APPROVE").length
  const rejections = Object.values(trade.votes).filter(v => v === "REJECT").length
  const statusEmoji = trade.status === "APPROVED" ? "✅" : trade.status === "REJECTED" ? "❌" : "⏳"
  return [
    "# 🏈 Trade Approval",
    `## ${trade.teamA.name} receive`,
    trade.teamA.assets.map(assetLine).join("\n"),
    `## ${trade.teamB.name} receive`,
    trade.teamB.assets.map(assetLine).join("\n"),
    `**Submitted by:** <@${trade.submittedBy}>`,
    `**Votes:** ✅ ${approvals} | ❌ ${rejections} | ${trade.requiredApprovals} required`,
    `**Status:** ${statusEmoji} ${trade.status}`
  ].join("\n\n")
}

function voteComponents(trade: TradeSubmission) {
  const disabled = trade.status !== "PENDING"
  return [{
    type: ComponentType.ActionRow,
    components: [
      { type: ComponentType.Button, style: ButtonStyle.Success, label: "Approve", custom_id: `trade_vote:${trade.id}:APPROVE`, disabled },
      { type: ComponentType.Button, style: ButtonStyle.Danger, label: "Reject", custom_id: `trade_vote:${trade.id}:REJECT`, disabled }
    ]
  }]
}

async function playerChoices(query: string, leagueId: string, teamId?: number) {
  const [players, teams] = await Promise.all([MaddenDB.getLatestPlayers(leagueId), MaddenDB.getLatestTeams(leagueId)])
  const searchable = players
    .filter(player => teamId == null || Number(player.teamId) === teams.getTeamForId(teamId).teamId)
    .map(player => ({ ...player, teamAbbr: player.teamId === "0" ? "FA" : teams.getTeamForId(Number(player.teamId)).abbrName }))
  return fuzzysort.go(query, searchable, { keys: ["firstName", "lastName", "position", "teamAbbr"], threshold: 0.4, limit: 25 })
    .map(result => ({ name: `${result.obj.teamAbbr} ${result.obj.position} ${result.obj.firstName} ${result.obj.lastName}`, value: result.obj.rosterId }))
}

function submitOption(name: string, description: string, required = false) {
  return { type: ApplicationCommandOptionType.String as const, name, description, required, autocomplete: true as const }
}

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const subcommand = command.data.options?.[0] as APIApplicationCommandInteractionDataSubcommandOption | undefined
    if (!subcommand) throw new Error("Trade command is missing its subcommand")
    const options = optionMap(subcommand)

    if (subcommand.name === "configure") {
      const channelValue = (options.get("channel") as APIApplicationCommandInteractionDataChannelOption).value
      const roleValue = (options.get("commissioner_role") as APIApplicationCommandInteractionDataRoleOption).value
      const requiredApprovals = Number((options.get("required_approvals") as APIApplicationCommandInteractionDataIntegerOption).value)
      const channel: ChannelId = { id: channelValue, id_type: DiscordIdType.CHANNEL }
      const commissionerRole: RoleId = { id: roleValue, id_type: DiscordIdType.ROLE }
      await LeagueSettingsDB.configureTrade(command.guild_id, { channel, commissionerRole, requiredApprovals })
      return createMessageResponse(`Trade approval configured in <#${channel.id}>. <@&${commissionerRole.id}> needs ${requiredApprovals} approval vote(s).`)
    }

    if (subcommand.name !== "submit") throw new Error(`Unknown trade subcommand ${subcommand.name}`)
    const settings = await LeagueSettingsDB.getLeagueSettings(command.guild_id)
    const tradeConfig = settings.commands.trade
    if (!tradeConfig) throw new Error("Trade approvals are not configured. Run /trade configure first")
    const leagueId = settings.commands.madden_league?.league_id
    if (!leagueId) throw new NoConnectedLeagueError(command.guild_id)

    const teams = await MaddenDB.getLatestTeams(leagueId)
    const teamA = retrieveTeam(stringOption(options, "team_a")!, teams)
    const teamB = retrieveTeam(stringOption(options, "team_b")!, teams)
    if (teamA.teamId === teamB.teamId) throw new Error("A team cannot trade with itself")

    async function assetsFor(side: "team_a" | "team_b", expectedTeamId: number) {
      const playerIds = PLAYER_OPTIONS.filter(name => name.startsWith(side)).map(name => stringOption(options, name)).filter((id): id is string => !!id)
      const players = await Promise.all(playerIds.map(id => MaddenDB.getPlayer(leagueId!, id)))
      if (players.some(player => player.teamId !== expectedTeamId)) throw new Error(`One or more ${side.replace("_", " ")} players are not on that team`)
      const picks: TradeAsset[] = PICK_OPTIONS.filter(name => name.startsWith(side)).map(name => stringOption(options, name)).filter((pick): pick is string => !!pick).map(label => ({ type: "PICK", label }))
      return [...players.map(playerAsset), ...picks]
    }

    const [teamAAssets, teamBAssets] = await Promise.all([assetsFor("team_a", teamA.teamId), assetsFor("team_b", teamB.teamId)])
    if (teamAAssets.length === 0 || teamBAssets.length === 0) throw new Error("Each team must send at least one player or pick")

    const trade = await TradeDB.create({
      guildId: command.guild_id,
      leagueId,
      submittedBy: command.member.user.id,
      teamA: { id: teamA.teamId, name: teamA.displayName, assets: teamBAssets },
      teamB: { id: teamB.teamId, name: teamB.displayName, assets: teamAAssets },
      votes: {},
      requiredApprovals: tradeConfig.requiredApprovals,
      status: "PENDING",
      createdAt: Date.now()
    })
    const messageId = await client.createComponentMessage(tradeConfig.channel, { content: tradeMessage(trade), components: voteComponents(trade), allowed_mentions: { parse: [] } })
    await TradeDB.attachMessage(trade.id, messageId)
    return createMessageResponse(`Trade submitted for commissioner approval in <#${tradeConfig.channel.id}>.`)
  },

  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    const team = (name: string, description: string) => submitOption(name, description, true)
    const player = (name: string) => submitOption(name, "Player being sent by this team")
    const pick = (name: string) => submitOption(name, "Draft pick being sent by this team")
    return {
      name: "trade",
      description: "Configure and submit trades for commissioner approval",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "Configure the trade channel, commissioner role, and approval count",
          options: [
            { type: ApplicationCommandOptionType.Channel, name: "channel", description: "Channel where trades are posted", required: true, channel_types: [ChannelType.GuildText] },
            { type: ApplicationCommandOptionType.Role, name: "commissioner_role", description: "Role allowed to vote", required: true },
            { type: ApplicationCommandOptionType.Integer, name: "required_approvals", description: "Approvals required to pass a trade", required: true, min_value: 1, max_value: 25 }
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "submit",
          description: "Submit a trade for commissioner approval",
          options: [
            team("team_a", "First team"), team("team_b", "Second team"),
            player("team_a_player_1"), player("team_a_player_2"), player("team_a_player_3"),
            pick("team_a_pick_1"), pick("team_a_pick_2"), pick("team_a_pick_3"),
            player("team_b_player_1"), player("team_b_player_2"), player("team_b_player_3"),
            pick("team_b_pick_1"), pick("team_b_pick_2"), pick("team_b_pick_3")
          ]
        }
      ]
    }
  },

  async choices(command: Autocomplete) {
    const subcommand = command.data.options?.[0] as APIApplicationCommandInteractionDataSubcommandOption | undefined
    if (!subcommand || subcommand.name !== "submit") return []
    const focused = subcommand.options?.find(option => "focused" in option && option.focused) as APIApplicationCommandInteractionDataStringOption | undefined
    if (!focused) return []
    const view = await discordLeagueView.createView(command.guild_id)
    if (!view?.leagueId) return []
    const options = optionMap(subcommand)

    if (focused.name === "team_a" || focused.name === "team_b") {
      const teams = await MaddenDB.getLatestTeams(view.leagueId)
      return fuzzysort.go(String(focused.value), teams.getLatestTeams(), { keys: ["cityName", "abbrName", "nickName", "displayName"], threshold: 0.4, limit: 25 })
        .map(result => ({ name: result.obj.displayName, value: String(result.obj.teamId) }))
    }
    if (PLAYER_OPTIONS.includes(focused.name)) {
      const side = focused.name.startsWith("team_a") ? "team_a" : "team_b"
      const teamId = Number(stringOption(options, side))
      return playerChoices(String(focused.value), view.leagueId, Number.isNaN(teamId) ? undefined : teamId)
    }
    if (PICK_OPTIONS.includes(focused.name)) {
      const query = String(focused.value).toLowerCase()
      return [MADDEN_SEASON, MADDEN_SEASON + 1, MADDEN_SEASON + 2].flatMap(year => Array.from({ length: 7 }, (_, round) => `${year} Round ${round + 1}`))
        .filter(label => label.toLowerCase().includes(query)).slice(0, 25).map(label => ({ name: label, value: label }))
    }
    return []
  },

  async handleInteraction(interaction: MessageComponentInteraction) {
    const [, tradeId, voteValue] = interaction.custom_id.split(":")
    if (!tradeId || (voteValue !== "APPROVE" && voteValue !== "REJECT")) throw new Error("Invalid trade vote")
    const settings = await LeagueSettingsDB.getLeagueSettings(interaction.guild_id)
    const config = settings.commands.trade
    if (!config) throw new Error("Trade approvals are not configured")
    if (!interaction.member.roles.includes(config.commissionerRole.id)) {
      return { type: InteractionResponseType.ChannelMessageWithSource, data: { content: "Only commissioners can vote on trades.", flags: 64 } }
    }
    const trade = await TradeDB.vote(tradeId, interaction.member.user.id, voteValue as TradeVote)
    return { type: InteractionResponseType.UpdateMessage, data: { content: tradeMessage(trade), components: voteComponents(trade), allowed_mentions: { parse: [] } } }
  }
}
