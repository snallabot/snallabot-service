import MaddenDB, { PlayerStatType } from "../../db/madden_db"
import { discordLeagueView, leagueLogosView } from "../../db/view"
import { GameResult, MADDEN_SEASON, getMessageForWeek } from "../../export/madden_league_types"
import { MessageComponentHandler, MessageComponentInteraction } from "../commands_handler"
import { DiscordClient, formatTeamEmoji } from "../discord_utils"
import { APIMessageStringSelectInteractionData, ButtonStyle, ComponentType, InteractionResponseType, SeparatorSpacingSize } from "discord-api-types/v10"
import { TeamSelection, WeekSelection } from "./schedule"
export enum GameStatsOptions {
  OVERVIEW = "o",
  HOME_PLAYER_STATS = "h",
  AWAY_PLAYER_STATS = "a"
}
export type GameSelection = { w: number, s: number, c: number, o: GameStatsOptions, b?: WeekSelection | TeamSelection }

export async function showGameStats(token: string, client: DiscordClient, leagueId: string, weekIndex: number, seasonIndex: number, scheduleId: number, selection: GameStatsOptions, showBack?: WeekSelection | TeamSelection) {
  const [gameResult, stats, latestTeams, logos] = await Promise.all([MaddenDB.getGameForSchedule(leagueId, scheduleId, weekIndex + 1, seasonIndex), MaddenDB.getStatsForGame(leagueId, seasonIndex, weekIndex + 1, scheduleId), MaddenDB.getLatestTeams(leagueId), leagueLogosView.createView(leagueId)])
  const awayTeam = latestTeams.getTeamForId(gameResult.awayTeamId)
  const homeTeam = latestTeams.getTeamForId(gameResult.homeTeamId)

  let content = "";
  content += `# ${formatTeamEmoji(logos, awayTeam?.abbrName)} ${awayTeam?.displayName} ${gameResult.awayScore} vs ${gameResult.homeScore} ${formatTeamEmoji(logos, homeTeam?.abbrName)} ${homeTeam?.displayName}\n`;
  content += `**Season ${seasonIndex + MADDEN_SEASON}, ${getMessageForWeek(weekIndex + 1)}**\n`;

  if (selection === GameStatsOptions.OVERVIEW) {
    // Show team stats - away team first, then home team
    const awayTeamStats = stats.teamStats.find(ts => ts.teamId === gameResult.awayTeamId);
    const homeTeamStats = stats.teamStats.find(ts => ts.teamId === gameResult.homeTeamId);
    if (awayTeamStats) {
      content += `## ${formatTeamEmoji(logos, awayTeam?.abbrName)} ${awayTeam?.displayName} Stats\n`;
      content += `Total Yards: ${awayTeamStats.offTotalYds} | Pass Yards: ${awayTeamStats.offPassYds} | Rush Yards: ${awayTeamStats.offRushYds}\n`;
      content += `1st Downs: ${awayTeamStats.off1stDowns} | 3rd Down: ${awayTeamStats.off3rdDownConv}/${awayTeamStats.off3rdDownAtt} (${awayTeamStats.off3rdDownConvPct.toFixed(1)}%)\n`;
      content += `Turnovers: ${awayTeamStats.tOGiveaways} | TO Diff: ${awayTeamStats.tODiff}\n`;
      content += `Penalties: ${awayTeamStats.penalties} for ${awayTeamStats.penaltyYds} yards\n\n`;
    }

    if (homeTeamStats) {
      content += `## ${formatTeamEmoji(logos, homeTeam?.abbrName)} ${homeTeam?.displayName} Stats\n`;
      content += `Total Yards: ${homeTeamStats.offTotalYds} | Pass Yards: ${homeTeamStats.offPassYds} | Rush Yards: ${homeTeamStats.offRushYds}\n`;
      content += `1st Downs: ${homeTeamStats.off1stDowns} | 3rd Down: ${homeTeamStats.off3rdDownConv}/${homeTeamStats.off3rdDownAtt} (${homeTeamStats.off3rdDownConvPct.toFixed(1)}%)\n`;
      content += `Turnovers: ${homeTeamStats.tOGiveaways} | TO Diff: ${homeTeamStats.tODiff}\n`;
      content += `Penalties: ${homeTeamStats.penalties} for ${homeTeamStats.penaltyYds} yards\n`;
    }
  }
  else if (selection === GameStatsOptions.AWAY_PLAYER_STATS) {
    content += `## ${formatTeamEmoji(logos, awayTeam?.abbrName)}${awayTeam?.displayName} Player Stats\n`;

    // Passing stats
    const awayPassing = stats.playerStats[PlayerStatType.PASSING]?.filter(p => p.teamId === gameResult.awayTeamId)
      .sort((a, b) => b.passAtt - a.passAtt);
    if (awayPassing?.length) {
      content += `### Passing\n`;
      awayPassing.forEach(p => {
        const statParts = [];
        if (p.passAtt > 0) statParts.push(`${p.passComp}/${p.passAtt}`);
        if (p.passYds !== 0) statParts.push(`${p.passYds} yds`);
        if (p.passTDs > 0) statParts.push(`${p.passTDs} TD`);
        if (p.passInts > 0) statParts.push(`${p.passInts} INT`);
        if (p.passerRating > 0) statParts.push(`${p.passerRating.toFixed(1)} Rating`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      })
    }

    // Rushing stats
    const awayRushing = stats.playerStats[PlayerStatType.RUSHING]?.filter(p => p.teamId === gameResult.awayTeamId)
      .sort((a, b) => b.rushAtt - a.rushAtt);
    if (awayRushing?.length) {
      content += `### Rushing\n`;
      awayRushing.forEach(p => {
        const statParts = [];
        if (p.rushAtt > 0) statParts.push(`${p.rushAtt} ATT`);
        if (p.rushYds !== 0) statParts.push(`${p.rushYds} YDS`); // Allow negative yards
        if (p.rushTDs > 0) statParts.push(`${p.rushTDs} TD`);
        if (p.rushYdsPerAtt !== 0) statParts.push(`${p.rushYdsPerAtt.toFixed(1)} AVG`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Receiving stats
    const awayReceiving = stats.playerStats[PlayerStatType.RECEIVING]?.filter(p => p.teamId === gameResult.awayTeamId)
      .sort((a, b) => b.recCatches - a.recCatches);
    if (awayReceiving?.length) {
      content += `### Receiving\n`;
      awayReceiving.forEach(p => {
        const statParts = [];
        if (p.recCatches > 0) statParts.push(`${p.recCatches} REC`);
        if (p.recYds !== 0) statParts.push(`${p.recYds} YDS`); // Allow negative yards
        if (p.recTDs > 0) statParts.push(`${p.recTDs} TD`);
        if (p.recYdsPerCatch !== 0 && p.recCatches > 0) statParts.push(`${p.recYdsPerCatch.toFixed(1)} AVG`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Defense stats
    const awayDefense = stats.playerStats[PlayerStatType.DEFENSE]?.filter(p => p.teamId === gameResult.awayTeamId)
      .sort((a, b) => b.defTotalTackles - a.defTotalTackles);
    if (awayDefense?.length) {
      content += `### Defense\n`;
      awayDefense.forEach(p => {
        const statParts = [];
        if (p.defTotalTackles > 0) statParts.push(`${p.defTotalTackles} TKL`);
        if (p.defSacks > 0) statParts.push(`${p.defSacks} SCK`);
        if (p.defInts > 0) statParts.push(`${p.defInts} INT`);
        if (p.defFumRec > 0) statParts.push(`${p.defFumRec} FR`);
        if (p.defTDs > 0) statParts.push(`${p.defTDs} TD`);
        if (p.defSafeties > 0) statParts.push(`${p.defSafeties} SAF`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Kicking stats
    const awayKicking = stats.playerStats[PlayerStatType.KICKING]?.filter(p => p.teamId === gameResult.awayTeamId)
      .sort((a, b) => b.fGAtt - a.fGAtt);
    if (awayKicking?.length) {
      content += `### Kicking\n`;
      awayKicking.forEach(p => {
        const statParts = [];
        if (p.fGAtt > 0) statParts.push(`FG ${p.fGMade}/${p.fGAtt} (${p.fGCompPct}%)`);
        if (p.xPAtt > 0) statParts.push(`XP ${p.xPMade}/${p.xPAtt}`);
        if (p.fGLongest > 0) statParts.push(`Long ${p.fGLongest}`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Punting stats
    const awayPunting = stats.playerStats[PlayerStatType.PUNTING]?.filter(p => p.teamId === gameResult.awayTeamId)
      .sort((a, b) => b.puntAtt - a.puntAtt);
    if (awayPunting?.length) {
      content += `### Punting\n`;
      awayPunting.forEach(p => {
        const statParts = [];
        if (p.puntAtt > 0) statParts.push(`${p.puntAtt} punts`);
        if (p.puntYds > 0) statParts.push(`${p.puntYds} yds`);
        if (p.puntYdsPerAtt > 0) statParts.push(`${p.puntYdsPerAtt.toFixed(1)} avg`);
        if (p.puntNetYdsPerAtt !== 0) statParts.push(`${p.puntNetYdsPerAtt.toFixed(1)} net`);
        if (p.puntLongest > 0) statParts.push(`Long ${p.puntLongest}`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }
  }
  else if (selection === GameStatsOptions.HOME_PLAYER_STATS) {
    content += `## ${formatTeamEmoji(logos, homeTeam?.abbrName)}${homeTeam?.displayName} Player Stats\n`;

    // Passing stats
    const homePassing = stats.playerStats[PlayerStatType.PASSING]?.filter(p => p.teamId === gameResult.homeTeamId)
      .sort((a, b) => b.passAtt - a.passAtt);
    if (homePassing?.length) {
      content += `### Passing\n`;
      homePassing.forEach(p => {
        const statParts = [];
        if (p.passAtt > 0) statParts.push(`${p.passComp}/${p.passAtt}`);
        if (p.passYds > 0) statParts.push(`${p.passYds} YDS`);
        if (p.passTDs > 0) statParts.push(`${p.passTDs} TD`);
        if (p.passInts > 0) statParts.push(`${p.passInts} INT`);
        if (p.passerRating > 0) statParts.push(`${p.passerRating.toFixed(1)} Rating`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Rushing stats
    const homeRushing = stats.playerStats[PlayerStatType.RUSHING]?.filter(p => p.teamId === gameResult.homeTeamId)
      .sort((a, b) => b.rushAtt - a.rushAtt);
    if (homeRushing?.length) {
      content += `### Rushing\n`;
      homeRushing.forEach(p => {
        const statParts = [];
        if (p.rushAtt > 0) statParts.push(`${p.rushAtt} ATT`);
        if (p.rushYds !== 0) statParts.push(`${p.rushYds} YDS`); // Allow negative yards
        if (p.rushTDs > 0) statParts.push(`${p.rushTDs} TD`);
        if (p.rushYdsPerAtt !== 0) statParts.push(`${p.rushYdsPerAtt.toFixed(1)} AVG`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Receiving stats
    const homeReceiving = stats.playerStats[PlayerStatType.RECEIVING]?.filter(p => p.teamId === gameResult.homeTeamId)
      .sort((a, b) => b.recCatches - a.recCatches);
    if (homeReceiving?.length) {
      content += `### Receiving\n`;
      homeReceiving.forEach(p => {
        const statParts = [];
        if (p.recCatches > 0) statParts.push(`${p.recCatches} REC`);
        if (p.recYds !== 0) statParts.push(`${p.recYds} YDS`); // Allow negative yards
        if (p.recTDs > 0) statParts.push(`${p.recTDs} TD`);
        if (p.recYdsPerCatch !== 0 && p.recCatches > 0) statParts.push(`${p.recYdsPerCatch.toFixed(1)} AVG`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Defense stats
    const homeDefense = stats.playerStats[PlayerStatType.DEFENSE]?.filter(p => p.teamId === gameResult.homeTeamId)
      .sort((a, b) => b.defTotalTackles - a.defTotalTackles);
    if (homeDefense?.length) {
      content += `### Defense\n`;
      homeDefense.forEach(p => {
        const statParts = [];
        if (p.defTotalTackles > 0) statParts.push(`${p.defTotalTackles} TKL`);
        if (p.defSacks > 0) statParts.push(`${p.defSacks} SCK`);
        if (p.defInts > 0) statParts.push(`${p.defInts} INT`);
        if (p.defFumRec > 0) statParts.push(`${p.defFumRec} FR`);
        if (p.defTDs > 0) statParts.push(`${p.defTDs} TD`);
        if (p.defSafeties > 0) statParts.push(`${p.defSafeties} SAF`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Kicking stats
    const homeKicking = stats.playerStats[PlayerStatType.KICKING]?.filter(p => p.teamId === gameResult.homeTeamId)
      .sort((a, b) => b.fGAtt - a.fGAtt);
    if (homeKicking?.length) {
      content += `### Kicking\n`;
      homeKicking.forEach(p => {
        const statParts = [];
        if (p.fGAtt > 0) statParts.push(`FG ${p.fGMade}/${p.fGAtt} (${p.fGCompPct}%)`);
        if (p.xPAtt > 0) statParts.push(`XP ${p.xPMade}/${p.xPAtt}`);
        if (p.fGLongest > 0) statParts.push(`Long ${p.fGLongest}`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }

    // Punting stats
    const homePunting = stats.playerStats[PlayerStatType.PUNTING]?.filter(p => p.teamId === gameResult.homeTeamId)
      .sort((a, b) => b.puntAtt - a.puntAtt);
    if (homePunting?.length) {
      content += `### Punting\n`;
      homePunting.forEach(p => {
        const statParts = [];
        if (p.puntAtt > 0) statParts.push(`${p.puntAtt} PNT`);
        if (p.puntYds > 0) statParts.push(`${p.puntYds} YDS`);
        if (p.puntYdsPerAtt > 0) statParts.push(`${p.puntYdsPerAtt.toFixed(1)} AVG`);
        if (p.puntNetYdsPerAtt !== 0) statParts.push(`${p.puntNetYdsPerAtt.toFixed(1)} NET`);
        if (p.puntLongest > 0) statParts.push(`Long ${p.puntLongest}`);

        if (statParts.length > 0) {
          content += `${p.fullName}: ${statParts.join(', ')}\n`;
        }
      });
    }
  }

  // Create options for the selector
  const gameStatsOptions = [
    {
      label: "Game Overview",
      value: JSON.stringify({ w: weekIndex, s: seasonIndex, c: scheduleId, o: GameStatsOptions.OVERVIEW, b: showBack }),
      default: selection === GameStatsOptions.OVERVIEW
    },
    {
      label: `${awayTeam?.abbrName} Player Stats`,
      value: JSON.stringify({ w: weekIndex, s: seasonIndex, c: scheduleId, o: GameStatsOptions.AWAY_PLAYER_STATS, b: showBack }),
      default: selection === GameStatsOptions.AWAY_PLAYER_STATS
    },
    {
      label: `${homeTeam?.abbrName} Player Stats`,
      value: JSON.stringify({ w: weekIndex, s: seasonIndex, c: scheduleId, o: GameStatsOptions.HOME_PLAYER_STATS, b: showBack }),
      default: selection === GameStatsOptions.HOME_PLAYER_STATS
    }
  ];
  const backButton = showBack ? [{
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        custom_id: JSON.stringify(showBack),
        label: "Back to Schedule"
      }
    ]
  }] : []

  client.editOriginalInteraction(token, {
    flags: 32768,
    components: [
      {
        type: ComponentType.TextDisplay,
        content: content
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
            custom_id: "game_stats",
            placeholder: `Select view`,
            options: gameStatsOptions
          }
        ]
      },
      ...backButton
    ]
  });
}

export default {
  async handleInteraction(interaction: MessageComponentInteraction, client: DiscordClient) {
    const customId = interaction.custom_id
    if (customId === "game_stats") {
      const data = interaction.data as APIMessageStringSelectInteractionData
      if (data.values.length !== 1) {
        throw new Error("Somehow did not receive just one selection from game selector " + data.values)
      }
      const { w: weekIndex, s: seasonIndex, c: scheduleId, o: selectedOption, b: showBack } = JSON.parse(data.values[0]) as GameSelection
      try {
        const guildId = interaction.guild_id
        const discordLeague = await discordLeagueView.createView(guildId)
        const leagueId = discordLeague?.leagueId
        if (leagueId) {
          showGameStats(interaction.token, client, leagueId, weekIndex, seasonIndex, scheduleId, selectedOption, showBack)
        }
      } catch (e) {
        await client.editOriginalInteraction(interaction.token, {
          flags: 32768,
          components: [
            {
              type: ComponentType.TextDisplay,
              content: `Could not show game Error: ${e}`
            },

          ]
        })
      }
      return {
        type: InteractionResponseType.DeferredMessageUpdate,
      }
    }
    throw new Error(`Invalid interaction on schedule`)
  }
}
