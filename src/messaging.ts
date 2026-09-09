import type { Assignment, PageCookie, Scope, Session } from "./lib/types";

export interface SessionSummary extends Session {
  cookieCount: number;
  tabCount: number;
}

export interface PopupState {
  tab: { id: number; url: string | null; host: string | null; isHttp: boolean };
  /** 当前 tab 在两种作用域下算出的 siteKey；非 http 页面为 null */
  siteKeys: { site: string; host: string } | null;
  assignment: (Assignment & { session: Session | null; inScope: boolean }) | null;
  /** 当前主机落在其范围内的会话 */
  sessions: SessionSummary[];
}

export interface Api {
  getPopupState: { req: { tabId: number }; res: PopupState };
  createSession: {
    req: { tabId: number; name: string; scope: Scope; action: "newTab" | "here" | "none" };
    res: { session: Session; tabId: number | null };
  };
  openInNewTab: { req: { sessionId: string; url: string }; res: { tabId: number } };
  useHere: { req: { sessionId: string; tabId: number }; res: Record<string, never> };
  leave: { req: { tabId: number }; res: Record<string, never> };
  deleteSession: { req: { sessionId: string }; res: Record<string, never> };
  renameSession: {
    req: { sessionId: string; name?: string; color?: string };
    res: { session: Session };
  };
  clearJar: { req: { sessionId: string }; res: Record<string, never> };
  listAllSessions: { req: Record<string, never>; res: { sessions: SessionSummary[] } };
  purgeExpired: { req: Record<string, never>; res: { removed: number } };
}
export type ApiName = keyof Api;

export interface ApiRequest<K extends ApiName = ApiName> {
  type: K;
  payload: Api[K]["req"];
}
export type ApiResponse<K extends ApiName> =
  { ok: true; data: Api[K]["res"] } | { ok: false; error: string };

export async function call<K extends ApiName>(
  type: K,
  payload: Api[K]["req"],
): Promise<Api[K]["res"]> {
  const res = (await chrome.runtime.sendMessage({ type, payload } satisfies ApiRequest<K>)) as
    ApiResponse<K> | undefined;
  if (!res) throw new Error("background 没有响应");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/* ---------- 页面 ↔ bridge ↔ background ---------- */

/** main world → bridge（window.postMessage） */
export type PageToExt = { __mt: "page"; type: "setCookie"; header: string };
/** bridge → main world（window.postMessage） */
export type ExtToPage =
  | { __mt: "ext"; type: "cookiesUpdated"; cookies: PageCookie[] }
  | { __mt: "ext"; type: "clearStorage" };

/** bridge → background（runtime.sendMessage） */
export const BRIDGE_MSG = "mt:page" as const;
export interface BridgeMessage {
  type: typeof BRIDGE_MSG;
  inner: PageToExt;
}
/** background → bridge（tabs.sendMessage） */
export const TO_PAGE_MSG = "mt:toPage" as const;
export interface ToPageMessage {
  type: typeof TO_PAGE_MSG;
  inner: ExtToPage;
}
