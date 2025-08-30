import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient, NoConnectedLeagueError } from "../discord_utils"
import { ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { discordLeagueView } from "../../db/view"
import MaddenDB, { TeamList } from "../../db/madden_db"
import { GameResult, MaddenGame, Standing, formatRecord } from "../../export/madden_league_types"



function formatPlayoffBracket(standings: Standing[], playoffGames: MaddenGame[], teams: TeamList): string {
  // Filter teams that made playoffs (seed > 0)
  const playoffTeams = standings.filter(team => team.seed > 0 && team.seed <= 7);

  if (playoffTeams.length === 0) {
    return "No playoff teams found. Playoffs may not have been set yet.";
  }

  // Separate by conference
  const afcTeams = playoffTeams
    .filter(team => team.conferenceName.toLowerCase() === 'afc')
    .sort((a, b) => a.seed - b.seed);

  const nfcTeams = playoffTeams
    .filter(team => team.conferenceName.toLowerCase() === 'nfc')
    .sort((a, b) => a.seed - b.seed);

  // Group playoff games by week (18+ are playoff weeks)
  const wildCardGames = playoffGames.filter(game => game.weekIndex === 18); // Week 19 in 1-based
  const divisionalGames = playoffGames.filter(game => game.weekIndex === 19); // Week 20
  const conferenceGames = playoffGames.filter(game => game.weekIndex === 20); // Week 21
  const superBowlGames = playoffGames.filter(game => game.weekIndex === 22); // Week 23

  let bracket = "# Current NFL Playoff Picture\n\n";

  // AFC Conference
  if (afcTeams.length > 0) {
    bracket += "## AFC Conference\n";
    afcTeams.forEach(team => {
      const record = formatRecord(team);
      const byeStatus = team.seed === 1 ? " **(BYE)**" : "";
      bracket += `**${team.seed}.** ${team.teamName} (${record})${byeStatus}\n`;
    });
    bracket += "\n";

    // Wild Card Games
    const afcWildCardGames = wildCardGames.filter(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const homeTeam = teams.getTeamForId(game.homeTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'afc';
    });

    if (afcWildCardGames.length > 0) {
      bracket += "### AFC Wild Card\n";
      afcWildCardGames.forEach(game => {
        bracket += formatGameResult(game, teams, standings) + "\n";
      });
      bracket += "\n";
    }

    // Divisional Games
    const afcDivisionalGames = divisionalGames.filter(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'afc';
    });

    if (afcDivisionalGames.length > 0) {
      bracket += "### AFC Divisional\n";
      afcDivisionalGames.forEach(game => {
        bracket += formatGameResult(game, teams, standings) + "\n";
      });
      bracket += "\n";
    }

    // Conference Championship
    const afcChampionship = conferenceGames.find(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'afc';
    });

    if (afcChampionship) {
      bracket += "### AFC Championship\n";
      bracket += formatGameResult(afcChampionship, teams, standings) + "\n\n";
    }
  }

  // NFC Conference  
  if (nfcTeams.length > 0) {
    bracket += "## NFC Conference\n";
    nfcTeams.forEach(team => {
      const record = formatRecord(team);
      const byeStatus = team.seed === 1 ? " **(BYE)**" : "";
      bracket += `**${team.seed}.** ${team.teamName} (${record})${byeStatus}\n`;
    });
    bracket += "\n";

    // Wild Card Games
    const nfcWildCardGames = wildCardGames.filter(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const homeTeam = teams.getTeamForId(game.homeTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'nfc';
    });

    if (nfcWildCardGames.length > 0) {
      bracket += "### NFC Wild Card\n";
      nfcWildCardGames.forEach(game => {
        bracket += formatGameResult(game, teams, standings) + "\n";
      });
      bracket += "\n";
    }

    // Divisional Games
    const nfcDivisionalGames = divisionalGames.filter(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'nfc';
    });

    if (nfcDivisionalGames.length > 0) {
      bracket += "### NFC Divisional\n";
      nfcDivisionalGames.forEach(game => {
        bracket += formatGameResult(game, teams, standings) + "\n";
      });
      bracket += "\n";
    }

    // Conference Championship
    const nfcChampionship = conferenceGames.find(game => {
      const awayTeam = teams.getTeamForId(game.awayTeamId);
      const awayStanding = standings.find(s => s.teamId === awayTeam.teamId);
      return awayStanding?.conferenceName.toLowerCase() === 'nfc';
    });

    if (nfcChampionship) {
      bracket += "### NFC Championship\n";
      bracket += formatGameResult(nfcChampionship, teams, standings) + "\n\n";
    }
  }

  // Super Bowl
  if (superBowlGames.length > 0) {
    bracket += "## Super Bowl\n";
    superBowlGames.forEach(game => {
      bracket += formatGameResult(game, teams, standings) + "\n";
    });
  }

  return bracket;
}

function formatGameResult(game: MaddenGame, teams: TeamList, standings: Standing[]): string {
  const awayTeam = teams.getTeamForId(game.awayTeamId);
  const homeTeam = teams.getTeamForId(game.homeTeamId);

  // Get seeds for display
  const awayStanding = standings.find(s => s.teamId === game.awayTeamId);
  const homeStanding = standings.find(s => s.teamId === game.homeTeamId);

  const awaySeed = awayStanding?.seed || '';
  const homeSeed = homeStanding?.seed || '';

  const awayDisplay = `(${awaySeed}) ${awayTeam.displayName}`;
  const homeDisplay = `(${homeSeed}) ${homeTeam.displayName}`;

  if (game.status === GameResult.NOT_PLAYED) {
    return `${awayDisplay} @ ${homeDisplay}`;
  } else {
    // Game completed - bold the winner
    if (game.awayScore > game.homeScore) {
      return `**${awayDisplay} ${game.awayScore}** @ ${game.homeScore} ${homeDisplay}`;
    } else if (game.homeScore > game.awayScore) {
      return `${awayDisplay} ${game.awayScore} @ **${game.homeScore} ${homeDisplay}**`;
    } else {
      return `${awayDisplay} ${game.awayScore} @ ${game.homeScore} ${homeDisplay}`;
    }
  }
}


export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    const view = await discordLeagueView.createView(guild_id)
    if (view) {
      const [standings, games, teams] = await Promise.all([MaddenDB.getLatestStandings(view.leagueId), MaddenDB.getPlayoffSchedule(view.leagueId), MaddenDB.getLatestTeams(view.leagueId)])
      const message = formatPlayoffBracket(standings, games, teams)
      respond(ctx, createMessageResponse(message))
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
