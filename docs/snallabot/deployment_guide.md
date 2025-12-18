# Deployment Guide for Self-Hosting Snallabot

This document provides detailed instructions for deploying and configuring your own instance of Snallabot. It assumes familiarity with the Discord Developer Portal and the Firebase Console.

## Discord Bot Configuration

### General Information

In the **General Information** section of your bot's application settings:

- Set the **Interactions Endpoint URL** to:  
  ```
  https://YOUR_HOST/discord/webhook/slashCommand
  ```

### Installation Settings

- You may disable **User Install** if not required.
- For **Guild Install**, select the **bot** scope and add the **Administrator** permission (recommended for initial testing only; restrict permissions in production for security).

### OAuth2 Redirects

In the **OAuth2** > **Redirects** section:

- Add the following redirect URL:  
  ```
  https://YOUR_HOST/dashboard/guilds
  ```

### Privileged Gateway Intents

Enable the following intents in the **Bot** section:

- Presence Intent
- Server Members Intent
- Message Content Intent

### Registering Slash Commands

Slash commands can be registered globally or for a specific guild using `curl` from any terminal.

#### Global Installation
```bash
curl -X POST https://YOUR_HOST/discord/webhook/commandsHandler \
  -H "Content-Type: application/json" \
  -d '{"mode": "INSTALL"}'
```

#### Guild-Specific Installation
Replace `GUILD_ID` with your target guild's ID:
```bash
curl -X POST https://YOUR_HOST/discord/webhook/commandsHandler \
  -H "Content-Type: application/json" \
  -d '{"mode": "INSTALL", "guildId": "GUILD_ID"}'
```

## Firebase Database Configuration

To optimize query performance, manually create the following composite indexes in the Firestore database (under the **Indexes** tab):

| Collection ID     | Indexed Fields                                                                 | Order Directions                              | Query Scope  |
|-------------------|--------------------------------------------------------------------------------|-----------------------------------------------|--------------|
| MADDEN_SCHEDULE   | `stageIndex`, `weekIndex`, `seasonIndex`, `__name__` | Ascending, Ascending, Descending, Descending   | Collection   |
| MADDEN_SCHEDULE   | `seasonIndex`, `stageIndex`, `weekIndex`, `timestamp`, `__name__` | Ascending, Ascending, Ascending, Descending, Descending | Collection   |
| MADDEN_SCHEDULE   | `stageIndex`, `weekIndex`, `timestamp`, `__name__` | Ascending, Ascending, Descending, Descending   | Collection   |

**Note:** Replace any placeholders (e.g., `YOUR_HOST`) with your actual deployment URL. Ensure all URLs use HTTPS for security.

If you encounter issues, verify your bot token, intents, and endpoint configurations in the Discord Developer Portal. For Firebase indexes, confirm they are built successfully before querying the collection.
