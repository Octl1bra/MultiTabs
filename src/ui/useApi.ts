import { useCallback, useEffect, useState } from "react";
import { t } from "./i18n";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 拉一次数据 + refresh。fetcher 请用 useCallback 包好，否则会反复请求。 */
export function useQuery<T>(fetcher: () => Promise<T>): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setData(await fetcher());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}

/**
 * 一组按钮共用的动作状态：同一时间只允许一个动作在跑，
 * pending 是正在跑的动作 key（"open:abc"），失败时 error 是 message。
 * run 成功返回结果，失败返回 undefined（错误已经进 state）。
 */
export function useAction(): {
  pending: string | null;
  error: string | null;
  run: <T>(key: string, fn: () => Promise<T>) => Promise<T | undefined>;
  clearError: () => void;
} {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setPending(key);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(null);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  return { pending, error, run, clearError };
}

/** popup 里的"当前 tab"。`popup.html?tabId=123` 可以指定，给截图和调试用（扩展页面才能打开，没有安全问题） */
export async function currentTabId(): Promise<number> {
  const forced = new URLSearchParams(location.search).get("tabId");
  if (forced && /^\d+$/.test(forced)) return Number(forced);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error(t("noTab"));
  return tab.id;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
