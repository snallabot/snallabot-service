import FileHandler from "../file_handlers"
import NodeCache from "node-cache"

const hash: (a: any) => string = require("object-hash")
const treeCache = new NodeCache({ maxKeys: 100000 })
const CACHE_TTL = 3600 * 48 // 2 days in seconds
// debug function
export function getMaddenCacheStats() {
  return treeCache.getStats()
}

type Node = {
  hash: string,
  children: Array<Node>
}

type MerkleTree = {
  headNode: Node
}

function flatten(tree: MerkleTree): Array<Node> {
  return tree.headNode.children.concat(tree.headNode.children.flatMap(n => flatten({ headNode: n })))
}

export function findDifferences(incoming: MerkleTree, old: MerkleTree): Array<string> {
  if (incoming.headNode.hash === old.headNode.hash) {
    return []
  } else {
    const oldHashes = Object.fromEntries(old.headNode.children.map(h => [h.hash, h]))
    return incoming.headNode.children.flatMap(c => {
      if (oldHashes[c.hash]) {
        return []
      }
      return [c.hash].concat(flatten({ headNode: c }).map(n => n.hash))
    })
  }
}

export function createTwoLayer(nodes: Array<Node>): MerkleTree {
  const topHash = hash(nodes.map(c => c.hash))
  return { headNode: { hash: topHash, children: nodes } }
}

function createCacheKey(league: string, request_type: string): string {
  return `${league}|${request_type}`
}

interface MaddenHashStorage {
  readTree(league: string, request_type: string, event_type: string): Promise<MerkleTree>,
  writeTree(league: string, request_type: string, event_type: string, tree: MerkleTree): Promise<void>
}

function filePath(leagueId: string, event_type: string, request_type: string) {
  return `league_hashes/${leagueId}/${event_type}/${request_type}.json`
}

const HashStorage: MaddenHashStorage = {
  readTree: async function(league: string, request_type: string, event_type: string): Promise<MerkleTree> {
    const cachedTree = treeCache.get(createCacheKey(league, request_type)) as MerkleTree
    if (cachedTree) {
      return cachedTree
    } else {
      try {
        const tree = await FileHandler.readFile<MerkleTree>(filePath(league, event_type, request_type))
        try {
          treeCache.set(createCacheKey(league, request_type), tree, CACHE_TTL)
        } catch (e) {
        }
        return tree
      } catch (e) {
        return { headNode: { children: [], hash: hash("") } }
      }
    }
  },
  writeTree: async function(league: string, request_type: string, event_type: string, tree: MerkleTree): Promise<void> {
    try {
      treeCache.set(createCacheKey(league, request_type), tree, CACHE_TTL)
    } catch (e) {
    }
    try {
      await FileHandler.writeFile<MerkleTree>(tree, filePath(league, event_type, request_type))
    } catch (e) {
    }
  }
}
export default HashStorage
