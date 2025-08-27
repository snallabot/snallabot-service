import MaddenDB, { PlayerStatType } from "../../db/madden_db"
import { discordLeagueView } from "../../db/view"
import { GameResult } from "../../export/madden_league_types"
import { MessageComponentHandler, MessageComponentInteraction } from "../commands_handler"
import { DiscordClient, formatTeamEmoji } from "../discord_utils"
import { APIMessageStringSelectInteractionData, ButtonStyle, ComponentType, InteractionResponseType, SeparatorSpacingSize } from "discord-api-types/v10"
export enum GameStatsOptions {
  OVERVIEW = "o",
  HOME_PLAYER_STATS = "h",
  AWAY_PLAYER_STATS = "a"
}
export type GameSelection = { w: number, s: number, c: number, o: GameStatsOptions, b?: boolean }

export async function showGameStats(token: string, client: DiscordClient, leagueId: string, weekIndex: number, seasonIndex: number, scheduleId: number, selection: GameStatsOptions, showBack?: boolean) {
  const [gameResult, stats, latestTeams] = await Promise.all([MaddenDB.getGameForSchedule(leagueId, scheduleId, weekIndex + 1, seasonIndex), MaddenDB.getStatsForGame(leagueId, seasonIndex, weekIndex + 1, scheduleId), MaddenDB.getLatestTeams(leagueId)])
  const awayTeam = latestTeams.getTeamForId(gameResult.awayTeamId)
  const homeTeam = latestTeams.getTeamForId(gameResult.homeTeamId)

  let content = "";

  // Game header
  const gameStatus = gameResult.status === GameResult.NOT_PLAYED
    ? "Not Played"
    : `Final: ${gameResult.awayScore} - ${gameResult.homeScore}`;

  content += `**${awayTeam?.abbrName} ${awayTeam?.displayName} vs ${homeTeam?.abbrName} ${homeTeam?.displayName}**\n`;
  content += `Season ${seasonIndex + 1}, Week ${weekIndex + 1} - ${gameStatus}\n\n`;

  if (selection === GameStatsOptions.OVERVIEW) {
    // Show team stats - away team first, then home team
    const awayTeamStats = stats.teamStats.find(ts => ts.teamId === gameResult.awayTeamId);
    const homeTeamStats = stats.teamStats.find(ts => ts.teamId === gameResult.homeTeamId);
    if (awayTeamStats) {
      content += `**${formatTeamEmoji(awayTeam?.abbrName)}${awayTeam?.displayName} Team Stats**\n`;
      content += `Total Yards: ${awayTeamStats.offTotalYds} | Pass Yards: ${awayTeamStats.offPassYds} | Rush Yards: ${awayTeamStats.offRushYds}\n`;
      content += `1st Downs: ${awayTeamStats.off1stDowns} | 3rd Down: ${awayTeamStats.off3rdDownConv}/${awayTeamStats.off3rdDownAtt} (${awayTeamStats.off3rdDownConvPct}%)\n`;
      content += `Turnovers: ${awayTeamStats.tOGiveaways} | TO Diff: ${awayTeamStats.tODiff}\n`;
      content += `Penalties: ${awayTeamStats.penalties} for ${awayTeamStats.penaltyYds} yards\n\n`;
    }

    if (homeTeamStats) {
      content += `**${formatTeamEmoji(homeTeam?.abbrName)}${homeTeam?.displayName} Team Stats**\n`;
      content += `Total Yards: ${homeTeamStats.offTotalYds} | Pass Yards: ${homeTeamStats.offPassYds} | Rush Yards: ${homeTeamStats.offRushYds}\n`;
      content += `1st Downs: ${homeTeamStats.off1stDowns} | 3rd Down: ${homeTeamStats.off3rdDownConv}/${homeTeamStats.off3rdDownAtt} (${homeTeamStats.off3rdDownConvPct}%)\n`;
      content += `Turnovers: ${homeTeamStats.tOGiveaways} | TO Diff: ${homeTeamStats.tODiff}\n`;
      content += `Penalties: ${homeTeamStats.penalties} for ${homeTeamStats.penaltyYds} yards\n`;
    }
  }
  else if (selection === GameStatsOptions.AWAY_PLAYER_STATS) {
    content += `**${formatTeamEmoji(awayTeam?.abbrName)}${awayTeam?.displayName} Player Stats**\n\n`;

    // Passing stats
    const awayPassing = stats.playerStats[PlayerStatType.PASSING]?.filter(p => p.teamId === gameResult.awayTeamId);
    if (awayPassing?.length) {
      content += `**Passing:**\n`;
      awayPassing.forEach(p => {
        content += `${p.fullName}: ${p.passComp}/${p.passAtt}, ${p.passYds} yds, ${p.passTDs} TD, ${p.passInts} INT, ${p.passerRating.toFixed(1)} Rating\n`;
      });
      content += `\n`;
    }

    // Rushing stats
    const awayRushing = stats.playerStats[PlayerStatType.RUSHING]?.filter(p => p.teamId === gameResult.awayTeamId);
    if (awayRushing?.length) {
      content += `**Rushing:**\n`;
      awayRushing.forEach(p => {
        content += `${p.fullName}: ${p.rushAtt} att, ${p.rushYds} yds, ${p.rushTDs} TD, ${p.rushYdsPerAtt.toFixed(1)} avg\n`;
      });
      content += `\n`;
    }

    // Receiving stats
    const awayReceiving = stats.playerStats[PlayerStatType.RECEIVING]?.filter(p => p.teamId === gameResult.awayTeamId);
    if (awayReceiving?.length) {
      content += `**Receiving:**\n`;
      awayReceiving.forEach(p => {
        content += `${p.fullName}: ${p.recCatches} rec, ${p.recYds} yds, ${p.recTDs} TD, ${p.recYdsPerCatch.toFixed(1)} avg\n`;
      });
      content += `\n`;
    }

    // Defense stats
    const awayDefense = stats.playerStats[PlayerStatType.DEFENSE]?.filter(p => p.teamId === gameResult.awayTeamId);
    if (awayDefense?.length) {
      content += `**Defense:**\n`;
      awayDefense.forEach(p => {
        content += `${p.fullName}: ${p.defTotalTackles} tkl, ${p.defSacks} sacks, ${p.defInts} INT, ${p.defFumRec} FR\n`;
      });
      content += `\n`;
    }

    // Kicking stats
    const awayKicking = stats.playerStats[PlayerStatType.KICKING]?.filter(p => p.teamId === gameResult.awayTeamId);
    if (awayKicking?.length) {
      content += `**Kicking:**\n`;
      awayKicking.forEach(p => {
        content += `${p.fullName}: FG ${p.fGMade}/${p.fGAtt} (${p.fGCompPct}%), XP ${p.xPMade}/${p.xPAtt}, Long ${p.fGLongest}\n`;
      });
      content += `\n`;
    }

    // Punting stats
    const awayPunting = stats.playerStats[PlayerStatType.PUNTING]?.filter(p => p.teamId === gameResult.awayTeamId);
    if (awayPunting?.length) {
      content += `**Punting:**\n`;
      awayPunting.forEach(p => {
        content += `${p.fullName}: ${p.puntAtt} punts, ${p.puntYds} yds, ${p.puntYdsPerAtt.toFixed(1)} avg, ${p.puntNetYdsPerAtt.toFixed(1)} net, Long ${p.puntLongest}\n`;
      });
    }
  }
  else if (selection === GameStatsOptions.HOME_PLAYER_STATS) {
    content += `**${formatTeamEmoji(homeTeam?.abbrName)}${homeTeam?.displayName} Player Stats**\n\n`;

    // Passing stats
    const homePassing = stats.playerStats[PlayerStatType.PASSING]?.filter(p => p.teamId === gameResult.homeTeamId);
    if (homePassing?.length) {
      content += `**Passing:**\n`;
      homePassing.forEach(p => {
        content += `${p.fullName}: ${p.passComp}/${p.passAtt}, ${p.passYds} yds, ${p.passTDs} TD, ${p.passInts} INT, ${p.passerRating.toFixed(1)} Rating\n`;
      });
      content += `\n`;
    }

    // Rushing stats
    const homeRushing = stats.playerStats[PlayerStatType.RUSHING]?.filter(p => p.teamId === gameResult.homeTeamId);
    if (homeRushing?.length) {
      content += `**Rushing:**\n`;
      homeRushing.forEach(p => {
        content += `${p.fullName}: ${p.rushAtt} att, ${p.rushYds} yds, ${p.rushTDs} TD, ${p.rushYdsPerAtt.toFixed(1)} avg\n`;
      });
      content += `\n`;
    }

    // Receiving stats
    const homeReceiving = stats.playerStats[PlayerStatType.RECEIVING]?.filter(p => p.teamId === gameResult.homeTeamId);
    if (homeReceiving?.length) {
      content += `**Receiving:**\n`;
      homeReceiving.forEach(p => {
        content += `${p.fullName}: ${p.recCatches} rec, ${p.recYds} yds, ${p.recTDs} TD, ${p.recYdsPerCatch.toFixed(1)} avg\n`;
      });
      content += `\n`;
    }

    // Defense stats
    const homeDefense = stats.playerStats[PlayerStatType.DEFENSE]?.filter(p => p.teamId === gameResult.homeTeamId);
    if (homeDefense?.length) {
      content += `**Defense:**\n`;
      homeDefense.forEach(p => {
        content += `${p.fullName}: ${p.defTotalTackles} tkl, ${p.defSacks} sacks, ${p.defInts} INT, ${p.defFumRec} FR\n`;
      });
      content += `\n`;
    }

    // Kicking stats
    const homeKicking = stats.playerStats[PlayerStatType.KICKING]?.filter(p => p.teamId === gameResult.homeTeamId);
    if (homeKicking?.length) {
      content += `**Kicking:**\n`;
      homeKicking.forEach(p => {
        content += `${p.fullName}: FG ${p.fGMade}/${p.fGAtt} (${p.fGCompPct}%), XP ${p.xPMade}/${p.xPAtt}, Long ${p.fGLongest}\n`;
      });
      content += `\n`;
    }

    // Punting stats
    const homePunting = stats.playerStats[PlayerStatType.PUNTING]?.filter(p => p.teamId === gameResult.homeTeamId);
    if (homePunting?.length) {
      content += `**Punting:**\n`;
      homePunting.forEach(p => {
        content += `${p.fullName}: ${p.puntAtt} punts, ${p.puntYds} yds, ${p.puntYdsPerAtt.toFixed(1)} avg, ${p.puntNetYdsPerAtt.toFixed(1)} net, Long ${p.puntLongest}\n`;
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
        custom_id: `${JSON.stringify({ wi: weekIndex, si: seasonIndex })}`,
        label: "Back"
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
          showGameStats(interaction.token, client, leagueId, weekIndex + 1, seasonIndex, scheduleId, selectedOption, showBack)
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
} as MessageComponentHandler
