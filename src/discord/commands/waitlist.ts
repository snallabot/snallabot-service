import { ParameterizedContext } from "koa"
import { CommandHandler, Command } from "../commands_handler"
import { respond, createMessageResponse, DiscordClient } from "../discord_utils"
import { APIApplicationCommandInteractionDataIntegerOption, APIApplicationCommandInteractionDataSubcommandOption, APIApplicationCommandInteractionDataUserOption, ApplicationCommandOptionType, ApplicationCommandType, RESTPostAPIApplicationCommandsJSONBody } from "discord-api-types/v10"
import { Firestore } from "firebase-admin/firestore"
import { DiscordIdType, LeagueSettings, WaitlistConfiguration, UserId } from "../settings_db"

function createWaitlistMessage(waitlist: UserId[]) {
  return (
    "__**Waitlist**__\n" +
    waitlist.map((user, idx) => `${idx + 1}: <@${user.id}>`).join("\n")
  )
}

function respondWithWaitlist(ctx: ParameterizedContext, waitlist: UserId[]) {
  if (waitlist.length === 0) {
    respond(ctx, createMessageResponse("Waitlist is empty"))
  } else {
    respond(ctx, createMessageResponse(createWaitlistMessage(waitlist)))
  }
}

export default {
  async handleCommand(command: Command, client: DiscordClient, db: Firestore, ctx: ParameterizedContext) {
    const { guild_id } = command
    const doc = await db.collection("league_settings").doc(guild_id).get()
    const leagueSettings = doc.exists ? doc.data() as LeagueSettings : {} as LeagueSettings
    if (!command.data.options) {
      throw new Error("misconfigured waitlist")
    }
    const subCommand = command.data.options[0] as APIApplicationCommandInteractionDataSubcommandOption
    const subCommandName = subCommand.name
    if (subCommandName === "list") {
      const waitlist = leagueSettings.commands.waitlist?.current_waitlist ?? []
      respondWithWaitlist(ctx, waitlist)
    } else if (subCommandName === "add") {
      if (!subCommand.options) {
        throw new Error("misconfigured waitlist add")
      }
      const user = (subCommand.options[0] as APIApplicationCommandInteractionDataUserOption).value
      const waitlist = leagueSettings.commands.waitlist?.current_waitlist ?? []
      const position = Number(((subCommand.options?.[1] as APIApplicationCommandInteractionDataIntegerOption)?.value || waitlist.length + 1)) - 1
      if (position > waitlist.length) {
        respond(ctx, createMessageResponse("invalid position, beyond waitlist length"))
      } else {
        waitlist.splice(position, 0, { id: user, id_type: DiscordIdType.USER })
        const conf: WaitlistConfiguration = {
          current_waitlist: waitlist

        }
        await db.collection("league_settings").doc(guild_id).set({
          commands: {
            waitlist: conf
          }
        }, { merge: true })
        respondWithWaitlist(ctx, waitlist)
      }
    } else if (subCommandName === "remove") {
      if (!subCommand.options) {
        throw new Error("misconfigured waitlist remove")
      }
      const user = (subCommand.options[0] as APIApplicationCommandInteractionDataUserOption).value
      const waitlist = leagueSettings.commands.waitlist?.current_waitlist ?? []
      const newWaitlist = waitlist.filter((w) => w.id !== user)
      const conf: WaitlistConfiguration = {
        current_waitlist: newWaitlist

      }
      await db.collection("league_settings").doc(guild_id).set({
        commands: {
          waitlist: conf
        }
      }, { merge: true })
      respondWithWaitlist(ctx, newWaitlist)
    } else if (subCommandName === "pop") {
      if (!subCommand.options) {
        throw new Error("misconfigured waitlist pop")
      }
      const position = Number((subCommand.options?.[0] as APIApplicationCommandInteractionDataIntegerOption)?.value || 1)
      const waitlist = leagueSettings.commands.waitlist?.current_waitlist ?? []
      const newWaitlist = waitlist.filter((_, idx) => idx !== position - 1)
      const conf: WaitlistConfiguration = {
        current_waitlist: newWaitlist

      }
      await db.collection("league_settings").doc(guild_id).set({
        commands: {
          waitlist: conf
        }
      }, { merge: true })
      respondWithWaitlist(ctx, newWaitlist)
    } else {
      respond(ctx, createMessageResponse(`waitlist ${subCommandName} not found`))
    }
  },
  commandDefinition(): RESTPostAPIApplicationCommandsJSONBody {
    return {
      name: "waitlist",
      description: "handles the league waitlist: list, add, remove, pop",
      type: ApplicationCommandType.ChatInput,
      options: [
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "list",
          description: "lists the current users in the waitlist",
          options: []
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "add",
          description: "adds a user to the waitlist",
          options: [
            {
              type: ApplicationCommandOptionType.User,
              name: "user",
              description: "user to add to the waitlist",
              required: true,
            },
            {
              type: ApplicationCommandOptionType.Integer,
              name: "position",
              description:
                "adds this user at that waitlist position, pushing the rest back",
              required: false,
            },
          ]
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "remove",
          description: "removes a user from the waitlist ",
          options: [
            {
              type: ApplicationCommandOptionType.User,
              name: "user",
              description: "user to remove",
              required: true,
            },
          ],
        },
        {
          type: ApplicationCommandOptionType.Subcommand,
          name: "pop",
          description: "removes a user by their position, default to first in line",
          options: [
            {
              type: ApplicationCommandOptionType.Integer,
              name: "position",
              description: "position to remove, defaults to the user on the top",
              required: false,
            },
          ],
        },
      ]
    }
  }
} as CommandHandler
