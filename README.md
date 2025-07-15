# snallabot-service

Entire code base for Snallabot App

```
Live Deployment: https://snallabot.me
```

## Contributing

Snallabot welcomes contributions! To run a local version of the bot, you need the following:
- Node 21 (greater should be okay)
- Discord Application - free to register on [Discord Developer Portal](https://discord.com/developers/applications)

```sh
npm install
PUBLIC_KEY=??? DISCORD_TOKEN=??? APP_ID=??? npm run dev
```

Fill in the env files with the ones from your Discord application. This will setup a firebase emulator, use local file storage, and make a local version of snallabot availaible at `localhost:3000`


