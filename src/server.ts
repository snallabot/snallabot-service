import Koa from "koa"
import bodyParser from "@koa/bodyparser"
import serve from "koa-static"
import path from "path"
import exportRouter from "./export/routes"
import discordRouter from "./discord/routes"
import twitchRouter from "./twitch-notifier/routes"
import youtubeRouter from "./yt-notifier/routes"

const app = new Koa()

app
  .use(serve(path.join(__dirname, 'public')))
  .use(bodyParser({ enableTypes: ["json"], encoding: "utf-8", jsonLimit: "100mb" }))
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
  .use(exportRouter.routes())
  .use(exportRouter.allowedMethods())
  .use(discordRouter.routes())
  .use(discordRouter.allowedMethods())
  .use(twitchRouter.routes())
  .use(twitchRouter.allowedMethods())
  .use(youtubeRouter.routes())
  .use(youtubeRouter.allowedMethods())

export default app
