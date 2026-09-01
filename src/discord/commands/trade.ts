import {
  Autocomplete,
  Command,
  MessageComponentInteraction,
} from "../commands_handler";
import {
  createMessageResponse,
  DiscordClient,
  NoConnectedLeagueError,
  devEmoji,
} from "../discord_utils";
import LeagueSettingsDB, {
  ChannelId,
  DiscordIdType,
  RoleId,
} from "../settings_db";
import TradeDB, { TradeAsset, TradeStatus, TradeSubmission, TradeVote } from "../trade_db";
import MaddenDB from "../../db/madden_db";
import {
  DevTrait,
  MADDEN_SEASON,
  Player,
} from "../../export/madden_league_types";
import { discordLeagueView } from "../../db/view";
import { retrieveTeam } from "./teams";
import fuzzysort from "fuzzysort";
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
  RESTPostAPIApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import { error } from "console";

const TEAM_A_PLAYER_OPTIONS = [
  "team_a_player_1",
  "team_a_player_2",
  "team_a_player_3",
];
const TEAM_B_PLAYER_OPTIONS = [
  "team_b_player_1",
  "team_b_player_2",
  "team_b_player_3",
];
const TEAM_A_PICK_OPTIONS = ["team_a_pick_1", "team_a_pick_2", "team_a_pick_3"];
const TEAM_B_PICK_OPTIONS = ["team_b_pick_1", "team_b_pick_2", "team_b_pick_3"];

function optionMap(
  subcommand: APIApplicationCommandInteractionDataSubcommandOption,
) {
  return new Map(
    (subcommand.options || []).map((option) => [option.name, option]),
  );
}

function stringOption(
  options: Map<string, any>,
  name: string,
): string | undefined {
  return (
    options.get(name) as
      | APIApplicationCommandInteractionDataStringOption
      | undefined
  )?.value;
}

function playerAsset(player: Player, useHiddenDevs: boolean): TradeAsset {
  return {
    type: "PLAYER",
    rosterId: player.rosterId,
    name: `${player.firstName} ${player.lastName}`,
    position: player.position,
    age: player.age,
    overall: player.playerBestOvr,
    dev: devEmoji(player.devTrait, player.yearsPro, useHiddenDevs),
  };
}

function assetLine(asset: TradeAsset) {
  if (asset.type === "PICK") return `>  **${asset.label}**`;
  return `> ${asset.dev} **${asset.position} ${asset.name}** — ${asset.overall} OVR | Age ${asset.age}`;
}

function tradeMessage(trade: TradeSubmission) {
  const approvals = Object.values(trade.votes).filter(
    (vote) => vote === TradeVote.APPROVE,
  ).length;
  const rejections = Object.values(trade.votes).filter(
    (vote) => vote === TradeVote.REJECT,
  ).length;
  const statusEmoji =
    trade.status === TradeStatus.APPROVED
      ? "✅"
      : trade.status === TradeStatus.REJECTED
        ? "❌"
        : "⏳";
  return [
    "# 🔄 Trade Approval",
    `## ${trade.teamA.name} Receives`,
    trade.teamA.assets.map(assetLine).join("\n"),
    `## ${trade.teamB.name} Receives`,
    trade.teamB.assets.map(assetLine).join("\n"),
    `**Submitted by:** <@${trade.submittedBy}>`,
    `**Commissioner votes:** ✅ ${approvals} Approve | ❌ ${rejections} Reject`,
    `**Required approvals:** ${trade.requiredApprovals}`,
    `**Status:** ${statusEmoji} ${trade.status}`,
  ].join("\n\n");
}

function voteComponents(trade: TradeSubmission) {
  const disabled = trade.status !== TradeStatus.PENDING;
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Success,
          label: "Approve",
          custom_id: `trade_vote:${trade.id}:${TradeVote.APPROVE}`,
          disabled,
        },
        {
          type: ComponentType.Button,
          style: ButtonStyle.Danger,
          label: "Reject",
          custom_id: `trade_vote:${trade.id}:${TradeVote.REJECT}`,
          disabled,
        },
      ],
    },
  ];
}

async function playerChoices(query: string, leagueId: string, teamId?: number) {
  const [players, teams] = await Promise.all([
    MaddenDB.getLatestPlayers(leagueId),
    MaddenDB.getLatestTeams(leagueId),
  ]);
  const searchable = players
    .filter(
      (player) =>
        teamId == null ||
        Number(player.teamId) === teams.getTeamForId(teamId).teamId,
    )
    .map((player) => ({
      ...player,
      teamAbbr:
        player.teamId === "0"
          ? "" 
          : teams.getTeamForId(Number(player.teamId)).abbrName,
    }));
  return fuzzysort
    .go(query, searchable, {
      keys: ["firstName", "lastName", "position", "teamAbbr"],
      threshold: 0.4,
      limit: 25,
    })
    .map((result) => ({
      name: `${result.obj.teamAbbr} • ${result.obj.position} ${result.obj.firstName} ${result.obj.lastName}`,
      value: result.obj.rosterId,
    }));
}

