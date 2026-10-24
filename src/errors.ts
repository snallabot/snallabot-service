export class SnallabotError extends Error {
  guidance: string
  error: Error
  constructor(error: Error, guidance: string) {
    super(`An error occurred!\n\nGuidance ${guidance}\n\nOriginal Error: ${error.message}`)
    this.guidance = guidance
    this.error = error
  }
}
