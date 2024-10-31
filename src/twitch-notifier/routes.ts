import { ParameterizedContext } from "koa"
import Router from "@koa/router"
import { randomBytes, createHmac, timingSafeEqual } from "crypto"
import { initializeApp, cert } from "firebase-admin/app"
import { FieldValue } from "firebase-admin/firestore"
import { subscribe } from "diagnostics_channel"
import { createTwitchClient, getSecret } from "./twitch_client"
import NodeCache from "node-cache"
import db from "../db/firebase"

const router = new Router({ prefix: "/twitch" })


// Notification request headers
const TWITCH_MESSAGE_ID = 'Twitch-Eventsub-Message-Id'.toLowerCase()
const TWITCH_MESSAGE_TIMESTAMP = 'Twitch-Eventsub-Message-Timestamp'.toLowerCase()
const TWITCH_MESSAGE_SIGNATURE = 'Twitch-Eventsub-Message-Signature'.toLowerCase()
const MESSAGE_TYPE = 'Twitch-Eventsub-Message-Type'

const MESSAGE_TYPE_VERIFICATION = 'webhook_callback_verification';
const MESSAGE_TYPE_NOTIFICATION = 'notification';
const MESSAGE_TYPE_REVOCATION = 'revocation';

const HMAC_PREFIX = 'sha256=';

function getHmacMessage(ctx: ParameterizedContext) {
    return (ctx.get(TWITCH_MESSAGE_ID) +
        ctx.get(TWITCH_MESSAGE_TIMESTAMP) +
        ctx.request.rawBody);
}


function getHmac(secret: string, message: string) {
    return createHmac('sha256', secret)
        .update(message)
        .digest('hex');
}

function verifyMessage(hmac: string, verifySignature: string) {
    return timingSafeEqual(Buffer.from(hmac), Buffer.from(verifySignature));
}

function createTwitchUrl(broadcasterLogin: string) {
    return `https://www.twitch.tv/${broadcasterLogin}`
}

const twitchClient = createTwitchClient()

type BroadcastConfigurationEvent = { channel_id: string, role?: string, id: string, timestamp: string, title_keyword: string }
type BroadcastConfigurationResponse = { "BROADCAST_CONFIGURATION": Array<BroadcastConfigurationEvent> }

type Subscription = { id: string, status: string, type: string, version: "1", condition: { broadcaster_user_id: string }, transport: { method: string, callback: string }, created_at: string, cost: number }
type Event = { id: string, broadcaster_user_id: string, broadcaster_user_login: string, broadcaster_user_name: string, type: string, started_at: string }
type StreamUpEvent = { subscription: Subscription, event: Event }


interface TwitchNotifier {
    addTwitchChannel(discordServer: string, twitchUrl: string): Promise<void>,
    remoevTwitchChannel(discordServer: string, twitchUrl: string): Promise<void>,
    listTwitchChannels(discordServer: string): Promise<string[]>
}

type SubscriptionDoc = { subscriptionId: string, broadcasterLogin: string, servers: { [key: string]: { subscribed: boolean } } }


const CACHE_TTL = 10 * 60 // in seconds
const messageCache = new NodeCache({ stdTTL: CACHE_TTL })

export const twitchNotifierHandler: TwitchNotifier = {
    addTwitchChannel: async (discordServer: string, twitchUrl: string) => {
        const broadcasterInformation = await twitchClient.retrieveBroadcasterInformation(twitchUrl)
        const broadcasterId = broadcasterInformation.data[0].id
        const broadcasterLogin = broadcasterInformation.data[0].login
        const currentSubscriptionDoc = await db.collection("twitch_notifiers").doc(broadcasterId).get()
        if (currentSubscriptionDoc.exists) {
            await db.collection("twitch_notifiers").doc(broadcasterId).set(
                {
                    servers: {
                        [discordServer]: { subscribed: true }
                    }
                }, { merge: true }
            )
        } else {
            const subscription = await twitchClient.subscribeBroadcasterStreamOnline(broadcasterId)
            const subscriptionId = subscription.data?.[0]?.id
            if (!subscriptionId) {
                throw new Error(`Subscription response not formed correctly: ${subscription}`)
            }
            await db.collection("twitch_notifiers").doc(broadcasterId).set({
                subscriptionId: subscriptionId,
                broadcasterLogin: broadcasterLogin,
                servers: {
                    [discordServer]: { subscribed: true }
                }
            })
        }
    },
    remoevTwitchChannel: async (discordServer: string, twitchUrl: string) => {
        const broadcasterInformation = await twitchClient.retrieveBroadcasterInformation(twitchUrl)
        const broadcasterId = broadcasterInformation.data[0].id
        const currentSubscriptionDoc = await db.collection("twitch_notifiers").doc(broadcasterId).get()
        if (currentSubscriptionDoc.exists) {
            const currentSubscription = currentSubscriptionDoc.data() as SubscriptionDoc
            const numSubscribed = Object.entries(currentSubscription.servers).filter((entry) => entry[0] != discordServer && entry[1].subscribed).length
            if (numSubscribed === 0) {
                await twitchClient.deleteSubscription(currentSubscription.subscriptionId)
                await db.collection("twitch_notifiers").doc(broadcasterId).delete()
            } else {
                await db.collection("twitch_notifiers").doc(broadcasterId).update({
                    [`servers.${discordServer}`]: FieldValue.delete()
                })
            }
        } else {
            throw new Error(`Twitch notifier does not exist for ${twitchUrl}. It may never have been added`)
        }
    },
    listTwitchChannels: async (discordServer: string) => {
        const notifiers = await db.collection("twitch_notifiers").where(`servers.${discordServer}.subscribed`, "==", true).get()
        return notifiers.docs.map(d => {
            const broadcasterLogin = (d.data() as SubscriptionDoc).broadcasterLogin
            return createTwitchUrl(broadcasterLogin)
        })
    }
}

