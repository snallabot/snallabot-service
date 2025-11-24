import { Command, MessageComponentInteraction } from "../commands_handler"
import { DiscordClient, deferMessage } from "../discord_utils"
import { APIApplicationCommandInteractionDataStringOption, APIMessageStringSelectInteractionData, ApplicationCommandOptionType, ApplicationCommandType, ButtonStyle, ComponentType, InteractionResponseType, RESTPostAPIApplicationCommandsJSONBody, SeparatorSpacingSize } from "discord-api-types/v10"
import LeagueSettingsDB from "../settings_db"
import MaddenDB from "../../db/madden_db"
import { Standing, formatRecord } from "../../export/madden_league_types"
import { discordLeagueView } from "../../db/view"

function formatStandings(standings: Standing[], page: number = 0, itemsPerPage: number = 8) {
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageStandings = standings.slice(startIndex, endIndex);

  const message = pageStandings.map(standing => {
    const record = formatRecord(standing)
    return `### ${standing.rank}. ${standing.teamName} (${record})\nNet: ${standing.netPts} | Pts For: ${standing.ptsFor} (${standing.ptsForRank}) | Pts Against: ${standing.ptsAgainst} (${standing.ptsAgainstRank}) | TO: ${standing.tODiff}\nOFF: ${standing.offTotalYds} YDS (${standing.offTotalYdsRank}) | DEF: ${standing.defTotalYds} YDS (${standing.defTotalYdsRank})`
  }).join("\n")

  return message;
}

function getStandingsForFilter(standings: Standing[], filter: string): Standing[] {
  const sortedStandings = standings.sort((s1, s2) => s1.rank - s2.rank);

  switch (filter.toLowerCase()) {
    case "nfl":
      return sortedStandings;
    case "afc":
      return sortedStandings.filter(s => s.conferenceName.toLowerCase() === "afc");
    case "nfc":
      return sortedStandings.filter(s => s.conferenceName.toLowerCase() === "nfc");
    case "afc_north":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "afc" && s.divisionName.toLowerCase().includes("north"));
    case "afc_south":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "afc" && s.divisionName.toLowerCase().includes("south"));
    case "afc_east":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "afc" && s.divisionName.toLowerCase().includes("east"));
    case "afc_west":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "afc" && s.divisionName.toLowerCase().includes("west"));
    case "nfc_north":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "nfc" && s.divisionName.toLowerCase().includes("north"));
    case "nfc_south":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "nfc" && s.divisionName.toLowerCase().includes("south"));
    case "nfc_east":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "nfc" && s.divisionName.toLowerCase().includes("east"));
    case "nfc_west":
      return sortedStandings.filter(s =>
        s.conferenceName.toLowerCase() === "nfc" && s.divisionName.toLowerCase().includes("west"));
    default:
      return sortedStandings;
  }
}
// Create filter selector options
const filterOptions = [
  { label: "NFL", value: "nfl" },
  { label: "AFC", value: "afc" },
  { label: "NFC", value: "nfc" },
  { label: "AFC North", value: "afc_north" },
  { label: "AFC South", value: "afc_south" },
  { label: "AFC East", value: "afc_east" },
  { label: "AFC West", value: "afc_west" },
  { label: "NFC North", value: "nfc_north" },
  { label: "NFC South", value: "nfc_south" },
  { label: "NFC East", value: "nfc_east" },
  { label: "NFC West", value: "nfc_west" }
]
const itemsPerPage = 8;
export type StandingsPaginated = { f: string, p: number }
async function handleCommand(client: DiscordClient, token: string, league: string, filter: string = "nfl", page: number = 0) {
  try {
    const standings = await MaddenDB.getLatestStandings(league);
    const filteredStandings = getStandingsForFilter(standings, filter);

    if (!filteredStandings || filteredStandings.length === 0) {
      throw new Error("No standings found for the selected filter");
    }
    const totalPages = Math.ceil(filteredStandings.length / itemsPerPage);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));

    const message = formatStandings(filteredStandings, currentPage, itemsPerPage);

    // Create pagination buttons if needed
    const paginationButtons = [];
    if (totalPages > 1) {
      paginationButtons.push({
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.Button,
            custom_id: JSON.stringify({ f: filter, p: Math.max(0, currentPage - 1) }),
            label: "Previous",
            style: ButtonStyle.Secondary,
            disabled: currentPage === 0
          },
          {
            type: ComponentType.Button,
            custom_id: JSON.stringify({ f: filter, p: Math.min(totalPages - 1, currentPage + 1) }),
            label: "Next",
            style: ButtonStyle.Secondary,
            disabled: currentPage === totalPages - 1
          }
        ]
      });
    }

    // Build components array
    const components = [
      {
        type: ComponentType.TextDisplay,
        content: message
      },
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: SeparatorSpacingSize.Small
      },
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: "standings_filter",
            placeholder: filterOptions.find(opt => opt.value === filter)?.label || "NFL",
            options: filterOptions.map(option => ({
              ...option,
              value: JSON.stringify({ f: option.value, p: 0 })
            }))
          }
        ]
      },
      ...paginationButtons
    ];

    await client.editOriginalInteraction(token, {
      flags: 32768,
      components
    });

  } catch (e) {
    console.error(e);
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `Standings failed: Error: ${e}`
        }
      ]
    });
  }
}

function getStandingsFilter(interaction: MessageComponentInteraction) {
  const customId = interaction.custom_id
  if (customId === "standings_filter") {
    const data = interaction.data as APIMessageStringSelectInteractionData
    if (data.values.length !== 1) {
      throw new Error("Somehow did not receive just one selection from standings selector " + data.values)
    }
    return JSON.parse(data.values[0]) as StandingsPaginated

  } else {
    const parsedId = JSON.parse(customId)
    if (parsedId.f != null) {
      return parsedId as StandingsPaginated
    }
  }
  throw new Error("invalid standings command")
}

export default {
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id, token } = command
    const leagueSettings = await LeagueSettingsDB.getLeagueSettings(guild_id)
    if (!leagueSettings?.commands?.madden_league?.league_id) {
      throw new Error("No madden league linked. Setup snallabot with your Madden league first")
    }
    const league = leagueSettings.commands.madden_league.league_id
    const scope = (command?.data?.options?.[0] as APIApplicationCommandInteractionDataStringOption)?.value
    handleCommand(client, token, league, scope)
    return deferMessage()
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "standings",
      description: "display the current team standings",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: "scope",
          description: "conference or division",
          required: false,
          choices: filterOptions.map(f => ({ name: f.label, value: f.value }))
        },
      ]
    }
  },
  async handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient) {
    try {
      const standingsFilter = getStandingsFilter(interaction)
      const discordLeague = await discordLeagueView.createView(interaction.guild_id)
      const leagueId = discordLeague?.leagueId
      if (leagueId) {
        handleCommand(client, interaction.token, leagueId, standingsFilter.f, standingsFilter.p)
      }
    } catch (e) {
      console.error(e)
      await client.editOriginalInteraction(interaction.token, {
        flags: 32768,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `Could not show standings Error: ${e}`
          },

        ]
      })
    }
    return {
      type: InteractionResponseType.DeferredMessageUpdate,
    }

  }
}
