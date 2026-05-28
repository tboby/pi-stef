export interface CursorPage<T> {
  results?: T[];
  values?: T[];
  nextPageToken?: string;
  next?: string;
  isLast?: boolean;
  _links?: {
    next?: string;
  };
}

export function getNextCursor<T>(page: CursorPage<T>): string | undefined {
  if (page.nextPageToken) return page.nextPageToken;
  if (page._links?.next) {
    const cursor = new URL(page._links.next, "https://example.invalid").searchParams.get("cursor");
    return cursor ?? undefined;
  }
  if (page.next) {
    const cursor = new URL(page.next, "https://example.invalid").searchParams.get("cursor");
    return cursor ?? undefined;
  }
  return undefined;
}