async function handleStreamEvent(twitchEvent: StreamUpEvent) {
    const twitchUser = twitchEvent.event.broadcaster_user_id
    const channelInformation = await twitchClient.retrieveChannelInformation(twitchUser)
    const broadcaster = channelInformation.data[0]
    const broadcasterName = broadcaster.broadcaster_name
    const broadcastTitle = broadcaster.title
    const subscriptionDoc = await db.collection("twitch_notifiers").doc(twitchUser).get()
    if (!subscriptionDoc.exists) {
        throw new Error(`Subscription for ${twitchUser} does not exist!`)
    }
    const subscription = subscriptionDoc.data() as SubscriptionDoc
    const subscribedServers = Object.entries(subscription.servers).filter(entry => entry[1].subscribed).map(entry => entry[0])
    console.log(subscribedServers)
    await Promise.all(subscribedServers.map(async (server) => {
        const res = await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/query", {
            method: "POST",
            body: JSON.stringify({ event_types: ["BROADCAST_CONFIGURATION"], key: server, after: 0, limit: 1 }),
            headers: {
                "Content-Type": "application/json"
            }
        })
        const broadcastResponse = await res.json() as BroadcastConfigurationResponse
        const sortedEvents = broadcastResponse.BROADCAST_CONFIGURATION.sort((a: BroadcastConfigurationEvent, b: BroadcastConfigurationEvent) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        if (sortedEvents.length === 0) {
            console.error(`${server} is not configured for Broadcasts`)
        } else {
            const configuration = sortedEvents[0]
            const titleKeyword = configuration.title_keyword
            console.log(`broadcast title: ${broadcastTitle} titleKeyword: ${titleKeyword}`)
            if (broadcastTitle.toLowerCase().includes(titleKeyword.toLowerCase())) {
                await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/post", {
                    method: "POST",
                    body: JSON.stringify({
                        key: server, event_type: "MADDEN_BROADCAST", delivery: "EVENT_SOURCE", title: broadcastTitle, video: createTwitchUrl(broadcasterName)
                    }),
                    headers: {
                        "Content-Type": "application/json"
                    }
                })
            }
        }
    }))
}

router.post("/webhook",
    async (ctx, next) => {
        const secret = getSecret()
        const message = getHmacMessage(ctx)
        const hmac = HMAC_PREFIX + getHmac(secret, message)
        if (verifyMessage(hmac, ctx.request.get(TWITCH_MESSAGE_SIGNATURE))) {
            await next()
        } else {
            console.log("signatures dont match")
            ctx.status = 403
        }
    },
    async (ctx, next) => {
        if (ctx.request.get(MESSAGE_TYPE) === MESSAGE_TYPE_VERIFICATION) {
            ctx.set({ "Content-Type": "text/plain" })
            ctx.status = 200
            ctx.body = JSON.parse(ctx.request.rawBody).challenge
        } else {
            await next()
        }
    },
    async (ctx, next) => {
        if (MESSAGE_TYPE_REVOCATION === ctx.request.get(MESSAGE_TYPE)) {
            ctx.status = 204
            console.log(ctx.request.rawBody)
        } else {
            try {
                await next()
            } catch (err: any) {
                console.error(err)
                ctx.status = 500;
                ctx.body = {
                    message: err.message
                };
            }

        }
    },
    async (ctx, next) => {
        const twitchEvent = ctx.request.body as StreamUpEvent
        ctx.status = 200
        await next()
        const messageId = ctx.request.get(TWITCH_MESSAGE_ID)
        const messageSeen = messageCache.get(messageId)
        if (messageSeen) {
            console.log(`duplicate messsage found ${messageId}`)
            return
        }
        handleStreamEvent(twitchEvent)
        messageCache.set(messageId, { seen: true })
    })

export default router