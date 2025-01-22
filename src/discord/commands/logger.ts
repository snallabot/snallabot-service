import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataBooleanOption, APIApplicationCommandInteractionDataChannelOption, APIApplicationCommandInteractionDataSubcommandOption, ApplicationCommandOptionType, ApplicationCommandType, ChannelType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { FieldValue, Firestore } from "firebase-admin/firestore"
import { DiscordIdType, LoggerConfiguration } from "../settings_db"

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    if (!command.data.options) {
      throw new Error("logger command not defined properly")
    }
    const options = command.data.options
    const loggerConfigureCommand = options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommand = loggerConfigureCommand.name
    if (subCommand !== "configure") {
      throw new Error("logger command has extra command " + subCommand)
    }
    const subCommandOptions = loggerConfigureCommand.options
    if (!subCommandOptions) {
      throw new Error("missing logger configure options!")
    }
    const channel = (subCommandOptions[0] as APIApplicationCommandInteractionDataChannelOption).value
    const on = subCommandOptions[1] ? (subCommandOptions[1] as APIApplicationCommandInteractionDataBooleanOption).value : true
    if (on) {
      const loggerConfig: LoggerConfiguration = {
        channel: {
          id: channel,
          id_type: DiscordIdType.CHANNEL
        },
      }
      await db.collection("league_settings").doc(guild_id).set({
        commands: {
          logger: loggerConfig
        }
      }, { merge: true })
    } else {
      await db.collection("league_settings").doc(guild_id).update({
        ["commands.logger"]: FieldValue.delete()
      })
    }
    respond(ctx, createMessageResponse(`logger is ${on ? "on" : "off"}`))
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "logger",
      description: "sets up snallabot logger",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "configure",
          description: "sets the logger channel",
          options: [{
            type: ApplicationCommandOptionType.Channel,
            name: "channel",
            description: "channel to log in",
            required: true,
            channel_types: [ChannelType.GuildText]
          },
          {
            type: ApplicationCommandOptionType.Boolean,
            name: "on",
            description: "turn on or off the logger",
            required: false
          }]
        }
      ]
    }
  }
} as CommandHandler
