import db from "../db/firebase"
import { MessageId } from "./settings_db"

export type TradeAsset =
  | { type: "PLAYER", rosterId: number, name: string, position: string, age: number, overall: number, dev: string }
  | { type: "PICK", label: string }

export type TradeVote = "APPROVE" | "REJECT"
export type TradeStatus = "PENDING" | "APPROVED" | "REJECTED"

export type TradeSubmission = {
  id: string
  guildId: string
  leagueId: string
  submittedBy: string
  teamA: { id: number, name: string, assets: TradeAsset[] }
  teamB: { id: number, name: string, assets: TradeAsset[] }
  votes: Record<string, TradeVote>
  requiredApprovals: number
  status: TradeStatus
  messageId?: MessageId
  createdAt: number
}

const trades = db.collection("trade_submissions")

const TradeDB = {
  async create(trade: Omit<TradeSubmission, "id">): Promise<TradeSubmission> {
    const ref = trades.doc()
    const submission = { ...trade, id: ref.id }
    await ref.set(submission)
    return submission
  },

  async attachMessage(tradeId: string, messageId: MessageId): Promise<void> {
    await trades.doc(tradeId).update({ messageId })
  },

  async vote(tradeId: string, userId: string, vote: TradeVote): Promise<TradeSubmission> {
    return db.runTransaction(async transaction => {
      const ref = trades.doc(tradeId)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) throw new Error("Trade submission no longer exists")
      const trade = snapshot.data() as TradeSubmission
      if (trade.status !== "PENDING") throw new Error(`Trade is already ${trade.status.toLowerCase()}`)

      const votes = { ...trade.votes, [userId]: vote }
      const approvals = Object.values(votes).filter(v => v === "APPROVE").length
      const rejections = Object.values(votes).filter(v => v === "REJECT").length
      const status: TradeStatus = approvals >= trade.requiredApprovals
        ? "APPROVED"
        : rejections >= trade.requiredApprovals ? "REJECTED" : "PENDING"
      const updated = { ...trade, votes, status }
      transaction.set(ref, updated)
      return updated
    })
  }
}

export default TradeDB
