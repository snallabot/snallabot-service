import db from "./db/firebase"

async function count() {
  const docs = await db.collection("league_data").listDocuments()
  console.log(docs.length)
}

count()
