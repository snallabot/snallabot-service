import { MongoClient, ServerApiVersion, Db } from 'mongodb';
import { DB, DBs } from "../config"

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
    console.log("Using MongoDB")
    return client
  } else {
    throw new Error("Missing Mongo connection uri")
  }
}
let db = {} as Db
if (DB == DBs.MONGO) {
  const client = setupMongoClient()
  db = client.db("snallabot_data")
}
export default db
