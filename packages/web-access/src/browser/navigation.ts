import type { WebAccessConfig } from "../types";
import { parseGuardedUrl, resolveGuardedHostname } from "../networkPolicy";

export async function guardBrowserNavigation(input: string, config: WebAccessConfig): Promise<string> {
  const url = parseGuardedUrl(input);
  await resolveGuardedHostname(url, { allowPrivateNetworks: config.allowPrivateNetworks });
  return url.toString();
}
