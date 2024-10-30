import Koa from "koa"
import Router from "@koa/router"
import bodyParser from "@koa/bodyparser"

const app = new Koa()
const router = new Router()

export type SnallabotBaseEvent = { key: string, event_type: string }
export type Trigger5Min = { key: "time", event_type: "5_MIN_TRIGGER" }
type BroadcastConfigurationEvent = { channel_id: string, role?: string, id: string, timestamp: string, title_keyword: string }
type BroadcastConfigurationResponse = { "BROADCAST_CONFIGURATION": Array<BroadcastConfigurationEvent> }
type AddChannelEvent = { key: "yt_channels", id: string, timestamp: string, event_type: "ADD_CHANNEL", channel_id: string, discord_server: string }
type RemoveChannelEvent = { key: "yt_channels", id: string, timestamp: string, event_type: "REMOVE_CHANNEL", channel_id: string, discord_server: string }
type BroadcastEvent = { key: string, id: string, timestamp: string, event_type: "YOUTUBE_BROADCAST", video: string }
type EventQueryResponse = { "ADD_CHANNEL": Array<AddChannelEvent>, "REMOVE_CHANNEL": Array<RemoveChannelEvent> }

type ConfigureRequest = { discord_server: string, youtube_url: string, event_type: string }
type ListRequest = { discord_server: string }

function extractTitle(html: string) {
    const titleTagIndex = html.indexOf('[{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":')
    const sliced = html.slice(titleTagIndex)
    const titleTag = sliced.slice(0, sliced.indexOf("}"))
    return titleTag.replace('[{"videoPrimaryInfoRenderer":{"title":{"runs":[{"text":', "").replace('}', "").replaceAll('"', "")
}

function extractVideo(html: string) {
    const linkTagIndex = html.indexOf('{"status":"LIKE","target":{"videoId":')
    const sliced = html.slice(linkTagIndex)
    const linkTag = sliced.slice(0, sliced.indexOf("}"))
    return "https://www.youtube.com/watch?v=" + linkTag.replace('{"status":"LIKE","target":{"videoId":', "").replace('}', "").replaceAll('"', "")
}

function extractChannelId(html: string) {
    const linkTagIndex = html.indexOf('<link rel="canonical" href="')
    const sliced = html.slice(linkTagIndex)
    const linkTag = sliced.slice(0, sliced.indexOf(">"))
    return linkTag.replace('<link rel="canonical" href="', "").replace('>', "").replace('"', "").replace("https://www.youtube.com/channel/", "")
}

