import { MongoClient, ServerApiVersion } from 'mongodb';

function setupMongoClient() {
  if (process.env.MONGO_CONNECTION_URI) {
    const client = new MongoClient(process.env.MONGO_CONNECTION_URI,
      {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true
        }
      }
    )
    return client
  }
  throw new Error("No connection uri to MongoDB provided")
}
const client = setupMongoClient()
const db = client.db("snallabot_data")
export default db
