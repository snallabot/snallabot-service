import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    respond(ctx, createMessageResponse(`bot is working`))
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "stats",
      description: "shows stats for your league",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "shows weekly and yearly leaderboard.",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "top",
              description: "get only the top teams",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "current",
          description: "gets current year stats",
          options: [],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "year",
          description: "get stats for specified year",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "year",
              description: "year to retrieve stats for",
              required: false,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "week",
          description: "get stats for specified week",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "week",
              description: "week to retrieve stat for",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "year",
              description: "year to retrieve, default current",
              required: false,
            }
          ],
        }
      ]
    }
  }
} as CommandHandler