function isStreaming(html: string) {
    return (html.match(/"isLive":true/g) || []).length == 1 && !html.includes("Scheduled for")
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

router.post("/hook", async (ctx) => {
    const currentChannelServers = await retrieveCurrentState()
    const currentChannels = [...new Set(currentChannelServers.map(c => c.channel_id))]
    const currentServers = [...new Set(currentChannelServers.map(c => c.discord_server))]
    const channels = await Promise.all(currentChannels
        .map(channel_id =>
            fetch(`https://www.youtube.com/channel/${channel_id}/live`)
                .then(res => res.text())
                .then(t => isStreaming(t) ? [{ channel_id, title: extractTitle(t), video: extractVideo(t) }] : [])
        ))
    const serverTitleKeywords = await Promise.all(currentServers.map(server =>
        fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/query", {
            method: "POST",
            body: JSON.stringify({ event_types: ["BROADCAST_CONFIGURATION"], key: server, after: 0, limit: 1 }),
            headers: {
                "Content-Type": "application/json"
            }
        })
            .then(res => res.json() as Promise<BroadcastConfigurationResponse>)
            .then(r => {
                const sortedEvents = r.BROADCAST_CONFIGURATION.sort((a: BroadcastConfigurationEvent, b: BroadcastConfigurationEvent) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                if (sortedEvents.length === 0) {
                    console.error(`${server} is not configured for Broadcasts`)
                    return []
                } else {
                    const configuration = sortedEvents[0]
                    return [[server, configuration.title_keyword]]
                }
            })))
    const serverTitleMap: { [key: string]: string } = Object.fromEntries(serverTitleKeywords.flat())
    console.log(serverTitleMap)
    const currentlyLiveStreaming = channels.flat()
    console.log(`currently streaming: ${JSON.stringify(currentlyLiveStreaming)}`)
    const startTime = new Date()
    startTime.setDate(startTime.getDate() - 1)
    const pastBroadcasts = await Promise.all(currentlyLiveStreaming.map(c =>
        fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/query", {
            method: "POST",
            body: JSON.stringify({ event_types: ["YOUTUBE_BROADCAST"], key: c.channel_id, after: startTime.getTime(), limit: 2 }),
            headers: {
                "Content-Type": "application/json"
            }
        })
            .then(res => res.json() as Promise<{ "YOUTUBE_BROADCAST": Array<BroadcastEvent> }>)
            .then(t => ({ [c.channel_id]: t.YOUTUBE_BROADCAST.map(b => b.video) }))
    ))
    const channelToPastBroadcastMap: { [key: string]: Array<string> } = pastBroadcasts.reduce((prev, curr) => {
        Object.assign(prev, curr)
        return prev
    }, {})

    const newBroadcasts = currentlyLiveStreaming.filter(c => !channelToPastBroadcastMap[c.channel_id]?.includes(c.video))
    console.log(`broadcasts that are new: ${JSON.stringify(newBroadcasts)}`)
    await Promise.all(newBroadcasts.map(b => fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/post", {
        method: "POST",
        body: JSON.stringify({ key: b.channel_id, event_type: "YOUTUBE_BROADCAST", delivery: "EVENT_SOURCE", video: b.video }),
        headers: {
            "Content-Type": "application/json"
        }
    })
    ))
    const channelTitleMap: { [key: string]: { title: string, video: string } } = Object.fromEntries(newBroadcasts.map(c => [[c.channel_id], { title: c.title, video: c.video }]))
    console.log(channelTitleMap)
    await Promise.all(currentChannelServers.filter(c => channelTitleMap[c.channel_id] && channelTitleMap[c.channel_id].title.toLowerCase().includes(serverTitleMap[c.discord_server].toLowerCase())).map(c =>
        fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/post", {
            method: "POST",
            body: JSON.stringify({ key: c.discord_server, event_type: "MADDEN_BROADCAST", delivery: "EVENT_SOURCE", title: channelTitleMap[c.channel_id].title, video: channelTitleMap[c.channel_id].video }),
            headers: {
                "Content-Type": "application/json"
            }
        })
    ))

    ctx.status = 200
})
    .post("/configure", async (ctx) => {
        const request = ctx.request.body as ConfigureRequest
        const channelId = await fetch(request.youtube_url).then(r => r.text()).then(t => extractChannelId(t))
        if (channelId) {
            await fetch("https://snallabot-event-sender-b869b2ccfed0.herokuapp.com/post", {
                method: "POST",
                body: JSON.stringify({ key: "yt_channels", event_type: request.event_type, delivery: "EVENT_SOURCE", channel_id: channelId, discord_server: request.discord_server }),
                headers: {
                    "Content-Type": "application/json"
                }
            })
            ctx.status = 200
        } else {
            ctx.status = 400
        }
    })
    .post("/list", async (ctx) => {
        const request = ctx.request.body as ListRequest
        const state = await retrieveCurrentState()
        const channels = state.filter(c => c.discord_server === request.discord_server).map(c => c.channel_id)
            .map(channel => `https://www.youtube.com/channel/${channel}`)
        ctx.status = 200
        ctx.body = channels
    })

app.use(bodyParser({ enableTypes: ["json"], encoding: "utf-8" }))
    .use(async (ctx, next) => {
        try {
            await next()
        } catch (err: any) {
            console.error(err)
            ctx.status = 500;
            ctx.body = {
                message: err.message
            };
        }
    })
    .use(router.routes())
    .use(router.allowedMethods())

export default app
