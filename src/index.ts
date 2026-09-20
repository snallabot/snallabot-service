import app from "./server"
import { latencyMiddleware } from "./debug/metrics"

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`server started on ${port}`);
});

app.use(latencyMiddleware)
