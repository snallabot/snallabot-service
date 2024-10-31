import Router from "@koa/router"

//TODO remove duplicate code when old bot is taken off
type AddChannelEvent = { key: "yt_channels", id: string, timestamp: string, event_type: "ADD_CHANNEL", channel_id: string, discord_server: string }
type RemoveChannelEvent = { key: "yt_channels", id: string, timestamp: string, event_type: "REMOVE_CHANNEL", channel_id: string, discord_server: string }
type EventQueryResponse = { "ADD_CHANNEL": Array<AddChannelEvent>, "REMOVE_CHANNEL": Array<RemoveChannelEvent> }

export function extractChannelId(html: string) {
    const linkTagIndex = html.indexOf('<link rel="canonical" href="')
    const sliced = html.slice(linkTagIndex)
    const linkTag = sliced.slice(0, sliced.indexOf(">"))
    return linkTag.replace('<link rel="canonical" href="', "").replace('>', "").replace('"', "").replace("https://www.youtube.com/channel/", "")
}

async function retrieveCurrentState(): Promise<Array<{ channel_id: string, discord_server: string }>> {
    const events = await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/query", {
        method: "POST",
        body: JSON.stringify({ event_types: ["ADD_CHANNEL", "REMOVE_CHANNEL"], key: "yt_channels", after: 0 }),
        headers: {
            "Content-Type": "application/json"
        }
    }).then(res => res.json() as Promise<EventQueryResponse>)
    //TODO: Replace with Object.groupBy
    let state = {} as { [key: string]: Array<AddChannelEvent> }
    events.ADD_CHANNEL.forEach(a => {
        const k = `${a.channel_id}|${a.discord_server}`
        if (!state[k]) {
            state[k] = [a]
        } else {
            state[k].push(a)
            state[k] = state[k].sort((a: AddChannelEvent, b: AddChannelEvent) => (new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())) // reverse chronologically order
        }
    })
    events.REMOVE_CHANNEL.forEach(a => {
        const k = `${a.channel_id}|${a.discord_server}`
        if (state?.[k]?.[0]) {
            if (new Date(a.timestamp) > new Date(state[k][0].timestamp)) {
                delete state[k]
            }
        }

    })
    return Object.keys(state).map(k => {
        const [channel_id, discord_server] = k.split("|")
        return { channel_id, discord_server }
    })

}


const router = new Router({ prefix: "youtube" })
type ConfigureRequest = { discord_server: string, youtube_url: string, event_type: string }
type ListRequest = { discord_server: string }

interface YoutubeNotifierHandler {
    addYoutubeChannel(discordServer: string, youtubeUrl: string): Promise<void>,
    removeYoutubeChannel(discordServer: string, youtubeUrl: string): Promise<void>,
    listYoutubeChannels(discordServer: string): Promise<string[]>
}

export const youtubeNotifierHandler: YoutubeNotifierHandler = {
    addYoutubeChannel: async (discordServer: string, youtubeUrl: string) => {
        const channelId = await fetch(youtubeUrl).then(r => r.text()).then(t => extractChannelId(t))
        if (channelId) {
            await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/post", {
                method: "POST",
                body: JSON.stringify({ key: "yt_channels", event_type: "ADD_CHANNEL", delivery: "EVENT_SOURCE", channel_id: channelId, discord_server: discordServer }),
                headers: {
                    "Content-Type": "application/json"
                }
            })
        } else {
            throw new Error("could not find valid channel id")
        }
    },
    removeYoutubeChannel: async (discordServer: string, youtubeUrl: string) => {
        const channelId = await fetch(youtubeUrl).then(r => r.text()).then(t => extractChannelId(t))
        if (channelId) {
            await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/post", {
                method: "POST",
                body: JSON.stringify({ key: "yt_channels", event_type: "REMOVE_CHANNEL", delivery: "EVENT_SOURCE", channel_id: channelId, discord_server: discordServer }),
                headers: {
                    "Content-Type": "application/json"
                }
            })
        } else {
            throw new Error("could not find valid channel id")
        }
    },
    listYoutubeChannels: async (discordServer: string) => {
        const state = await retrieveCurrentState()
        return state.filter(c => c.discord_server === discordServer).map(c => c.channel_id)
            .map(channel => `https://www.youtube.com/channel/${channel}`)
    }
}

router.post("/configure", async (ctx) => {
    const request = ctx.request.body as ConfigureRequest
    const eventType = request.event_type
    try {
        if (eventType === "ADD_CHANNEL") {
            await youtubeNotifierHandler.addYoutubeChannel(request.discord_server, request.youtube_url)
        } else if (eventType === "REMOVE_CHANNEL") {
            await youtubeNotifierHandler.removeYoutubeChannel(request.discord_server, request.youtube_url)
        }
        ctx.status = 200
    } catch (e) {
        ctx.status = 400
    }
}).post("/list", async (ctx) => {
    const request = ctx.request.body as ListRequest
    const channels = await youtubeNotifierHandler.listYoutubeChannels(request.discord_server)
    ctx.status = 200
    ctx.body = channels
})

export default router
