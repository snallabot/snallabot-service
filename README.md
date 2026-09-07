# snallabot-service

Entire code base for Snallabot

```
Live Deployment: https://snallabot.me
```

## Contributing

### Main Service

Snallabot welcomes contributions! To run a local version of the bot, you need the following:
- Node 21 (greater should be okay)
- Discord Application - free to register on [Discord Developer Portal](https://discord.com/developers/applications)

Setup your env file by copying .base.env in a file called `.dev.env`

```sh
cp .base.env .dev.env
```

Then fill in the env file with the required fields. Some will be from your discord developer portal. The `.base.env` has info on each field required and optional

For production, you will need similar env setup that is dependent on your deployment. 

Then install all the dependencies and run the dev version!
```sh
npm install
npm run dev
```

This will setup a firebase emulator, use local file storage, and make a local version of snallabot availaible at `localhost:3000`

To then let Discord connect to your local version, you can create a temporary tunnel. There is [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/) and [Ngrok](https://ngrok.com/). Choose whichever is appopriate for you. Once you have a tunnel, head to your discord application portal. Update the `Interactions Endpoint URL` to be the following:

```
https://TUNNEL_URL/discord/webhook/slashCommand
```

Hit save, and that will verify that Discord can reach your bot. Now finally, you have to install the commands of the bot. Run a curl against snallabot:

```
curl -X POST http://localhost:3000/discord/webhook/commandsHandler  -H "Content-Type: application/json" --data '{"mode": "INSTALL", "commandNames":[]}'
```

This will install the commands **globally** for your bot (meaning they will be availaible in all Discord servers). You can also install at the Guild level:

```
curl -X POST localhost:3000/discord/webhook/commandsHandler  -H "Content-Type: application/json" --data '{"mode": "INSTALL", "guildId":"1198780271814770829", "commandNames":[]}'
```

The guild id is a Discord server id. This is faster than global. The commandNames can scope which commands you want to install. Anytime you change the options of a command you have to install to update them again. Global commands can take up to 20 minutes to show up in Discord. 

### Other Components

There are 3 other runnable components in Snallabot: EA token refresher, youtube notifier, twitch notifier

#### EA Token Refresher

There are two EA tokens: `access_token` and `refresh_token`. The `access_token` expires after 4 hours, and then to retrieve a new one you use the `refresh_token`. This will give you a new `access_token` and `refresh_token`. Seemingly, both tokens will eventually expire after around 10 days of usage. Snallabot keeps all dashboards refreshed, and exports data with [ea_refresher.ts](https://github.com/snallabot/snallabot-service/blob/main/src/dashboard/ea_refresher.ts) file. This is an example of a way to keep data fresh. I recommend using it as reference and writing your own.

#### Youtube Notifier

This checks all youtube channels that have been added to Snallabot and sends messages in Discord if that channel is playing a game in that server's league (based on stream titles). Snallabot currently runs this every 10 minutes as a chron job.

```
npm run build && npm run yt-notifier
```

#### Twitch Notifier

Snallabot comes with a webhook to hook into Twitch live events to post broadcasts for users who stream on Twitch. To run this component, you need to set the following environment variables, most from your Twitch developer account

```
TWITCH_CALLBACK_URL: by default this would be /twitch/webhook
TWITCH_CLIENT_ID: from your Twitch developer account
TWITCH_CLIENT_SECRET: from your Twitch developer account
TWITCH_SECRET: a random secret you generate for Twitch, see Twitch EventSub https://dev.twitch.tv/docs/eventsub/handling-webhook-events/
```
