/** A request the server understood but will not accept: answered with 422 and the problems found. */
export class ValidationError extends Error {
  name = 'ValidationError'
  issues: unknown[]
  constructor(message: string, issues: unknown[] = []) {
    super(message)
    this.issues = issues
  }
}
