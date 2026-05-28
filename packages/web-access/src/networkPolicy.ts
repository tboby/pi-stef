import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

import type { ResolvedAddress } from "./types";

export interface ResolveOptions {
  allowPrivateNetworks?: boolean;
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: 4 | 6,
) => void;

const BLOCKED_IPV4_RANGES: Array<[number, number]> = [
  [ipv4ToNumber("0.0.0.0"), 8],
  [ipv4ToNumber("10.0.0.0"), 8],
  [ipv4ToNumber("100.64.0.0"), 10],
  [ipv4ToNumber("127.0.0.0"), 8],
  [ipv4ToNumber("169.254.0.0"), 16],
  [ipv4ToNumber("172.16.0.0"), 12],
  [ipv4ToNumber("192.0.0.0"), 24],
  [ipv4ToNumber("192.0.2.0"), 24],
  [ipv4ToNumber("192.168.0.0"), 16],
  [ipv4ToNumber("198.18.0.0"), 15],
  [ipv4ToNumber("198.51.100.0"), 24],
  [ipv4ToNumber("203.0.113.0"), 24],
  [ipv4ToNumber("224.0.0.0"), 4],
  [ipv4ToNumber("240.0.0.0"), 4],
];

const BLOCKED_IPV6_RANGES: Array<[bigint, number]> = [
  [ipv6ToBigInt("::"), 128],
  [ipv6ToBigInt("::1"), 128],
  [ipv6ToBigInt("fc00::"), 7],
  [ipv6ToBigInt("fe80::"), 10],
  [ipv6ToBigInt("ff00::"), 8],
  [ipv6ToBigInt("2001:db8::"), 32],
];

export function parseGuardedUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https URLs are allowed: ${url.protocol}`);
  }
  return url;
}

export function isBlockedIp(address: string): boolean {
  const mapped = parseIpv4Mapped(address);
  if (mapped) {
    return isBlockedIpv4(mapped);
  }
  const family = net.isIP(address);
  if (family === 4) {
    return isBlockedIpv4(address);
  }
  if (family === 6) {
    return isBlockedIpv6(address);
  }
  return true;
}

export async function resolveGuardedHostname(url: URL, options: ResolveOptions = {}): Promise<ResolvedAddress[]> {
  const hostname = stripIpv6Brackets(url.hostname);
  const directFamily = net.isIP(hostname);
  const resolved =
    directFamily === 4 || directFamily === 6
      ? [{ address: hostname, family: directFamily as 4 | 6 }]
      : await (options.lookup ?? defaultLookup)(hostname);

  const blocked = resolved.filter((entry) => isBlockedIp(entry.address));
  if (!options.allowPrivateNetworks && blocked.length > 0) {
    throw new Error(`Blocked private or reserved address for ${url.hostname}: ${blocked.map((entry) => entry.address).join(", ")}`);
  }
  return resolved;
}

export function createPinnedLookup(resolved: ResolvedAddress) {
  return (_hostname: string, options: unknown, callback?: LookupCallback): void => {
    const cb = typeof options === "function" ? (options as LookupCallback) : callback;
    if (!cb) {
      throw new Error("Pinned lookup requires a callback.");
    }
    if (lookupRequestsAll(options)) {
      cb(null, [resolved]);
      return;
    }
    cb(null, resolved.address, resolved.family);
  };
}

function lookupRequestsAll(options: unknown): boolean {
  return typeof options === "object" && options !== null && "all" in options && (options as { all?: boolean }).all === true;
}

async function defaultLookup(hostname: string): Promise<ResolvedAddress[]> {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((result) => ({ address: result.address, family: result.family as 4 | 6 }));
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  return BLOCKED_IPV4_RANGES.some(([range, bits]) => matchesIpv4Cidr(value, range, bits));
}

function isBlockedIpv6(address: string): boolean {
  const value = ipv6ToBigInt(address);
  return BLOCKED_IPV6_RANGES.some(([range, bits]) => matchesIpv6Cidr(value, range, bits));
}

function matchesIpv4Cidr(value: number, range: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (range & mask);
}

function matchesIpv6Cidr(value: bigint, range: bigint, bits: number): boolean {
  const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === (range & mask);
}

function ipv4ToNumber(address: string): number {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    throw new Error(`Invalid IPv4 address: ${address}`);
  }
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function ipv6ToBigInt(address: string): bigint {
  const normalized = address.toLowerCase();
  const [head = "", tail = ""] = normalized.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [...headParts, ...Array(Math.max(missing, 0)).fill("0"), ...tailParts];
  if (parts.length !== 8) {
    throw new Error(`Invalid IPv6 address: ${address}`);
  }
  return parts.reduce((value, part) => (value << 16n) + BigInt(Number.parseInt(part || "0", 16)), 0n);
}

function parseIpv4Mapped(address: string): string | undefined {
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const suffix = address.slice("::ffff:".length);
    return net.isIP(suffix) === 4 ? suffix : undefined;
  }
  return undefined;
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
