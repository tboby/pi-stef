import path from "node:path";

export const PI_DIR = ".pi";
export const SF_NAMESPACE = "sf";

export function sfBase(home: string): string {
  return path.join(home, PI_DIR, SF_NAMESPACE);
}
