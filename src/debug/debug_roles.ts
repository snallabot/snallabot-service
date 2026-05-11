import { createProdClient } from "../discord/discord_utils"
import LeagueSettingsDB from "../discord/settings_db"

async function main(guildId: string) {
  const settings = await LeagueSettingsDB.getLeagueSettings(guildId)
  const client = createProdClient()
  const users = await client.getUsers(guildId)
  console.log(users.length)
  const adminRole = settings.commands.game_channel?.admin.id || ""
  const admins = users.map((u) => ({ id: u.user.id, roles: u.roles })).filter(u => u.roles.includes(adminRole)).map(u => u.id)
  console.log(admins)
}

main("1177381229243408505")
