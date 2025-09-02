import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, NoConnectedLeagueError, formatTeamEmoji, deferMessage } from "../discord_utils"
import { ApplicationCommandType, ComponentType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { discordLeagueView } from "../../db/view"
import MaddenDB, { TeamList } from "../../db/madden_db"
import { GameResult, MaddenGame, PlayoffStatus, Standing, formatRecord } from "../../export/madden_league_types"
import { CanvasRenderingContext2D, createCanvas, loadImage } from "canvas"

// Load the template image
type Position = { x: number, y: number }
type GamePosition = {
  logo: {
    home: Position,
    away: Position,
    size: number
  }
  score: {
    home: Position,
    away: Position
  }

}
const templatePath = './emojis/templates/playoff_picture_template.png'; // Adjust path as needed
// Define positions for each slot (you'll need to adjust these based on your template)
const positions: Record<string, GamePosition> = {
  // AFC Wild Card (left side, top to bottom: 2v7, 3v6, 4v5)
  afc_wc_1: { logo: { home: { x: 110, y: 90 }, away: { x: 110, y: 215 }, size: 110 }, score: { home: { x: 285, y: 125 }, away: { x: 285, y: 250 } } },
  afc_wc_2: { logo: { home: { x: 110, y: 385 }, away: { x: 110, y: 510 }, size: 110 }, score: { home: { x: 285, y: 430 }, away: { x: 285, y: 550 } } },
  afc_wc_3: { logo: { home: { x: 110, y: 680 }, away: { x: 110, y: 805 }, size: 110 }, score: { home: { x: 285, y: 725 }, away: { x: 285, y: 845 } } },

  // AFC Divisional (1 seed at top)
  afc_div_1: { logo: { home: { x: 370, y: 120 }, away: { x: 370, y: 320 }, size: 125 }, score: { home: { x: 540, y: 170 }, away: { x: 540, y: 365 } } },
  afc_div_2: { logo: { home: { x: 370, y: 560 }, away: { x: 370, y: 760 }, size: 125 }, score: { home: { x: 540, y: 605 }, away: { x: 540, y: 805 } } },

  // AFC Championship
  afc_champ: { logo: { home: { x: 625, y: 340 }, away: { x: 625, y: 540 }, size: 125 }, score: { home: { x: 800, y: 390 }, away: { x: 800, y: 585 } } },

  // NFC Wild Card (right side, top to bottom: 2v7, 3v6, 4v5)
  nfc_wc_1: { logo: { home: { x: 1680, y: 90 }, away: { x: 1680, y: 215 }, size: 100 }, score: { home: { x: 1610, y: 125 }, away: { x: 1610, y: 250 } } },
  nfc_wc_2: { logo: { home: { x: 1680, y: 385 }, away: { x: 1680, y: 510 }, size: 100 }, score: { home: { x: 1610, y: 430 }, away: { x: 1610, y: 550 } } },
  nfc_wc_3: { logo: { home: { x: 1680, y: 680 }, away: { x: 1680, y: 805 }, size: 100 }, score: { home: { x: 1610, y: 725 }, away: { x: 1610, y: 845 } } },

  // NFC Divisional (1 seed at top)
  nfc_div_1: { logo: { home: { x: 1415, y: 120 }, away: { x: 1415, y: 320 }, size: 125 }, score: { home: { x: 1355, y: 170 }, away: { x: 1355, y: 360 } } },
  nfc_div_2: { logo: { home: { x: 1415, y: 560 }, away: { x: 1415, y: 760 }, size: 125 }, score: { home: { x: 1355, y: 605 }, away: { x: 1355, y: 805 } } },

  // NFC Championship
  nfc_champ: { logo: { home: { x: 1160, y: 340 }, away: { x: 1160, y: 540 }, size: 125 }, score: { home: { x: 1095, y: 390 }, away: { x: 1095, y: 585 } } },

  // Super Bowl
  super_bowl: {
    logo: { home: { x: 885, y: 250 }, away: { x: 885, y: 620 }, size: 140 }, score: { home: { x: 950, y: 190 }, away: { x: 950, y: 790 } }
  }
}

// Helper function to load team logo
async function loadTeamLogo(abbrName: string): Promise<any> {
  try {
    const logoPath = `./emojis/nfl_logos/${abbrName.toLowerCase()}.png`;
    return await loadImage(logoPath);
  } catch (error) {
    console.warn(`Logo not found for ${abbrName}, defaulting`);
    return await loadImage(`./emojis/nfl_logos/nfl.png`);
  }
}

// Helper function to draw game
async function drawGame(game: MaddenGame, position: GamePosition, teams: TeamList, ctx: CanvasRenderingContext2D) {
  const awayTeam = teams.getTeamForId(game.awayTeamId);
  const homeTeam = teams.getTeamForId(game.homeTeamId);

  // Load and draw logos
  const awayLogo = await loadTeamLogo(awayTeam.abbrName);
  const homeLogo = await loadTeamLogo(homeTeam.abbrName);

  if (awayLogo) {
    ctx.drawImage(awayLogo, position.logo.away.x, position.logo.away.y, position.logo.size, position.logo.size);
  }
  if (homeLogo) {
    ctx.drawImage(homeLogo, position.logo.home.x, position.logo.home.y, position.logo.size, position.logo.size);
  }

  // Draw scores if game is completed
  if (game.status !== GameResult.NOT_PLAYED) {
    ctx.fillStyle = game.awayScore > game.homeScore ? '#ab2105' : 'white';
    ctx.font = 'bold 24px Arial';
    const offset = ctx.measureText('M').width;
    const awayScoreText = `${game.awayScore}`;

    ctx.fillText(awayScoreText, position.score.away.x, position.score.away.y + offset);
    ctx.fillStyle = game.homeScore > game.awayScore ? '#ab2105' : 'white';
    ctx.font = 'bold 24px Arial';
    const homeScoretext = `${game.homeScore}`;
    ctx.fillText(homeScoretext, position.score.home.x, position.score.home.y + offset);
  }
}

async function formatPlayoffBracket(client: DiscordClient, token: string, standings: Standing[], playoffGames: MaddenGame[], teams: TeamList): Promise<void> {
  try {
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

    if (afc27) await drawGame(afc27, positions.afc_wc_1, teams, ctx);
    if (afc36) await drawGame(afc36, positions.afc_wc_2, teams, ctx);
    if (afc45) await drawGame(afc45, positions.afc_wc_3, teams, ctx);

    // Draw NFC Wild Card games (2v7, 3v6, 4v5)
    const nfc27 = findGameBySeeds(wildCardGames, 'nfc', 2, 7);
    const nfc36 = findGameBySeeds(wildCardGames, 'nfc', 3, 6);
    const nfc45 = findGameBySeeds(wildCardGames, 'nfc', 4, 5);

    if (nfc27) await drawGame(nfc27, positions.nfc_wc_1, teams, ctx);
    if (nfc36) await drawGame(nfc36, positions.nfc_wc_2, teams, ctx);
    if (nfc45) await drawGame(nfc45, positions.nfc_wc_3, teams, ctx);

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

    if (afcDivisional[0]) await drawGame(afcDivisional[0], positions.afc_div_1, teams, ctx); // 1 seed game at top
    if (afcDivisional[1]) await drawGame(afcDivisional[1], positions.afc_div_2, teams, ctx);

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

    if (nfcDivisional[0]) await drawGame(nfcDivisional[0], positions.nfc_div_1, teams, ctx); // 1 seed game at top
    if (nfcDivisional[1]) await drawGame(nfcDivisional[1], positions.nfc_div_2, teams, ctx);

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

    if (afcChamp) await drawGame(afcChamp, positions.afc_champ, teams, ctx);
    if (nfcChamp) await drawGame(nfcChamp, positions.nfc_champ, teams, ctx);

    // Draw Super Bowl
    if (superBowlGames[0]) {
      await drawGame(superBowlGames[0], positions.super_bowl, teams, ctx);
    }

    // Return base64 encoded image
    const image = canvas.toBuffer('image/png')
    const formData = new FormData()
    const imageBlob = new Blob([image], { type: 'image/png' })
    const payload = {
      content: "Current Playoff Picture",
      attachments: [
        { id: 0, description: "Playoff Picture", filename: "playoff_bracket.png" }
      ]
    }
    formData.append("payload_json", JSON.stringify(payload))
    formData.append("files[0]", imageBlob, "playoff_bracket.png")
    console.log(formData)
    await client.editOriginalInteractionWithForm(token, formData)
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
