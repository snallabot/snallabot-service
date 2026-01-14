export class SnallabotError extends Error {
  guidance: string
  constructor(error: Error, guidance: string) {
    super(`An error ocurred! Guidance ${guidance} Original Error: ${error.message}`)
    this.guidance = guidance
  }
}
