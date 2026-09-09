export type Scope = "site" | "host";

export interface Session {
  id: string; // 随机 id，12 位
  name: string; // ≤ 40 字符
  siteKey: string; // "example.com" | "www.example.com"
  scope: Scope;
  color: string; // 调色板之一，hex
  createdAt: number;
  lastUsedAt: number;
}

export type SameSite = "lax" | "strict" | "none" | "unspecified";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string; // 规范化：小写、无前导点
  hostOnly: boolean; // Set-Cookie 未带 Domain 属性时为 true
  path: string; // 默认按 RFC 6265 从请求路径推导
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSite;
  expires: number | null; // epoch ms；null = 会话 cookie
  createdAt: number; // RFC 6265 排序用；upsert 时保留
  updatedAt: number;
}

export interface Assignment {
  sessionId: string;
  siteKey: string;
  scope: Scope;
}

export interface SiteBinding {
  siteKey: string;
  sessionId: string;
}

/** 同步信号 / 兜底注入共用的补丁配置 */
export interface PatchConfig {
  sid: string;
  cookies: PageCookie[];
}

export interface PageCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  sameSite: SameSite;
  expires: number | null;
}

export const PALETTE = ["#1d4ed8", "#047857", "#b45309", "#be123c", "#6d28d9", "#0f766e"] as const;
export const MAX_SESSION_NAME = 40;
/** 会话 cookie（无 expires）多久不更新视为过期 */
export const SESSION_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const STORAGE_PREFIX = "mt:";
