export class AtlassianApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly statusText: string,
    readonly method: string,
    readonly path: string,
    readonly responseText: string,
  ) {
    super(message);
    this.name = "AtlassianApiError";
  }
}
