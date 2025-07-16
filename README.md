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

```sh
npm install
PUBLIC_KEY=??? DISCORD_TOKEN=??? APP_ID=??? DEPLOYMENT_URL=localhost:3000 npm run dev
```

Fill in the env variables with the ones from your Discord application. This will setup a firebase emulator, use local file storage, and make a local version of snallabot availaible at `localhost:3000`

### Other Components

There are 3 other runnable components in Snallabot: EA token refresher, youtube notifier, twitch notifier

#### EA Token Refresher

There are two EA tokens: access_token and refresh_token. The access_token expires after 4 hours, and then to retrieve a new one you use the refresh_token. This will give you a new access_token and refresh_token. Seemingly, both tokens will eventually expire after around 10 days of usage. Snallabot keeps all dashboards refreshed, and exports data with [ea_refresher.ts](https://github.com/snallabot/snallabot-service/blob/main/src/dashboard/ea_refresher.ts) file. This is an example of a way to keep data fresh. I recommend using it as reference and writing your own.

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