function submitOption(name: string, description: string, required = false) {
  return {
    type: ApplicationCommandOptionType.String as const,
    name,
    description,
    required,
    autocomplete: true as const,
  };
}

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const subcommand = command.data.options?.[0] as
      | APIApplicationCommandInteractionDataSubcommandOption
      | undefined;
    if (!subcommand) throw new Error("Trade command is missing its subcommand");
    const options = optionMap(subcommand);

    if (subcommand.name === "configure") {
      const channelValue = (
        options.get(
          "channel",
        ) as APIApplicationCommandInteractionDataChannelOption
      ).value;
      const roleValue = (
        options.get(
          "commissioner_role",
        ) as APIApplicationCommandInteractionDataRoleOption
      ).value;
      const requiredApprovals = Number(
        (
          options.get(
            "required_approvals",
          ) as APIApplicationCommandInteractionDataIntegerOption
        ).value,
      );
      const channel: ChannelId = {
        id: channelValue,
        id_type: DiscordIdType.CHANNEL,
      };
      const commissionerRole: RoleId = {
        id: roleValue,
        id_type: DiscordIdType.ROLE,
      };
      await LeagueSettingsDB.configureTrade(command.guild_id, {
        channel,
        commissionerRole,
        requiredApprovals,
      });
      return createMessageResponse(
        `Trade approval configured in <#${channel.id}>. <@&${commissionerRole.id}> needs ${requiredApprovals} approval vote(s).`,
      );
    }

    if (subcommand.name !== "submit")
      throw new Error(`Unknown trade subcommand ${subcommand.name}`);
    const settings = await LeagueSettingsDB.getLeagueSettings(command.guild_id);
    const tradeConfig = settings.commands.trade;
    if (!tradeConfig)
      throw new Error(
        "Trade approvals are not configured. Run /trade configure first",
      );
    const leagueId = settings.commands.madden_league?.league_id;
    if (!leagueId) throw new NoConnectedLeagueError(command.guild_id);

    const teams = await MaddenDB.getLatestTeams(leagueId);
    const teamA = retrieveTeam(stringOption(options, "team_a")!, teams);
    const teamB = retrieveTeam(stringOption(options, "team_b")!, teams);
    if (teamA.teamId === teamB.teamId)
      throw new Error("A team cannot trade with itself");

    async function assetsFor(
      playerOptionNames: string[],
      pickOptionNames: string[],
      expectedTeamId: number,
      teamName: string,
    ) {
      const playerIds = playerOptionNames
        .map((name) => stringOption(options, name))
        .filter((id): id is string => !!id);
      const players = await Promise.all(
        playerIds.map((id) => MaddenDB.getPlayer(leagueId!, id)),
      );
      if (players.some((player) => player.teamId !== expectedTeamId))
        throw new Error(
          `One or more selected players are not on the ${teamName}`,
        );
      const picks: TradeAsset[] = pickOptionNames
        .map((name) => stringOption(options, name))
        .filter((pick): pick is string => !!pick)
        .map((label) => ({ type: "PICK", label }));
      return [
        ...players.map((player) =>
          playerAsset(player, settings.commands.player?.useHiddenDevs ?? true),
        ),
        ...picks,
      ];
    }

    const [teamAAssets, teamBAssets] = await Promise.all([
      assetsFor(
        TEAM_A_PLAYER_OPTIONS,
        TEAM_A_PICK_OPTIONS,
        teamA.teamId,
        teamA.displayName,
      ),
      assetsFor(
        TEAM_B_PLAYER_OPTIONS,
        TEAM_B_PICK_OPTIONS,
        teamB.teamId,
        teamB.displayName,
      ),
    ]);
    if (teamAAssets.length === 0 || teamBAssets.length === 0)
      throw new Error("Each team must send at least one player or pick");

    const trade = await TradeDB.create({
      guildId: command.guild_id,
      leagueId,
      submittedBy: command.member.user.id,
      teamA: { id: teamA.teamId, name: teamA.displayName, assets: teamBAssets },
      teamB: { id: teamB.teamId, name: teamB.displayName, assets: teamAAssets },
      votes: {},
      requiredApprovals: tradeConfig.requiredApprovals,
      status: TradeStatus.PENDING,
      createdAt: Date.now(),
    });
    const messageId = await client.createComponentMessage(tradeConfig.channel, {
      content: tradeMessage(trade),
      components: voteComponents(trade),
      allowed_mentions: { parse: [] },
    });
    await TradeDB.attachMessage(trade.id, messageId);
    return createMessageResponse(
      `Trade submitted for commissioner approval in <#${tradeConfig.channel.id}>.`,
    );
  },

  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    const team = (name: string, description: string) =>
      submitOption(name, description, true);
    const player = (name: string, teamLabel: string, number: number) =>
      submitOption(name, `${teamLabel} player ${number} (optional)`);
    const pick = (name: string, teamLabel: string, number: number) =>
      submitOption(name, `${teamLabel} draft pick ${number} (optional)`);
    return {
      name: "trade",
      description: "Configure and submit trades for commissioner approval",
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description:
            "Configure the trade channel, commissioner role, and approval count",
          options: [
            {
              type: ApplicationCommandOptionType.Channel,
              name: "channel",
              description: "Channel where trades are posted",
              required: true,
              channel_types: [ChannelType.GuildText],
            },
            {
              type: ApplicationCommandOptionType.Role,
              name: "commissioner_role",
              description: "Role allowed to vote",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "required_approvals",
              description: "Approvals required to pass a trade",
              required: true,
              min_value: 1,
              max_value: 25,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "submit",
          description: "Submit a trade for commissioner approval",
          options: [
            team("team_a", "Team sending the first group of assets"),
            team("team_b", "Team sending the second group of assets"),
            player("team_a_player_1", "Team A", 1),
            player("team_a_player_2", "Team A", 2),
            player("team_a_player_3", "Team A", 3),
            pick("team_a_pick_1", "Team A", 1),
            pick("team_a_pick_2", "Team A", 2),
            pick("team_a_pick_3", "Team A", 3),
            player("team_b_player_1", "Team B", 1),
            player("team_b_player_2", "Team B", 2),
            player("team_b_player_3", "Team B", 3),
            pick("team_b_pick_1", "Team B", 1),
            pick("team_b_pick_2", "Team B", 2),
            pick("team_b_pick_3", "Team B", 3),
          ],
        },
      ],
    };
  },

  async choices(command: Autocomplete) {
    const subcommand = command.data.options?.[0] as
      | APIApplicationCommandInteractionDataSubcommandOption
      | undefined;
    if (!subcommand || subcommand.name !== "submit") return [];
    const focused = subcommand.options?.find(
      (option) => "focused" in option && option.focused,
    ) as APIApplicationCommandInteractionDataStringOption | undefined;
    if (!focused) return [];
    const view = await discordLeagueView.createView(command.guild_id);
    if (!view?.leagueId) return [];
    const options = optionMap(subcommand);

    if (focused.name === "team_a" || focused.name === "team_b") {
      const teams = await MaddenDB.getLatestTeams(view.leagueId);
      const allTeams = teams
        .getLatestTeams()
        .sort((first, second) =>
          first.displayName.localeCompare(second.displayName),
        );
      const query = String(focused.value ?? "").trim();

      if (!query) {
        return allTeams.slice(0, 25).map((team) => ({
          name: team.displayName,
          value: String(team.teamId),
        }));
      }

      return fuzzysort
        .go(query, allTeams, {
          keys: ["cityName", "abbrName", "nickName", "displayName"],
          threshold: 0.2,
          limit: 25,
        })
        .map((result) => ({
          name: result.obj.displayName,
          value: String(result.obj.teamId),
        }));
    }
    if (TEAM_A_PLAYER_OPTIONS.includes(focused.name) || TEAM_B_PLAYER_OPTIONS.includes(focused.name)) {
      const side = focused.name.startsWith("team_a") ? "team_a" : "team_b";
      const teamId = Number(stringOption(options, side));
      return playerChoices(
        String(focused.value),
        view.leagueId,
        Number.isNaN(teamId) ? undefined : teamId,
      );
    }
    if (TEAM_A_PICK_OPTIONS.includes(focused.name)|| TEAM_B_PICK_OPTIONS.includes(focused.name)) {
      const query = String(focused.value).toLowerCase();
      const ordinal = (round: number) =>
        round === 1
          ? "1st"
          : round === 2
            ? "2nd"
            : round === 3
              ? "3rd"
              : `${round}th`;
      return [MADDEN_SEASON, MADDEN_SEASON + 1, MADDEN_SEASON + 2]
        .flatMap((year) =>
          Array.from(
            { length: 7 },
            (_, index) => `${year} ${ordinal(index + 1)}-Round Pick`,
          ),
        )
        .filter((label) => label.toLowerCase().includes(query))
        .slice(0, 25)
        .map((label) => ({ name: label, value: label }));
    }
    return [];
  },

  async handleInteraction(interaction: MessageComponentInteraction) {
    const [, tradeId, voteValue] = interaction.custom_id.split(":");
    const vote =
      voteValue === TradeVote.APPROVE
        ? TradeVote.APPROVE
        : voteValue === TradeVote.REJECT
          ? TradeVote.REJECT
          : undefined;

    if (!tradeId || !vote) throw new Error("Invalid trade vote");
    const settings = await LeagueSettingsDB.getLeagueSettings(
      interaction.guild_id,
    );
    const config = settings.commands.trade;
    if (!config) throw new Error("Trade approvals are not configured");
    if (!interaction.member.roles.includes(config.commissionerRole.id)) {
      return {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: { content: "Only commissioners can vote on trades.", flags: 64 },
      };
    }
    const trade = await TradeDB.vote(
      tradeId,
      interaction.member.user.id,
      vote,
    );
    return {
      type: InteractionResponseType.UpdateMessage,
      data: {
        content: tradeMessage(trade),
        components: voteComponents(trade),
        allowed_mentions: { parse: [] },
      },
    };
  },
};
