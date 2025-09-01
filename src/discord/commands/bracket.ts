import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, NoConnectedLeagueError, formatTeamEmoji, deferMessage } from "../discord_utils"
import { ApplicationCommandType, ComponentType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { discordLeagueView } from "../../db/view"
import MaddenDB, { TeamList } from "../../db/madden_db"
import { GameResult, MaddenGame, PlayoffStatus, Standing, formatRecord } from "../../export/madden_league_types"
import { createCanvas, loadImage } from "canvas"

// function formatPlayoffBracket(standings: Standing[], playoffGames: MaddenGame[], teams: TeamList): string {
//   // Filter teams that made playoffs (seed > 0)
//   const playoffTeams = standings.filter(team => team.seed > 0 && team.seed <= 7);

//   // Filter teams still in the hunt (undecided and not in playoffs yet)
//   const inTheHuntTeams = standings.filter(team =>
//     team.playoffStatus === PlayoffStatus.UNDECIDED && (team.seed === 0 || team.seed > 7)
//   );

//   if (playoffTeams.length === 0) {
//     return "No playoff teams found. Playoffs may not have been set yet.";
//   }

//   // Separate by conference
//   const afcTeams = playoffTeams
//     .filter(team => team.conferenceName.toLowerCase() === 'afc')
//     .sort((a, b) => a.seed - b.seed);

//   const nfcTeams = playoffTeams
//     .filter(team => team.conferenceName.toLowerCase() === 'nfc')
//     .sort((a, b) => a.seed - b.seed);

//   const afcHuntTeams = inTheHuntTeams
//     .filter(team => team.conferenceName.toLowerCase() === 'afc')
//     .sort((a, b) => b.winPct - a.winPct); // Sort by win percentage descending

//   const nfcHuntTeams = inTheHuntTeams
//     .filter(team => team.conferenceName.toLowerCase() === 'nfc')
//     .sort((a, b) => b.winPct - a.winPct); // Sort by win percentage descending

//   // Group playoff games by week (18+ are playoff weeks)
//   const wildCardGames = playoffGames.filter(game => game.weekIndex === 18); // Week 19 in 1-based
//   const divisionalGames = playoffGames.filter(game => game.weekIndex === 19); // Week 20
//   const conferenceGames = playoffGames.filter(game => game.weekIndex === 20); // Week 21
//   const superBowlGames = playoffGames.filter(game => game.weekIndex === 22); // Week 23

//   let bracket = "# Current Playoff Picture\n\n";

//   // AFC Conference
//   if (afcTeams.length > 0) {
//     bracket += "## AFC Conference\n";
//     afcTeams.forEach(team => {
//       const record = formatRecord(team);
//       const byeStatus = team.seed === 1 ? " **(BYE)**" : "";
//       const playoffStatusIndicator = getPlayoffStatusIndicator(team.playoffStatus);
//       bracket += `**${team.seed}.** ${team.teamName} (${record})${playoffStatusIndicator}${byeStatus}\n`;
//     });
//     bracket += "\n";

//     // Wild Card Games
//     const afcWildCardGames = wildCardGames.filter(game => {
//       const awayTeam = teams.getTeamForId(game.awayTeamId);
//       const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
//       return awayStanding?.conferenceName.toLowerCase() === 'afc';
//     });

//     if (afcWildCardGames.length > 0) {
//       bracket += "### AFC Wild Card\n";
//       afcWildCardGames.forEach(game => {
//         bracket += formatGameResult(game, teams, standings) + "\n";
//       });
//       bracket += "\n";
//     }

//     // Divisional Games
//     const afcDivisionalGames = divisionalGames.filter(game => {
//       const awayTeam = teams.getTeamForId(game.awayTeamId);
//       const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
//       return awayStanding?.conferenceName.toLowerCase() === 'afc';
//     });

//     if (afcDivisionalGames.length > 0) {
//       bracket += "### AFC Divisional\n";
//       afcDivisionalGames.forEach(game => {
//         bracket += formatGameResult(game, teams, standings) + "\n";
//       });
//       bracket += "\n";
//     }

//     // Conference Championship
//     const afcChampionship = conferenceGames.find(game => {
//       const awayTeam = teams.getTeamForId(game.awayTeamId);
//       const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
//       return awayStanding?.conferenceName.toLowerCase() === 'afc';
//     });

//     if (afcChampionship) {
//       bracket += "### AFC Championship\n";
//       bracket += formatGameResult(afcChampionship, teams, standings) + "\n\n";
//     }

//     // Teams still in the hunt
//     if (afcHuntTeams.length > 0) {
//       bracket += "### AFC In The Hunt\n";
//       afcHuntTeams.forEach(team => {
//         const record = formatRecord(team);
//         const playoffStatusIndicator = getPlayoffStatusIndicator(team.playoffStatus);
//         bracket += `${team.teamName} (${record})${playoffStatusIndicator}\n`;
//       });
//       bracket += "\n";
//     }

//     // Teams still in the hunt
//     if (nfcHuntTeams.length > 0) {
//       bracket += "### NFC In The Hunt\n";
//       nfcHuntTeams.forEach(team => {
//         const record = formatRecord(team);
//         const playoffStatusIndicator = getPlayoffStatusIndicator(team.playoffStatus);
//         bracket += `${team.teamName} (${record})${playoffStatusIndicator}\n`;
//       });
//       bracket += "\n";
//     }
//   }

//   // NFC Conference  
//   if (nfcTeams.length > 0) {
//     bracket += "## NFC Conference\n";
//     nfcTeams.forEach(team => {
//       const record = formatRecord(team);
//       const byeStatus = team.seed === 1 ? " **(BYE)**" : "";
//       const playoffStatusIndicator = getPlayoffStatusIndicator(team.playoffStatus);
//       bracket += `**${team.seed}.** ${team.teamName} (${record})${playoffStatusIndicator}${byeStatus}\n`;
//     });
//     bracket += "\n";

//     // Wild Card Games
//     const nfcWildCardGames = wildCardGames.filter(game => {
//       const awayTeam = teams.getTeamForId(game.awayTeamId);
//       const homeTeam = teams.getTeamForId(game.homeTeamId);
//       const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
//       return awayStanding?.conferenceName.toLowerCase() === 'nfc';
//     });

//     if (nfcWildCardGames.length > 0) {
//       bracket += "### NFC Wild Card\n";
//       nfcWildCardGames.forEach(game => {
//         bracket += formatGameResult(game, teams, standings) + "\n";
//       });
//       bracket += "\n";
//     }

//     // Divisional Games
//     const nfcDivisionalGames = divisionalGames.filter(game => {
//       const awayTeam = teams.getTeamForId(game.awayTeamId);
//       const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
//       return awayStanding?.conferenceName.toLowerCase() === 'nfc';
//     });

//     if (nfcDivisionalGames.length > 0) {
//       bracket += "### NFC Divisional\n";
//       nfcDivisionalGames.forEach(game => {
//         bracket += formatGameResult(game, teams, standings) + "\n";
//       });
//       bracket += "\n";
//     }

//     // Conference Championship
//     const nfcChampionship = conferenceGames.find(game => {
//       const awayTeam = teams.getTeamForId(game.awayTeamId);
//       const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
//       return awayStanding?.conferenceName.toLowerCase() === 'nfc';
//     });

//     if (nfcChampionship) {
//       bracket += "### NFC Championship\n";
//       bracket += formatGameResult(nfcChampionship, teams, standings) + "\n\n";
//     }
//   }

//   // Super Bowl
//   if (superBowlGames.length > 0) {
//     bracket += "## Super Bowl\n";
//     superBowlGames.forEach(game => {
//       bracket += formatGameResult(game, teams, standings) + "\n";
//     });
//   }

//   return bracket;
// }

// function getPlayoffStatusIndicator(status: PlayoffStatus): string {
//   switch (status) {
//     case PlayoffStatus.CLINCHED_TOP_SEED:
//       return " **z**";
//     case PlayoffStatus.CLINCHED_DIVISION:
//       return " **y**";
//     case PlayoffStatus.CLINCHED_PLAYOFF_BERTH:
//       return " **x**";
//     case PlayoffStatus.ELIMINATED:
//       return " **e**";
//     case PlayoffStatus.UNDECIDED:
//       return " **?**";
//     default:
//       return "";
//   }
// }


// function formatGameResult(game: MaddenGame, teams: TeamList, standings: Standing[]): string {
//   const awayTeam = teams.getTeamForId(game.awayTeamId);
//   const homeTeam = teams.getTeamForId(game.homeTeamId);

//   // Get seeds for display
//   const awayStanding = standings.find(s => s.teamId === game.awayTeamId);
//   const homeStanding = standings.find(s => s.teamId === game.homeTeamId);

//   const awaySeed = awayStanding?.seed || '';
//   const homeSeed = homeStanding?.seed || '';
//   const awayDisplay = `(${awaySeed}) ${formatTeamEmoji(awayTeam.abbrName)} ${awayTeam.displayName}`;
//   const homeDisplay = `(${homeSeed}) ${formatTeamEmoji(homeTeam.abbrName)} ${homeTeam.displayName}`;
//   if (game.status === GameResult.NOT_PLAYED) {
//     return `${awayDisplay} @ ${homeDisplay}`;
//   } else {
//     // Game completed - bold the winner
//     if (game.awayScore > game.homeScore) {
//       return `**${awayDisplay} ${game.awayScore}** @ ${game.homeScore} ${homeDisplay}`;
//     } else if (game.homeScore > game.awayScore) {
//       return `${awayDisplay} ${game.awayScore} @ **${game.homeScore} ${homeDisplay}**`;
//     } else {
//       return `${awayDisplay} ${game.awayScore} @ ${game.homeScore} ${homeDisplay}`;
//     }
//   }
// }


async function formatPlayoffBracket(client: DiscordClient, token: string, standings: Standing[], playoffGames: MaddenGame[], teams: TeamList): Promise<void> {
  try {
    // Load the template image
    const templatePath = '../../emojis/templates/playoff_picture_template.png'; // Adjust path as needed
    const template = await loadImage(templatePath);

    // Create canvas with template dimensions
    const canvas = createCanvas(template.width, template.height);
    const ctx = canvas.getContext('2d');

    // Draw the template
    ctx.drawImage(template, 0, 0);

    // Get playoff teams by conference
    const afcTeams = standings
      .filter(team => team.seed > 0 && team.seed <= 7 && team.conferenceName.toLowerCase() === 'afc')
      .sort((a, b) => a.seed - b.seed);

    const nfcTeams = standings
      .filter(team => team.seed > 0 && team.seed <= 7 && team.conferenceName.toLowerCase() === 'nfc')
      .sort((a, b) => a.seed - b.seed);

    // Group playoff games by week
    const wildCardGames = playoffGames.filter(game => game.weekIndex === 18);
    const divisionalGames = playoffGames.filter(game => game.weekIndex === 19);
    const conferenceGames = playoffGames.filter(game => game.weekIndex === 20);
    const superBowlGames = playoffGames.filter(game => game.weekIndex === 22);

    // Define positions for each slot (you'll need to adjust these based on your template)
    const positions = {
      // AFC Wild Card (left side, top to bottom: 2v7, 3v6, 4v5)
      afc_wc_1: { logo: { away: { x: 50, y: 100 }, home: { x: 50, y: 200 } }, score: { x: 150, y: 150 } },
      afc_wc_2: { logo: { away: { x: 50, y: 300 }, home: { x: 50, y: 400 } }, score: { x: 150, y: 350 } },
      afc_wc_3: { logo: { away: { x: 50, y: 500 }, home: { x: 50, y: 600 } }, score: { x: 150, y: 550 } },

      // AFC Divisional (1 seed at top)
      afc_div_1: { logo: { away: { x: 300, y: 150 }, home: { x: 300, y: 250 } }, score: { x: 400, y: 200 } },
      afc_div_2: { logo: { away: { x: 300, y: 450 }, home: { x: 300, y: 550 } }, score: { x: 400, y: 500 } },

      // AFC Championship
      afc_champ: { logo: { away: { x: 550, y: 300 }, home: { x: 550, y: 400 } }, score: { x: 650, y: 350 } },

      // NFC Wild Card (right side, top to bottom: 2v7, 3v6, 4v5)
      nfc_wc_1: { logo: { away: { x: 1350, y: 100 }, home: { x: 1350, y: 200 } }, score: { x: 1250, y: 150 } },
      nfc_wc_2: { logo: { away: { x: 1350, y: 300 }, home: { x: 1350, y: 400 } }, score: { x: 1250, y: 350 } },
      nfc_wc_3: { logo: { away: { x: 1350, y: 500 }, home: { x: 1350, y: 600 } }, score: { x: 1250, y: 550 } },

      // NFC Divisional (1 seed at top)
      nfc_div_1: { logo: { away: { x: 1100, y: 150 }, home: { x: 1100, y: 250 } }, score: { x: 1000, y: 200 } },
      nfc_div_2: { logo: { away: { x: 1100, y: 450 }, home: { x: 1100, y: 550 } }, score: { x: 1000, y: 500 } },

      // NFC Championship
      nfc_champ: { logo: { away: { x: 850, y: 300 }, home: { x: 850, y: 400 } }, score: { x: 750, y: 350 } },

      // Super Bowl
      super_bowl: { logo: { away: { x: 650, y: 250 }, home: { x: 750, y: 250 } }, score: { x: 700, y: 300 } }
    };

    // Helper function to load team logo
    async function loadTeamLogo(abbrName: string): Promise<any> {
      try {
        const logoPath = `../../emojis/nfl_logos/${abbrName.toLowerCase()}.png`;
        return await loadImage(logoPath);
      } catch (error) {
        console.warn(`Logo not found for ${abbrName}, defaulting`);
        return await loadImage(`../../emojis/nfl_logos/nfl.png`);
      }
    }

    // Helper function to draw game
    async function drawGame(game: MaddenGame, position: any) {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const homeTeam = teams.getTeamForId(game.homeTeamId);

      // Load and draw logos
      const awayLogo = await loadTeamLogo(awayTeam.abbrName);
      const homeLogo = await loadTeamLogo(homeTeam.abbrName);

      if (awayLogo) {
        ctx.drawImage(awayLogo, position.logo.away.x, position.logo.away.y, 80, 80);
      }
      if (homeLogo) {
        ctx.drawImage(homeLogo, position.logo.home.x, position.logo.home.y, 80, 80);
      }

      // Draw scores if game is completed
      if (game.status !== GameResult.NOT_PLAYED) {
        ctx.fillStyle = 'white';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';

        const scoreText = `${game.awayScore} - ${game.homeScore}`;
        ctx.fillText(scoreText, position.score.x, position.score.y);
      }
    }

    // Helper function to find game by team seeds
    function findGameBySeeds(games: MaddenGame[], conference: string, seed1: number, seed2: number): MaddenGame | undefined {
      return games.find(game => {
        const awayTeam = teams.getTeamForId(game.awayTeamId);
        const homeTeam = teams.getTeamForId(game.homeTeamId);
        const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
        const homeStanding = standings.find(s => s.teamId === homeTeam.teamId);

        const isRightConference = awayStanding?.conferenceName.toLowerCase() === conference.toLowerCase();
        const seeds = [awayStanding?.seed, homeStanding?.seed].sort((a, b) => (a || 0) - (b || 0));

        return isRightConference && seeds[0] === Math.min(seed1, seed2) && seeds[1] === Math.max(seed1, seed2);
      });
    }

    // Draw AFC Wild Card games (2v7, 3v6, 4v5)
    const afc27 = findGameBySeeds(wildCardGames, 'afc', 2, 7);
    const afc36 = findGameBySeeds(wildCardGames, 'afc', 3, 6);
    const afc45 = findGameBySeeds(wildCardGames, 'afc', 4, 5);

    if (afc27) await drawGame(afc27, positions.afc_wc_1);
    if (afc36) await drawGame(afc36, positions.afc_wc_2);
    if (afc45) await drawGame(afc45, positions.afc_wc_3);

    // Draw NFC Wild Card games (2v7, 3v6, 4v5)
    const nfc27 = findGameBySeeds(wildCardGames, 'nfc', 2, 7);
    const nfc36 = findGameBySeeds(wildCardGames, 'nfc', 3, 6);
    const nfc45 = findGameBySeeds(wildCardGames, 'nfc', 4, 5);

    if (nfc27) await drawGame(nfc27, positions.nfc_wc_1);
    if (nfc36) await drawGame(nfc36, positions.nfc_wc_2);
    if (nfc45) await drawGame(nfc45, positions.nfc_wc_3);

    // Draw Divisional games (1 seed should be at top)
    const afcDivisional = divisionalGames.filter(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'afc';
    });

    // Sort AFC divisional games so 1 seed game is first
    afcDivisional.sort((a, b) => {
      const aSeeds = [
        standings.find(s => s.teamId === teams.getTeamForId(a.awayTeamId).teamId)?.seed || 8,
        standings.find(s => s.teamId === teams.getTeamForId(a.homeTeamId).teamId)?.seed || 8
      ];
      const bSeeds = [
        standings.find(s => s.teamId === teams.getTeamForId(b.awayTeamId).teamId)?.seed || 8,
        standings.find(s => s.teamId === teams.getTeamForId(b.homeTeamId).teamId)?.seed || 8
      ];
      return Math.min(...aSeeds) - Math.min(...bSeeds);
    });

    if (afcDivisional[0]) await drawGame(afcDivisional[0], positions.afc_div_1); // 1 seed game at top
    if (afcDivisional[1]) await drawGame(afcDivisional[1], positions.afc_div_2);

    // Same for NFC
    const nfcDivisional = divisionalGames.filter(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'nfc';
    });

    nfcDivisional.sort((a, b) => {
      const aSeeds = [
        standings.find(s => s.teamId === teams.getTeamForId(a.awayTeamId).teamId)?.seed || 8,
        standings.find(s => s.teamId === teams.getTeamForId(a.homeTeamId).teamId)?.seed || 8
      ];
      const bSeeds = [
        standings.find(s => s.teamId === teams.getTeamForId(b.awayTeamId).teamId)?.seed || 8,
        standings.find(s => s.teamId === teams.getTeamForId(b.homeTeamId).teamId)?.seed || 8
      ];
      return Math.min(...aSeeds) - Math.min(...bSeeds);
    });

    if (nfcDivisional[0]) await drawGame(nfcDivisional[0], positions.nfc_div_1); // 1 seed game at top
    if (nfcDivisional[1]) await drawGame(nfcDivisional[1], positions.nfc_div_2);

    // Draw Conference Championships
    const afcChamp = conferenceGames.find(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'afc';
    });

    const nfcChamp = conferenceGames.find(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'nfc';
    });

    if (afcChamp) await drawGame(afcChamp, positions.afc_champ);
    if (nfcChamp) await drawGame(nfcChamp, positions.nfc_champ);

    // Draw Super Bowl
    if (superBowlGames[0]) {
      await drawGame(superBowlGames[0], positions.super_bowl);
    }

    // Return base64 encoded image
    const image = canvas.toBuffer('image/png').toString('base64');
    console.log(image)
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.MediaGallery,
          items: [{
            media: {
              url: `${image}`
            },
            description: `Current Playoff Picture`
          }]
        },
      ]
    })
  } catch (e) {
    console.error(e)
    await client.editOriginalInteraction(token, {
      flags: 32768,
      components: [
        {
          type: ComponentType.TextDisplay,
          content: `failed to create bracket: ${e}`
        },
      ]
    })
  }
}


export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    const view = await discordLeagueView.createView(guild_id)
    if (view) {
      const [standings, games, teams] = await Promise.all([MaddenDB.getLatestStandings(view.leagueId), MaddenDB.getPlayoffSchedule(view.leagueId), MaddenDB.getLatestTeams(view.leagueId)])
      formatPlayoffBracket(client, command.token, standings, games, teams)
      respond(ctx, deferMessage())
    } else {
      throw new NoConnectedLeagueError(guild_id)
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "playoffs",
      description: "See the current playoff status",
      type: ApplicationCommandType.ChatInput,
    }
  }
} as CommandHandler
