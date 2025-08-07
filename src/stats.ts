import db from "./db/firebase"

async function count() {
  const docs = await db.collection("madden_data26").listDocuments()
  console.log(docs.length)
}

count()
