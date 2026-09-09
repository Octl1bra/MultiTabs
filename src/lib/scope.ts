import { etld1 } from "./etld";
import type { Scope } from "./types";

export interface ScopeLike {
  siteKey: string;
  scope: Scope;
}

export function isHttpUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

export function siteKeyFor(url: URL, scope: Scope, partitionTopLevelSite?: string | null): string {
  const host = url.hostname.toLowerCase();
  if (scope === "host") return host;
  if (partitionTopLevelSite) {
    try {
      const h = new URL(partitionTopLevelSite).hostname.toLowerCase();
      if (h) return h;
    } catch {
      /* fall through */
    }
  }
  return etld1(host);
}

export function hostInScope(a: ScopeLike, hostInput: string): boolean {
  const h = hostInput.toLowerCase();
  return a.scope === "host" ? h === a.siteKey : h === a.siteKey || h.endsWith("." + a.siteKey);
}

export function isInScope(a: ScopeLike, url: URL): boolean {
  if (!isHttpUrl(url)) return false;
  return hostInScope(a, url.hostname);
}

export function parseUrl(s: string | undefined | null): URL | null {
  if (!s) return null;
  try {
    return new URL(s);
  } catch {
    return null;
  }
}
