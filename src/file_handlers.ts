import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { Storage } from '@google-cloud/storage'
import { readFileSync } from 'fs'

interface FileHandler {
  readFile<T>(path: string, serializer: Serializer<T>): Promise<T>,
  writeFile<T>(content: T, path: string, serializer: Serializer<T>): Promise<string>
}

interface Serializer<T> {
  serialize(obj: T): Buffer,
  deserialize(s: Buffer): T
  contentType(): string
}

class JsonSerializer<T> implements Serializer<T> {
  serialize(o: T): Buffer {
    return Buffer.from(JSON.stringify(o), 'utf-8')
  }
  deserialize(data: Buffer): T {
    return JSON.parse(data.toString('utf-8')) as T
  }
  contentType() {
    return "application/json"
  }
}

class ImageSerializer implements Serializer<string> {
  serialize(base64DataUrl: string): Buffer {
    // Extract just the base64 data from the data URL
    // Input format: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    // We want to store just the base64 part as binary data
    let base64Data: string;
    if (base64DataUrl.startsWith('data:')) {
      base64Data = base64DataUrl.split(',')[1];
    } else {
      // If it's already just base64 data, use as is
      base64Data = base64DataUrl;
    }
    return Buffer.from(base64Data, 'base64');
  }

  deserialize(bufferData: Buffer): string {
    // Convert buffer back to base64 string and add data URL prefix
    const base64Data = bufferData.toString('base64');
    return `data:image/png;base64,${base64Data}`;
  }
  contentType() {
    return "image/png"
  }
}
export function defaultSerializer<T>() {
  return new JsonSerializer<T>()
}

export const imageSerializer = new ImageSerializer()

// Local file storage implementation
class LocalFileHandler implements FileHandler {
  private tempDir: string

  constructor() {
    this.tempDir = os.tmpdir()
  }

  async readFile<T>(filePath: string, serializer: Serializer<T>): Promise<T> {
    try {
      const fullPath = path.join(this.tempDir, filePath)
      const data = await fs.readFile(fullPath)
      return serializer.deserialize(data)
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`)
    }
  }

  async writeFile<T>(content: T, filePath: string, serializer: Serializer<T>): Promise<string> {
    try {
      const fullPath = path.join(this.tempDir, filePath)

      // Ensure directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true })

      const data = serializer.serialize(content)
      await fs.writeFile(fullPath, data, 'utf-8')
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

  async readFile<T>(filePath: string, serializer: Serializer<T>): Promise<T> {
    try {
      const [bucketName, ...pathParts] = filePath.split('/')
      const objectPath = pathParts.join('/')

      const file = this.storage.bucket(bucketName).file(objectPath)
      const data = await file.download()
      return serializer.deserialize(data[0])
    } catch (error) {
      throw new Error(`Failed to read file ${filePath} from GCS: ${error}`)
    }
  }

  async writeFile<T>(content: T, filePath: string, serializer: Serializer<T>): Promise<string> {
    try {
      const [bucketName, ...pathParts] = filePath.split('/')
      const objectPath = pathParts.join('/')

      const file = this.storage.bucket(bucketName).file(objectPath)
      const data = serializer.serialize(content)
      let tries = 0
      const maxRetries = MAX_TRIES
      const baseDelay = 1000

      while (tries <= maxRetries) {
        try {
          await file.save(data, {
            metadata: {
              contentType: serializer.contentType()
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
const fileHandler = serviceAccount && process.env.USE_GCS ? new GCSFileHandler(serviceAccount) : new LocalFileHandler
export default fileHandler
