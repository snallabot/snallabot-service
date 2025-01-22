type UserInfo = { id: string, login: string, display_name: string, type: string, broadcaster_type: string, description: string, profile_image_url: string, offline_image_url: string, view_count: number, email: string, created_at: string }
type TwitchUserInformation = { data: Array<UserInfo> }

type BroadcasterInfo = { broadcaster_id: string, broadcaster_login: string, broadcaster_name: string, broadcaster_language: string, game_id: string, game_name: string, title: string, delay: number, tags: Array<string>, content_classification_labels: Array<string>, is_branded_content: boolean }
type TwitchChannelInformation = { data: Array<BroadcasterInfo> }

type SubscriptionResponse = { data: Array<{ id: string, status: string, type: string, version: string, cost: number, condition: { broadcaster_user_id: string }, transport: { method: string, callback: string }, created_at: string }>, total: number, total_cost: number, max_total_cost: number }


interface TwitchClient {
  retrieveBroadcasterInformation(twitchUrl: string): Promise<TwitchUserInformation>,
  retrieveChannelInformation(broadcasterUserId: string): Promise<TwitchChannelInformation>,
  subscribeBroadcasterStreamOnline(broadcasterUserId: string): Promise<SubscriptionResponse>,
  deleteSubscription(subscriptionId: string): Promise<void>
}

export function getSecret() {
  if (!process.env.TWITCH_SECRET) {
    throw new Error("no secret defined!")
  }
  return process.env.TWITCH_SECRET;
}

function getCallbackURL() {
  if (!process.env.TWITCH_CALLBACK_URL) {
    throw new Error("no callback url defined!")
  }
  return process.env.TWITCH_CALLBACK_URL;

}

const TwitchClient = (): TwitchClient => {
  let token = ""
  const refreshToken = async () => {
    const res = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: `client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error("could not refresh token: " + text)
    }
    const tokenResponse = await res.json()
    token = tokenResponse.access_token
  }
  const twitchRequester = async (fetcher: (token: string) => Promise<Response>): Promise<Response> => {
    if (!token) {
      await refreshToken()
    }
    const res = await fetcher(token)
    if (res.status === 401) {
      await refreshToken()
      return await fetcher(token)
    }
    return res
  }
  return {
    async retrieveBroadcasterInformation(twitchUrl: string) {
      const login = twitchUrl.substring(twitchUrl.lastIndexOf('/') + 1)
      const res = await twitchRequester(async (token) =>
        await fetch(`https://api.twitch.tv/helix/users?login=${login}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Client-Id": `${process.env.TWITCH_CLIENT_ID}`
          }
        })
      )
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Could not find ${login} on Twitch! ` + t)
      }
      const twitchResponse = await res.json() as TwitchUserInformation
      if (twitchResponse.data.length === 0) {
        throw new Error(`Could not find information on ${login} on Twitch!`)
      }
      return twitchResponse
    },
    async retrieveChannelInformation(broadcasterUserId: string) {
      const res = await twitchRequester(async (token) =>
        await fetch(`https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterUserId}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Client-Id": `${process.env.TWITCH_CLIENT_ID}`
          }
        })
      )
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`twitch call for ${broadcasterUserId} failed ${t}`)
      }
      const twitchResponse = await res.json() as TwitchChannelInformation
      if (twitchResponse.data.length === 0) {
        throw new Error("no twitch channel information found")
      }
      return twitchResponse
    },
    async subscribeBroadcasterStreamOnline(broadcasterUserId) {
      const res = await twitchRequester(async (token) =>
        await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Client-Id": `${process.env.TWITCH_CLIENT_ID}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            "type": "stream.online",
            version: 1,
            condition: {
              "broadcaster_user_id": broadcasterUserId
            },
            transport: {
              method: "webhook",
              callback: getCallbackURL(),
              secret: getSecret()
            }
          })
        })
      )
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Could not create subscription for ${broadcasterUserId}, error: ${t}`)
      }
      const subscription = await res.json() as SubscriptionResponse
      return subscription
    },
    async deleteSubscription(subscriptionId) {
      const res = await twitchRequester(async (token) =>
        await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${subscriptionId}`, {
          method: "DELETE",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Client-Id": `${process.env.TWITCH_CLIENT_ID}`
          }
        })
      )
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Could not delete subscription ${subscriptionId}, error: ${t}`)
      }
    }
  }
}

const MockTwitchClient: TwitchClient = {
  retrieveBroadcasterInformation: async (twitchUrl: string) => {
    return {
      "data": [
        {
          "id": "141981764",
          "login": "twitchdev",
          "display_name": "TwitchDev",
          "type": "",
          "broadcaster_type": "partner",
          "description": "Supporting third-party developers building Twitch integrations from chatbots to game integrations.",
          "profile_image_url": "https://static-cdn.jtvnw.net/jtv_user_pictures/8a6381c7-d0c0-4576-b179-38bd5ce1d6af-profile_image-300x300.png",
          "offline_image_url": "https://static-cdn.jtvnw.net/jtv_user_pictures/3f13ab61-ec78-4fe6-8481-8682cb3b0ac2-channel_offline_image-1920x1080.png",
          "view_count": 5980557,
          "email": "not-real@email.com",
          "created_at": "2016-12-14T20:32:28Z"
        }
      ]
    }
  },
  retrieveChannelInformation: async (broadcasterUserId: string) => {
    return {
      "data": [
        {
          "broadcaster_id": "141981764",
          "broadcaster_login": "twitchdev",
          "broadcaster_name": "TwitchDev",
          "broadcaster_language": "en",
          "game_id": "509670",
          "game_name": "Science & Technology",
          "title": "TwitchDev Monthly Update // May 6, 2021",
          "delay": 0,
          "tags": ["DevsInTheKnow"],
          "content_classification_labels": ["Gambling", "DrugsIntoxication", "MatureGame"],
          "is_branded_content": false
        }
      ]
    }
  },
  subscribeBroadcasterStreamOnline: async (broadcasterUserId: string) => {
    return {
      "data": [
        {
          "id": "f1c2a387-161a-49f9-a165-0f21d7a4e1c4",
          "status": "webhook_callback_verification_pending",
          "type": "channel.follow",
          "version": "2",
          "cost": 1,
          "condition": {
            "broadcaster_user_id": "1234",
            "moderator_user_id": "1234"
          },
          "transport": {
            "method": "webhook",
            "callback": "https://example.com/webhooks/callback"
          },
          "created_at": "2019-11-16T10:11:12.634234626Z"
        }
      ],
      "total": 1,
      "total_cost": 1,
      "max_total_cost": 10000
    }
  },
  deleteSubscription: async (sub: string) => { console.log(`${sub} is deleted`) }
}

export function createTwitchClient(): TwitchClient {
  if (process.env.TWITCH_CLIENT_ID) {
    return TwitchClient()
  } else {
    return MockTwitchClient
  }
}
