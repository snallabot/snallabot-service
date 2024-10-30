import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { MADDEN_SEASON, MaddenGame, Team, getMessageForWeek } from "../madden/madden_types"
import MaddenClient from "../madden/client"
import { LeagueSettings } from "../settings_db"

function format(schedule: MaddenGame[], teams: Team[], week: number) {
    const teamMap = new Map<Number, Team>()
    teams.forEach(t => teamMap.set(t.teamId, t))
    const schedulesMessage = schedule.sort((a, b) => a.scheduleId - b.scheduleId).filter(w => w.awayTeamId !== 0 && w.homeTeamId !== 0).map(game => {
        if (game.awayScore == 0 && game.homeScore == 0) {
            return `${teamMap.get(game.awayTeamId)?.displayName} vs ${teamMap.get(game.homeTeamId)?.displayName}`
        } else {
            if (game.awayScore > game.homeScore) {
                return `**__${teamMap.get(game.awayTeamId)?.displayName} ${game.awayScore
                    }__** vs ${game.homeScore} ${teamMap.get(game.homeTeamId)?.displayName}`
            } else if (game.homeScore > game.awayScore) {
                return `${teamMap.get(game.awayTeamId)?.displayName} ${game.awayScore
                    } vs **__${game.homeScore} ${teamMap.get(game.homeTeamId)?.displayName}__**`
            }
            return `${teamMap.get(game.awayTeamId)?.displayName} ${game.awayScore} vs ${game.homeScore
                } ${teamMap.get(game.homeTeamId)?.displayName}`
        }
    }).join("\n")

    return `# ${getMessageForWeek(week)} Schedule\n${schedulesMessage}`
}

export default {
    async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
        const { guild_id } = command
        if (!command.data.options) {
            throw new Error("schedule command not defined properly")
        }
        const doc = await db.collection("league_settings").doc(guild_id).get()
        const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
        if (!leagueSettings.commands.madden_league?.league_id) {
            throw new Error("Could not find a linked Madden league, link a league first")
        }
        const league = leagueSettings.commands.madden_league.league_id
        const week = (command.data.options[0] as APIApplicationCommandInteractionDataIntegerOption).value
        if (week < 1 || week > 23 || week === 22) {
            throw new Error("Invalid week number. Valid weeks are week 1-18 and for playoffs: Wildcard = 19, Divisional = 20, Conference Championship = 21, Super Bowl = 23")
        }
        const season = (command.data.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value
        const [schedule, teams] = await Promise.all([(async () => {
            if (season) {
                const seasonIndex = season < 100 ? season : season - MADDEN_SEASON
                return MaddenClient.getWeekScheduleForSeason(league, week, seasonIndex)
            } else {
                return MaddenClient.getLatestWeekSchedule(league, week)
            }
        })(), MaddenClient.getLatestTeams(league)])
        respond(ctx, createMessageResponse(`${format(schedule, teams, week)}`))
    },
    commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
        return {
            name: "schedule",
            description: "Shows the schedule for the week and season",
            options: [
                {
                    type: ApplicationCommandOptionType.Integer,
                    name: "week",
                    description: "The week to get the schedule for",
                    required: true
                },
                {
                    type: ApplicationCommandOptionType.Integer,
                    name: "season",
                    description: "The season to get the schedule for",
                    required: false
                }
            ],
            type: ApplicationCommandType.ChatInput,
        }
    }
} as CommandHandler
