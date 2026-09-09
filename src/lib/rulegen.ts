import { cookiesForHost, serializeCookieHeader, toPageCookie } from "./cookie";
import { encodeSignalHeader } from "./signal";
import type { Assignment, StoredCookie } from "./types";

/** 与 chrome.declarativeNetRequest.Rule 结构一致的纯 JSON 形态，方便单测快照 */
export interface DnrHeaderOp {
  header: string;
  operation: "set" | "append" | "remove";
  value?: string;
}
export interface DnrRule {
  id: number;
  priority: number;
  condition: {
    tabIds: number[];
    requestDomains?: string[];
    regexFilter?: string;
    urlFilter?: string;
    resourceTypes?: string[];
    excludedResourceTypes?: string[];
    domainType?: "firstParty" | "thirdParty";
  };
  action: {
    type: "modifyHeaders";
    requestHeaders?: DnrHeaderOp[];
    responseHeaders?: DnrHeaderOp[];
  };
}

export const ALL_RESOURCE_TYPES = [
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "csp_report",
  "media",
  "websocket",
  "webtransport",
  "webbundle",
  "other",
];
export const NAV_TYPES = ["main_frame", "sub_frame"];
export const CACHE_TYPES = ["main_frame", "sub_frame", "xmlhttprequest"];

export const PRIORITY_BASE = 1000;
export const PRIORITY_INJECT = 3000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Scheme = "https" | "http" | null;

export function hostRegex(host: string, scheme: Scheme = null): string {
  const s = scheme ?? "https?";
  return `^${s}://${escapeRegex(host)}(?::\\d+)?(?:/|$)`;
}

function matcher(a: Assignment, target: string, scheme: Scheme): Partial<DnrRule["condition"]> {
  if (a.scope === "host") return { regexFilter: hostRegex(a.siteKey, scheme) };
  const cond: Partial<DnrRule["condition"]> = { requestDomains: [target] };
  if (scheme) cond.urlFilter = `|${scheme}:`;
  return cond;
}

export interface RuleGenInput {
  tabId: number;
  assignment: Assignment;
  jar: StoredCookie[];
  now?: number;
  nextId: () => number;
}

/** 会话罐 → 该 tab 的完整 DNR 规则集合（纯函数） */
export function generateRules(input: RuleGenInput): DnrRule[] {
  const { tabId, assignment: a, jar, nextId } = input;
  const now = input.now ?? Date.now();
  const tabIds = [tabId];
  const rules: DnrRule[] = [];

  // (a) 基础规则：剥 Cookie，删 Set-Cookie / Clear-Site-Data
  rules.push({
    id: nextId(),
    priority: PRIORITY_BASE,
    condition: { tabIds, resourceTypes: ALL_RESOURCE_TYPES, ...matcher(a, a.siteKey, null) },
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Cookie", operation: "remove" }],
      responseHeaders: [
        { header: "Set-Cookie", operation: "remove" },
        { header: "Clear-Site-Data", operation: "remove" },
      ],
    },
  });

  // (b) 缓存规则：导航和 XHR 强制回源校验
  rules.push({
    id: nextId(),
    priority: PRIORITY_BASE,
    condition: { tabIds, resourceTypes: CACHE_TYPES, ...matcher(a, a.siteKey, null) },
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Cache-Control", operation: "set", value: "no-cache" }],
    },
  });

  // (a2) 信号规则：任何范围内导航都带 sid（罐子为空时也要能装补丁）；target 规则再追加带 cookie 的信号，页面取最全的那条
  const baseSignal = encodeSignalHeader({ sid: a.sessionId, cookies: [] });
  if (baseSignal) {
    rules.push({
      id: nextId(),
      priority: PRIORITY_BASE,
      condition: { tabIds, resourceTypes: NAV_TYPES, ...matcher(a, a.siteKey, null) },
      action: {
        type: "modifyHeaders",
        responseHeaders: [{ header: "Server-Timing", operation: "append", value: baseSignal }],
      },
    });
  }

  // (c) 注入规则：按 target 枚举
  const targets = a.scope === "host" ? [a.siteKey] : [...new Set(jar.map((c) => c.domain))].sort();

  for (const target of targets) {
    const priority = PRIORITY_INJECT + target.split(".").length;
    const https = cookiesForHost(jar, target, { secureContext: true, includeHttpOnly: true, now });
    const http = cookiesForHost(jar, target, { secureContext: false, includeHttpOnly: true, now });
    if (https.length === 0 && http.length === 0) continue;

    const variants: Array<{ scheme: Scheme; cookies: StoredCookie[] }> = [];
    if (http.length === https.length && http.length > 0) {
      // 没有 secure cookie：两个协议的集合相同，合成一条
      variants.push({ scheme: null, cookies: https });
    } else {
      if (https.length) variants.push({ scheme: "https", cookies: https });
      if (http.length) variants.push({ scheme: "http", cookies: http });
    }

    for (const v of variants) {
      const header = serializeCookieHeader(v.cookies);
      const visible = v.cookies.filter((c) => !c.httpOnly).map(toPageCookie);
      const signal = encodeSignalHeader({ sid: a.sessionId, cookies: visible });
      const base = { tabIds, ...matcher(a, target, v.scheme) };

      rules.push({
        id: nextId(),
        priority,
        condition: { ...base, resourceTypes: NAV_TYPES },
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Cookie", operation: "set", value: header }],
          ...(signal
            ? { responseHeaders: [{ header: "Server-Timing", operation: "append", value: signal }] }
            : {}),
        },
      });
      rules.push({
        id: nextId(),
        priority,
        condition: { ...base, excludedResourceTypes: NAV_TYPES, domainType: "firstParty" },
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Cookie", operation: "set", value: header }],
        },
      });
    }
  }
  return rules;
}
