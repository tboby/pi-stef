import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import type { WebAccessConfig } from "../types";
import { createPinnedLookup, parseGuardedUrl, resolveGuardedHostname, type ResolveOptions } from "../networkPolicy";
import type { ResolvedAddress } from "../types";
import type { FetchTextResponse } from "../search/types";

export interface GuardedHttpRequestPlan {
  lookup: ReturnType<typeof createPinnedLookup>;
  request: typeof httpRequest;
  resolvedAddress: ResolvedAddress;
  transport: "http" | "https";
  url: URL;
}

const MAX_REDIRECTS = 5;

export async function createGuardedHttpRequestPlan(
  input: string,
  options: ResolveOptions = {},
): Promise<GuardedHttpRequestPlan> {
  const url = parseGuardedUrl(input);
  const [resolvedAddress] = await resolveGuardedHostname(url, options);
  if (!resolvedAddress) {
    throw new Error(`No DNS results found for ${url.hostname}`);
  }

  return {
    lookup: createPinnedLookup(resolvedAddress),
    request: url.protocol === "http:" ? httpRequest : httpsRequest,
    resolvedAddress,
    transport: url.protocol === "http:" ? "http" : "https",
    url,
  };
}

export async function fetchGuardedText(
  input: string,
  options: { config: WebAccessConfig; signal?: AbortSignal },
  redirectCount = 0,
): Promise<FetchTextResponse> {
  if (options.signal?.aborted) {
    throw new Error(`Aborted fetching ${input}`);
  }
  const plan = await createGuardedHttpRequestPlan(input, {
    allowPrivateNetworks: options.config.allowPrivateNetworks,
  });

  return new Promise((resolve, reject) => {
    const request = plan.request(
      plan.url,
      {
        headers: {
          "accept-encoding": "identity",
          "user-agent": options.config.userAgent,
        },
        lookup: plan.lookup,
        timeout: options.config.fetchTimeoutMs,
      },
      (response) => {
        if (isRedirect(response.statusCode ?? 0) && response.headers.location) {
          if (redirectCount >= MAX_REDIRECTS) {
            response.resume();
            reject(new Error(`Too many redirects fetching ${plan.url}`));
            return;
          }
          response.resume();
          resolve(
            fetchGuardedText(new URL(response.headers.location, plan.url).toString(), options, redirectCount + 1),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.byteLength;
          if (receivedBytes > options.config.fetchMaxBytes) {
            response.destroy(new Error(`Response exceeded fetchMaxBytes (${options.config.fetchMaxBytes}) for ${plan.url}`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            contentType: contentType(response.headers["content-type"]),
            status: response.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
            url: plan.url.toString(),
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error(`Timed out fetching ${plan.url}`));
    });
    options.signal?.addEventListener("abort", () => {
      request.destroy(new Error(`Aborted fetching ${plan.url}`));
    }, { once: true });
    request.end();
  });
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function contentType(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
