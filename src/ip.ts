import * as ipaddr from "ipaddr.js";

import type { ClientIpOptions, HeaderReader } from "./types";

function parseIp(value: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  try {
    return ipaddr.parse(value.trim());
  } catch {
    return null;
  }
}

/**
 * Evaluates whether an IP address falls within a specified CIDR range.
 *
 * @param ip The candidate IP address.
 * @param cidr The target CIDR range (e.g. 192.168.1.0/24 or 2606:4700::/32).
 * @returns True if the IP belongs to the subnet range.
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const [base, rawPrefix] = cidr.split("/");
  const prefix = Number.parseInt(rawPrefix, 10);
  const parsedIp = parseIp(ip);
  const parsedBase = base ? parseIp(base) : null;
  if (!parsedIp || !parsedBase || !Number.isInteger(prefix)) {
    return false;
  }
  if (parsedIp.kind() !== parsedBase.kind()) return false;

  const maxPrefix = parsedIp.kind() === "ipv4" ? 32 : 128;
  if (prefix < 0 || prefix > maxPrefix) return false;

  return parsedIp.match(parsedBase, prefix);
}

function isPublicRange(ip: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  return ip.range() === "unicast";
}

/**
 * Assesses whether an IP address string is valid.
 * Optionally filters out private subnet IPs in production environments.
 *
 * @param ip The IP address string.
 * @param options Configurations for production environment checks.
 * @returns True if the IP address is valid and allowed.
 */
export function isValidIp(
  ip: string,
  options: { production?: boolean; allowPrivateInProduction?: boolean } = {},
): boolean {
  const parsedIp = parseIp(ip);
  if (!parsedIp) return false;
  if (options.production && !options.allowPrivateInProduction) {
    return isPublicRange(parsedIp);
  }
  return true;
}

function isLocalhost(value: string | null): boolean {
  return value === "::1" || value === "127.0.0.1";
}

/**
 * Resolves the true client IP address from request headers.
 * Safely walks backwards through multi-hop proxy chains (e.g. `X-Forwarded-For`) to peel off trusted proxies.
 *
 * @param request The request context.
 * @param options Configurations for production environments, trusted CIDRs, and fallbacks.
 * @returns The resolved client IP address.
 */
export function getClientIp(
  request: HeaderReader,
  options: ClientIpOptions = {},
): string {
  const production =
    options.production ?? process.env.NODE_ENV === "production";
  const unknown = options.unknownValue ?? "unknown";
  const devLocalhost = options.devLocalhostValue ?? "dev-localhost";
  const trustedProxyCidrs = options.trustedProxyCidrs ?? [];
  const isTrustedProxy = (ip: string) =>
    trustedProxyCidrs.some((cidr) => isIpInCidr(ip, cidr));

  const cfIp = request.headers.get("cf-connecting-ip");
  if (
    cfIp?.trim() &&
    (options.trustCfConnectingIp || !production) &&
    isValidIp(cfIp.trim(), options)
  ) {
    return cfIp.trim();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    if (production) {
      if (trustedProxyCidrs.length === 0 || ips.length < 2) {
        options.logger?.warn?.("Untrusted proxy header in production", {
          chain: forwardedFor,
        });
        return unknown;
      }

      let i = ips.length - 1;
      if (!isTrustedProxy(ips[i])) {
        options.logger?.warn?.("Suspicious or untrusted proxy chain", {
          chain: forwardedFor,
        });
        return unknown;
      }

      while (i > 0 && isTrustedProxy(ips[i])) {
        i--;
      }
      const clientIp = ips[i];
      if (isValidIp(clientIp, options)) return clientIp;
      options.logger?.warn?.("Suspicious or untrusted proxy chain", {
        chain: forwardedFor,
      });
      return unknown;
    }
    const devIp = ips[0];
    if (isValidIp(devIp, options)) return devIp;
    if (isLocalhost(devIp)) return devLocalhost;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim() && isValidIp(realIp.trim(), options)) return realIp.trim();
  if (
    !production &&
    (isLocalhost(cfIp) || isLocalhost(forwardedFor) || isLocalhost(realIp))
  ) {
    return devLocalhost;
  }
  return unknown;
}
