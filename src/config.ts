if (!process.env.DEPLOYMENT_URL) {
  throw new Error(`Missing Deployment URL for bot, for local this would be localhost:PORT`)
}
export const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL
