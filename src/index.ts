import app from "./server"
import { initializeApplicationEmojis } from "./discord/discord_utils"

const port = process.env.PORT || 3000

initializeApplicationEmojis()
  .catch(error => console.error("Discord emoji initialization failed; using text fallbacks", error))

app.listen(port, () => {
  console.log(`server started on ${port}`);
});
