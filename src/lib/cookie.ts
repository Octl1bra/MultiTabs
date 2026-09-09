import { etld1 } from "./etld";
import { SESSION_COOKIE_TTL_MS, type PageCookie, type SameSite, type StoredCookie } from "./types";

export function cookieKey(c: { domain: string; path: string; name: string }): string {
  return `${c.domain}|${c.path}|${c.name}`;
}

/** RFC 6265 §5.1.4 default-path */
export function defaultPath(uriPath: string): string {
  if (!uriPath || uriPath[0] !== "/") return "/";
  const idx = uriPath.lastIndexOf("/");
  if (idx <= 0) return "/";
  return uriPath.slice(0, idx);
}

/** RFC 6265 §5.1.3 domain-match（host 是否属于 domain） */
export function domainMatches(host: string, cookieDomain: string, hostOnly: boolean): boolean {
  const h = host.toLowerCase();
  const d = cookieDomain.toLowerCase();
  if (hostOnly) return h === d;
  return h === d || h.endsWith("." + d);
}

function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
}

export interface ParsedSetCookie {
  cookie: StoredCookie;
  /** Max-Age<=0 或已过期，应删除 */
  isDeletion: boolean;
}

/**
 * 解析一条 Set-Cookie（或 document.cookie 赋值）。
 * 返回 null 表示这条 cookie 无效应丢弃（空名、非法 Domain、Domain 高于 eTLD+1 等）。
 */
export function parseSetCookie(
  header: string,
  requestUrl: URL,
  now: number = Date.now(),
): ParsedSetCookie | null {
  const parts = header.split(";");
  const nv = parts.shift() ?? "";
  const eq = nv.indexOf("=");
  let name: string;
  let value: string;
  if (eq < 0) {
    // "value" without name —— Chrome 允许无名 cookie；这里按空名处理
    name = "";
    value = nv.trim();
  } else {
    name = nv.slice(0, eq).trim();
    value = nv.slice(eq + 1).trim();
  }
  if (!name && !value) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s;,"]/.test(name) || /[\x00-\x1f\x7f]/.test(name)) return null;

  const requestHost = requestUrl.hostname.toLowerCase();
  let domain = requestHost;
  let hostOnly = true;
  let path: string | null = null;
  let secure = false;
  let httpOnly = false;
  let sameSite: SameSite = "unspecified";
  let expires: number | null = null;
  let maxAge: number | null = null;

  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const i = p.indexOf("=");
    const attr = (i < 0 ? p : p.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? "" : p.slice(i + 1).trim();
    switch (attr) {
      case "domain": {
        if (!val) break; // 空 Domain 忽略
        const d = normalizeDomain(val);
        if (!d) break;
        // Domain 必须 domain-match 请求主机，且不得高于 eTLD+1
        if (!domainMatches(requestHost, d, false)) return null;
        const e = etld1(requestHost);
        if (!(d === e || d.endsWith("." + e))) return null;
        domain = d;
        hostOnly = false;
        break;
      }
      case "path":
        path = val && val[0] === "/" ? val : null;
        break;
      case "secure":
        secure = true;
        break;
      case "httponly":
        httpOnly = true;
        break;
      case "samesite": {
        const v = val.toLowerCase();
        sameSite = v === "lax" || v === "strict" || v === "none" ? v : "unspecified";
        break;
      }
      case "max-age": {
        if (!/^-?\d+$/.test(val)) break;
        maxAge = parseInt(val, 10);
        break;
      }
      case "expires": {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) expires = t;
        break;
      }
      default:
        break;
    }
  }

  if (maxAge !== null) {
    expires = maxAge <= 0 ? 0 : now + maxAge * 1000;
  }
  // __Host- / __Secure- 前缀规则
  if (name.startsWith("__Secure-") && !secure) return null;
  if (name.startsWith("__Host-") && (!secure || !hostOnly || (path !== null && path !== "/")))
    return null;

  const cookie: StoredCookie = {
    name,
    value,
    domain,
    hostOnly,
    path: path ?? defaultPath(requestUrl.pathname),
    secure,
    httpOnly,
    sameSite,
    expires,
    createdAt: now,
    updatedAt: now,
  };
  return { cookie, isDeletion: expires !== null && expires <= now };
}

export function isExpired(
  c: Pick<StoredCookie, "expires" | "updatedAt">,
  now: number = Date.now(),
): boolean {
  if (c.expires !== null) return c.expires <= now;
  return now - c.updatedAt > SESSION_COOKIE_TTL_MS;
}

/** RFC 6265 §5.4：path 长的在前，其次创建早的在前 */
export function sortForHeader<T extends { path: string; createdAt: number }>(cookies: T[]): T[] {
  return [...cookies].sort((a, b) => b.path.length - a.path.length || a.createdAt - b.createdAt);
}

export function serializeCookieHeader(
  cookies: Array<{ name: string; value: string; path: string; createdAt: number }>,
): string {
  return sortForHeader(cookies)
    .map((c) => (c.name ? `${c.name}=${c.value}` : c.value))
    .join("; ");
}

/** 一个主机在某个协议下应携带哪些 cookie */
export function cookiesForHost<
  T extends StoredCookie | (PageCookie & { createdAt?: number; updatedAt?: number }),
>(
  cookies: T[],
  host: string,
  opts: { secureContext: boolean; includeHttpOnly: boolean; now?: number },
): T[] {
  const now = opts.now ?? Date.now();
  return cookies.filter((c) => {
    if (!domainMatches(host, c.domain, c.hostOnly)) return false;
    if (c.secure && !opts.secureContext) return false;
    if ("httpOnly" in c && c.httpOnly && !opts.includeHttpOnly) return false;
    if (c.expires !== null && c.expires <= now) return false;
    if (
      c.expires === null &&
      "updatedAt" in c &&
      typeof c.updatedAt === "number" &&
      now - c.updatedAt > SESSION_COOKIE_TTL_MS
    )
      return false;
    return true;
  });
}

export function toPageCookie(c: StoredCookie): PageCookie {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    hostOnly: c.hostOnly,
    path: c.path,
    secure: c.secure,
    sameSite: c.sameSite,
    expires: c.expires,
  };
}

/** 解析 Clear-Site-Data 头，返回小写指令集合（去引号） */
export function parseClearSiteData(header: string): Set<string> {
  const out = new Set<string>();
  for (const part of header.split(",")) {
    const v = part.trim().replace(/^"|"$/g, "").toLowerCase();
    if (v) out.add(v);
  }
  return out;
}
