import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ApiError, Storage } from '@google-cloud/storage'
import { readFileSync } from 'fs'

interface FileHandler {
  readFile<T>(path: string): Promise<T>,
  writeFile<T>(content: T, path: string): Promise<string>
}

// Local file storage implementation
class LocalFileHandler implements FileHandler {
  private tempDir: string

  constructor() {
    this.tempDir = os.tmpdir()
  }

  async readFile<T>(filePath: string): Promise<T> {
    try {
      const fullPath = path.join(this.tempDir, filePath)
      const data = await fs.readFile(fullPath, 'utf-8')
      return JSON.parse(data) as T
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`)
    }
  }

  async writeFile<T>(content: T, filePath: string): Promise<string> {
    try {
      const fullPath = path.join(this.tempDir, filePath)

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true })

      const jsonContent = JSON.stringify(content)
      await fs.writeFile(fullPath, jsonContent, 'utf-8')
      return filePath // Return the provided path
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error}`)
    }
  }
}


const MAX_TRIES = 5
// Google Cloud Storage implementation
class GCSFileHandler implements FileHandler {
  private storage: Storage

  constructor(serviceAccount: string) {
    this.storage = new Storage({
      projectId: "snallabot",
      credentials: JSON.parse(serviceAccount),
      retryOptions: {
        autoRetry: true,
        retryDelayMultiplier: 5,
      }
    })
  }

  async readFile<T>(filePath: string): Promise<T> {
    try {
      const [bucketName, ...pathParts] = filePath.split('/')
      const objectPath = pathParts.join('/')

      const file = this.storage.bucket(bucketName).file(objectPath)
      const data = await file.download()
      return JSON.parse(data.toString()) as T
    } catch (error) {
      throw new Error(`Failed to read file ${filePath} from GCS: ${error}`)
    }
  }

  async writeFile<T>(content: T, filePath: string): Promise<string> {
    try {
      const [bucketName, ...pathParts] = filePath.split('/')
      const objectPath = pathParts.join('/')

      const file = this.storage.bucket(bucketName).file(objectPath)
      const jsonContent = JSON.stringify(content)
      let tries = 0
      const maxRetries = MAX_TRIES
      const baseDelay = 1000

      while (tries <= maxRetries) {
        try {
          await file.save(jsonContent, {
            metadata: {
              contentType: 'application/json'
            }
          })
          break // Success, exit the loop
        } catch (saveError) {
          const delay = baseDelay * Math.pow(2, tries - 1) // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
      return filePath // Return the provided path
    } catch (error) {
      throw new Error(`Failed to write file ${filePath} to GCS: ${error}`)
    }
  }
}

let serviceAccount;
if (process.env.SERVICE_ACCOUNT_FILE) {
  serviceAccount = readFileSync(process.env.SERVICE_ACCOUNT_FILE, 'utf8')
} else if (process.env.SERVICE_ACCOUNT) {
  serviceAccount = process.env.SERVICE_ACCOUNT
}
const fileHandler = serviceAccount ? new GCSFileHandler(serviceAccount) : new LocalFileHandler
export default fileHandler
