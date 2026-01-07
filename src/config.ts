if (!process.env.DEPLOYMENT_URL) {
  throw new Error(`Missing Deployment URL for bot, for local this would be localhost:PORT`)
}
let deployment = ""
if (process.env.DEPLOYMENT_URL.startsWith("localhost")) {
  deployment = "http://" + process.env.DEPLOYMENT_URL
} else if (!process.env.DEPLOYMENT_URL.startsWith("http")) {
  deployment = "https://" + process.env.DEPLOYMENT_URL
} else {
  deployment = process.env.DEPLOYMENT_URL
}
export const DEPLOYMENT_URL = deployment

let queueConcurrency = 1
if (process.env.QUEUE_CONCURRENCY) {
  queueConcurrency = Number(process.env.QUEUE_CONCURRENCY)
}
export const QUEUE_CONCURRENCY = queueConcurrency
