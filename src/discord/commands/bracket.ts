import { Command } from "../commands_handler"
import { DiscordClient, NoConnectedLeagueError, deferMessage } from "../discord_utils"
import { ApplicationCommandType, ComponentType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { LeagueLogos, discordLeagueView, leagueLogosView } from "../../db/view"
import MaddenDB, { TeamList } from "../../db/madden_db"
import { GameResult, MaddenGame, PlayoffStatus, Standing, } from "../../export/madden_league_types"
import { CanvasRenderingContext2D, Image, createCanvas, loadImage } from "canvas"
import FileHandler, { imageSerializer } from "../../file_handlers"

// Load the template image
type Position = { x: number, y: number }
type GamePosition = {
  logo: {
    home: Position,
    away: Position,
    size: number
  },
  score: {
    home: Position,
    away: Position
  },
  seeds: {
    home: Position,
    away: Position
  }
}
const templatePath = './emojis/templates/playoff_picture_template.png'; // Adjust path as needed
// Define positions for each slot (you'll need to adjust these based on your template)
const positions: Record<string, GamePosition> = {
  // AFC Wild Card (left side, top to bottom: 2v7, 3v6, 4v5)
  afc_wc_1: { logo: { home: { x: 110, y: 90 }, away: { x: 110, y: 215 }, size: 110 }, score: { home: { x: 285, y: 125 }, away: { x: 285, y: 250 } }, seeds: { home: { x: 95, y: 95 }, away: { x: 95, y: 215 } } },
  afc_wc_2: { logo: { home: { x: 110, y: 385 }, away: { x: 110, y: 510 }, size: 110 }, score: { home: { x: 285, y: 430 }, away: { x: 285, y: 550 } }, seeds: { home: { x: 95, y: 390 }, away: { x: 95, y: 510 } } },
  afc_wc_3: { logo: { home: { x: 110, y: 680 }, away: { x: 110, y: 805 }, size: 110 }, score: { home: { x: 285, y: 725 }, away: { x: 285, y: 845 } }, seeds: { home: { x: 95, y: 695 }, away: { x: 95, y: 806 } } },

  // AFC Divisional (1 seed at top)
  afc_div_1: { logo: { home: { x: 370, y: 120 }, away: { x: 370, y: 320 }, size: 125 }, score: { home: { x: 540, y: 170 }, away: { x: 540, y: 365 } }, seeds: { home: { x: 355, y: 100 }, away: { x: 355, y: 300 } } },
  afc_div_2: { logo: { home: { x: 370, y: 560 }, away: { x: 370, y: 760 }, size: 125 }, score: { home: { x: 540, y: 605 }, away: { x: 540, y: 805 } }, seeds: { home: { x: 355, y: 540 }, away: { x: 355, y: 740 } } },

  // AFC Championship
  afc_champ: { logo: { home: { x: 625, y: 340 }, away: { x: 625, y: 540 }, size: 125 }, score: { home: { x: 800, y: 390 }, away: { x: 800, y: 585 } }, seeds: { home: { x: 615, y: 320 }, away: { x: 615, y: 520 } } },

  // NFC Wild Card (right side, top to bottom: 2v7, 3v6, 4v5)
  nfc_wc_1: { logo: { home: { x: 1680, y: 90 }, away: { x: 1680, y: 215 }, size: 110 }, score: { home: { x: 1610, y: 125 }, away: { x: 1610, y: 250 } }, seeds: { home: { x: 1815, y: 95 }, away: { x: 1815, y: 220 } } },
  nfc_wc_2: { logo: { home: { x: 1680, y: 385 }, away: { x: 1680, y: 510 }, size: 110 }, score: { home: { x: 1610, y: 430 }, away: { x: 1610, y: 550 } }, seeds: { home: { x: 1815, y: 390 }, away: { x: 1815, y: 515 } } },
  nfc_wc_3: { logo: { home: { x: 1680, y: 680 }, away: { x: 1680, y: 805 }, size: 110 }, score: { home: { x: 1610, y: 725 }, away: { x: 1610, y: 845 } }, seeds: { home: { x: 1815, y: 685 }, away: { x: 1815, y: 810 } } },

  // NFC Divisional (1 seed at top)
  nfc_div_1: { logo: { home: { x: 1415, y: 120 }, away: { x: 1415, y: 320 }, size: 125 }, score: { home: { x: 1355, y: 170 }, away: { x: 1355, y: 360 } }, seeds: { home: { x: 1550, y: 100 }, away: { x: 1550, y: 300 } } },
  nfc_div_2: { logo: { home: { x: 1415, y: 560 }, away: { x: 1415, y: 760 }, size: 125 }, score: { home: { x: 1355, y: 605 }, away: { x: 1355, y: 805 } }, seeds: { home: { x: 1550, y: 540 }, away: { x: 1550, y: 740 } } },

  // NFC Championship
  nfc_champ: { logo: { home: { x: 1160, y: 340 }, away: { x: 1160, y: 540 }, size: 140 }, score: { home: { x: 1095, y: 390 }, away: { x: 1095, y: 585 } }, seeds: { home: { x: 1290, y: 320 }, away: { x: 1290, y: 520 } } },

  // Super Bowl
  super_bowl: {
    logo: { home: { x: 885, y: 250 }, away: { x: 885, y: 620 }, size: 165 }, score: { home: { x: 950, y: 190 }, away: { x: 950, y: 790 } }, seeds: { home: { x: 875, y: 235 }, away: { x: 875, y: 605 } }
  }
}

// Helper function to load team logo
async function loadTeamLogo(abbrName: string, logos: LeagueLogos): Promise<Image> {
  try {
    const customLogo = logos[abbrName]
    if (customLogo) {
      const logoImageBuffer = await FileHandler.readFile(customLogo.teamLogoPath, imageSerializer)
      const image = new Image()
      image.src = logoImageBuffer
      return image
    } else {
      const logoPath = `./emojis/nfl_logos/${abbrName.toLowerCase()}.png`;
      return await loadImage(logoPath);
    }
  } catch (error) {
    return await loadImage(`./emojis/nfl_logos/nfl.png`);
  }
}

function formatPlayoffStatusIndicator(status: PlayoffStatus): string {
  switch (status) {
    case PlayoffStatus.CLINCHED_TOP_SEED:
      return "(z)";
    case PlayoffStatus.CLINCHED_DIVISION:
      return "(y)";
    case PlayoffStatus.CLINCHED_PLAYOFF_BERTH:
      return "(x)";
    case PlayoffStatus.ELIMINATED:
      return "";
    case PlayoffStatus.UNDECIDED:
      return "";
    default:
      return "";
  }
}
enum MatchupType {
  SET = 0,
  DECIDED = 1,
  TBD = 2
}
type Matchup = { type: MatchupType.DECIDED, homeTeamId: number, awayTeamId: number, homeSeed: number, awaySeed: number, finishedGame: MaddenGame } | { type: MatchupType.TBD, homeTeamId: number, homeSeed: number, playoffStatus: PlayoffStatus } | { type: MatchupType.SET, homeTeamId: number, awayTeamId: number, homeSeed: number, awaySeed: number, homePlayoffStatus: PlayoffStatus, awayPlayoffStatus: PlayoffStatus }

// Helper function to draw game
async function drawGame(game: Matchup, position: GamePosition, teams: TeamList, ctx: CanvasRenderingContext2D, logos: LeagueLogos) {
  if (game.type === MatchupType.DECIDED) {
    const awayTeam = teams.getTeamForId(game.awayTeamId);
    const homeTeam = teams.getTeamForId(game.homeTeamId);

    // Load and draw logos
    const awayLogo = await loadTeamLogo(awayTeam.abbrName, logos);
    const homeLogo = await loadTeamLogo(homeTeam.abbrName, logos);

    if (awayLogo) {
      ctx.drawImage(awayLogo, position.logo.away.x, position.logo.away.y, position.logo.size, position.logo.size);
    }
    if (homeLogo) {
      ctx.drawImage(homeLogo, position.logo.home.x, position.logo.home.y, position.logo.size, position.logo.size);
    }

    // Draw scores if game is completed
    if (game.finishedGame.status !== GameResult.NOT_PLAYED) {
      ctx.fillStyle = game.finishedGame.awayScore > game.finishedGame.homeScore ? '#ab2105' : 'white';
      ctx.font = 'bold 28px Arial';
      const offset = ctx.measureText('M').width;
      const awayScoreText = `${game.finishedGame.awayScore}`;
      ctx.fillText(awayScoreText, position.score.away.x, position.score.away.y + offset);

      ctx.fillStyle = game.finishedGame.homeScore > game.finishedGame.awayScore ? '#ab2105' : 'white';
      ctx.font = 'bold 28px Arial';
      const homeScoretext = `${game.finishedGame.homeScore}`;
      ctx.fillText(homeScoretext, position.score.home.x, position.score.home.y + offset);
    }
    // draw seeds
    ctx.fillStyle = 'white';
    ctx.font = 'italic 20px Arial';
    const offset = ctx.measureText('M').width;
    const homeSeedText = `${game.homeSeed}`;
    ctx.fillText(homeSeedText, position.seeds.home.x, position.seeds.home.y + offset);

    ctx.fillStyle = 'white';
    ctx.font = 'italic 18px Arial';
    const awaySeedText = `${game.awaySeed}`;
    ctx.fillText(awaySeedText, position.seeds.away.x, position.seeds.away.y + offset);
  } else if (game.type === MatchupType.TBD) {
    const homeTeam = teams.getTeamForId(game.homeTeamId);

    const homeLogo = await loadTeamLogo(homeTeam.abbrName, logos);

    if (homeLogo) {
      ctx.drawImage(homeLogo, position.logo.home.x, position.logo.home.y, position.logo.size, position.logo.size);
    }
    ctx.fillStyle = 'white';
    ctx.font = 'italic 20px Arial';
    const offset = ctx.measureText('M').width;

    const homeSeedText = `${game.homeSeed}${formatPlayoffStatusIndicator(game.playoffStatus)}`;
    ctx.fillText(homeSeedText, position.seeds.home.x, position.seeds.home.y + offset);
  } else {
    const awayTeam = teams.getTeamForId(game.awayTeamId);
    const homeTeam = teams.getTeamForId(game.homeTeamId);

    // Load and draw logos
    const awayLogo = await loadTeamLogo(awayTeam.abbrName, logos);
    const homeLogo = await loadTeamLogo(homeTeam.abbrName, logos);

    if (awayLogo) {
      ctx.drawImage(awayLogo, position.logo.away.x, position.logo.away.y, position.logo.size, position.logo.size);
    }
    if (homeLogo) {
      ctx.drawImage(homeLogo, position.logo.home.x, position.logo.home.y, position.logo.size, position.logo.size);
    }
    // draw seeds
    ctx.fillStyle = 'white';
    ctx.font = 'italic 20px Arial';
    const offset = ctx.measureText('M').width;
    const homeSeedText = `${game.homeSeed}${formatPlayoffStatusIndicator(game.homePlayoffStatus)}`;
    ctx.fillText(homeSeedText, position.seeds.home.x, position.seeds.home.y + offset);

    ctx.fillStyle = 'white';
    ctx.font = 'italic 20px Arial';
    const awaySeedText = `${game.awaySeed}${formatPlayoffStatusIndicator(game.awayPlayoffStatus)}`;
    ctx.fillText(awaySeedText, position.seeds.away.x, position.seeds.away.y + offset);
  }
}

function decidedMatchupFromGame(game: MaddenGame, standings: Standing[]): Matchup {
  const homeSeed = standings.find(s => s.teamId === game.homeTeamId)
  const awaySeed = standings.find(s => s.teamId === game.awayTeamId)
  if (!homeSeed || !awaySeed) {
    throw new Error(`Could not find seeds for ${game.scheduleId}`)
  }
  return { type: MatchupType.DECIDED, homeTeamId: game.homeTeamId, awayTeamId: game.awayTeamId, homeSeed: homeSeed.seed, awaySeed: awaySeed.seed, finishedGame: game }
}

async function formatPlayoffBracket(client: DiscordClient, token: string, standings: Standing[], playoffGames: MaddenGame[], teams: TeamList, logos: LeagueLogos): Promise<void> {
  try {
    const template = await loadImage(templatePath);
    // Create canvas with template dimensions
    const canvas = createCanvas(template.width, template.height);
    const ctx = canvas.getContext('2d');

    // Draw the template
    ctx.drawImage(template, 0, 0);

    // Group playoff games by week
    const wildCardGames = playoffGames.filter(game => game.weekIndex === 18);
    const divisionalGames = playoffGames.filter(game => game.weekIndex === 19);
    const conferenceGames = playoffGames.filter(game => game.weekIndex === 20);
    const superBowlGames = playoffGames.filter(game => game.weekIndex === 22);

    // Helper function to find game by team seeds
    function findGameBySeeds(games: MaddenGame[], conference: string, seed1: number, seed2: number): Matchup {
      const homeSeed = Math.min(seed1, seed2)
      const awaySeed = Math.max(seed1, seed2)
      const foundGame = games.find(game => {
        const awayTeam = teams.getTeamForId(game.awayTeamId);
        const homeTeam = teams.getTeamForId(game.homeTeamId);
        const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
        const homeStanding = standings.find(s => s.teamId === homeTeam.teamId);

        const isRightConference = awayStanding?.conferenceName.toLowerCase() === conference.toLowerCase();
        const seeds = [awayStanding?.seed, homeStanding?.seed].sort((a, b) => (a || 0) - (b || 0));

        return isRightConference && seeds[0] === homeSeed && seeds[1] === awaySeed
      })
      if (foundGame) {
        return { type: MatchupType.DECIDED, homeTeamId: foundGame.homeTeamId, awayTeamId: foundGame.awayTeamId, homeSeed: homeSeed, awaySeed: awaySeed, finishedGame: foundGame }
      } else {
        const homeTeam = standings.find(s => s.seed === homeSeed && s.conferenceName.toLowerCase() === conference)
        const awayTeam = standings.find(s => s.seed === awaySeed && s.conferenceName.toLowerCase() === conference)
        if (!homeTeam || !awayTeam) {
          throw new Error(`Could not find correct seeds for ${homeSeed} vs ${awaySeed}`)
        }
        return { type: MatchupType.SET, homeTeamId: homeTeam.teamId, homeSeed: homeSeed, homePlayoffStatus: homeTeam.playoffStatus, awayTeamId: awayTeam.teamId, awaySeed: awaySeed, awayPlayoffStatus: awayTeam.playoffStatus }
      }
    }

    // Draw AFC Wild Card games (2v7, 3v6, 4v5)
    const afc27 = findGameBySeeds(wildCardGames, 'afc', 2, 7);
    const afc36 = findGameBySeeds(wildCardGames, 'afc', 3, 6);
    const afc45 = findGameBySeeds(wildCardGames, 'afc', 4, 5);

    if (afc27) await drawGame(afc27, positions.afc_wc_1, teams, ctx, logos);
    if (afc36) await drawGame(afc36, positions.afc_wc_2, teams, ctx, logos);
    if (afc45) await drawGame(afc45, positions.afc_wc_3, teams, ctx, logos);

    // Draw NFC Wild Card games (2v7, 3v6, 4v5)
    const nfc27 = findGameBySeeds(wildCardGames, 'nfc', 2, 7);
    const nfc36 = findGameBySeeds(wildCardGames, 'nfc', 3, 6);
    const nfc45 = findGameBySeeds(wildCardGames, 'nfc', 4, 5);

    if (nfc27) await drawGame(nfc27, positions.nfc_wc_1, teams, ctx, logos);
    if (nfc36) await drawGame(nfc36, positions.nfc_wc_2, teams, ctx, logos);
    if (nfc45) await drawGame(nfc45, positions.nfc_wc_3, teams, ctx, logos);

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

    // put the game, or put the 1 seed in place
    if (afcDivisional[0]) {
      await drawGame(decidedMatchupFromGame(afcDivisional[0], standings), positions.afc_div_1, teams, ctx, logos); // 1 seed game at top
    } else {
      const afcOneSeed = standings.find(s => s.conferenceName.toLowerCase() === "afc" && s.seed === 1)
      if (afcOneSeed) {
        await drawGame({ type: MatchupType.TBD, homeSeed: afcOneSeed.seed, homeTeamId: afcOneSeed.teamId, playoffStatus: afcOneSeed.playoffStatus }, positions.afc_div_1, teams, ctx, logos)
      } else {
        throw new Error(`Could not get AFC one seed`)
      }
    }
    if (afcDivisional[1]) await drawGame(decidedMatchupFromGame(afcDivisional[1], standings), positions.afc_div_2, teams, ctx, logos);

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

    if (nfcDivisional[0]) { await drawGame(decidedMatchupFromGame(nfcDivisional[0], standings), positions.nfc_div_1, teams, ctx, logos) } else {
      const nfcOneSeed = standings.find(s => s.conferenceName.toLowerCase() === "nfc" && s.seed === 1)
      if (nfcOneSeed) {
        await drawGame({ type: MatchupType.TBD, homeSeed: nfcOneSeed.seed, homeTeamId: nfcOneSeed.teamId, playoffStatus: nfcOneSeed.playoffStatus }, positions.nfc_div_1, teams, ctx, logos)
      } else {
        throw new Error(`Could not get NFC one seed`)
      }
    }
    if (nfcDivisional[1]) await drawGame(decidedMatchupFromGame(nfcDivisional[1], standings), positions.nfc_div_2, teams, ctx, logos);

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

    if (afcChamp) await drawGame(decidedMatchupFromGame(afcChamp, standings), positions.afc_champ, teams, ctx, logos);
    if (nfcChamp) await drawGame(decidedMatchupFromGame(nfcChamp, standings), positions.nfc_champ, teams, ctx, logos);

    // Draw Super Bowl
    if (superBowlGames[0]) {
      await drawGame(decidedMatchupFromGame(superBowlGames[0], standings), positions.super_bowl, teams, ctx, logos);
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
    await client.editOriginalInteractionWithForm(token, formData)
  } catch (e) {
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
  async handleCommand(command: Command, client: DiscordClient) {
    const { guild_id } = command
    const view = await discordLeagueView.createView(guild_id)
    if (view) {
      const [standings, games, teams, logos] = await Promise.all([MaddenDB.getLatestStandings(view.leagueId), MaddenDB.getPlayoffSchedule(view.leagueId), MaddenDB.getLatestTeams(view.leagueId), leagueLogosView.createView(view.leagueId)])
      formatPlayoffBracket(client, command.token, standings, games, teams, logos)
      return deferMessage()
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
}
