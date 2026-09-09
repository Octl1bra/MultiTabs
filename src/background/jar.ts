import { cookieKey, domainMatches, isExpired, type ParsedSetCookie } from "@/src/lib/cookie";
import type { StoredCookie } from "@/src/lib/types";
import { local, withLock } from "./store";

const key = (sid: string) => `jar:${sid}`;

export async function getJar(sid: string): Promise<Record<string, StoredCookie>> {
  return (await local.get<Record<string, StoredCookie>>(key(sid))) ?? {};
}

export async function listJar(sid: string): Promise<StoredCookie[]> {
  return Object.values(await getJar(sid));
}

export async function countJar(sid: string): Promise<number> {
  const now = Date.now();
  return Object.values(await getJar(sid)).filter((c) => !isExpired(c, now)).length;
}

/** 应用一批 Set-Cookie 解析结果；返回是否有变化 */
export async function applyParsed(sid: string, parsed: ParsedSetCookie[]): Promise<boolean> {
  if (parsed.length === 0) return false;
  return withLock(key(sid), async () => {
    const jar = await getJar(sid);
    let changed = false;
    for (const p of parsed) {
      const k = cookieKey(p.cookie);
      if (p.isDeletion) {
        if (k in jar) {
          delete jar[k];
          changed = true;
        }
        continue;
      }
      const prev = jar[k];
      jar[k] = { ...p.cookie, createdAt: prev?.createdAt ?? p.cookie.createdAt };
      changed = true;
    }
    if (changed) await local.set({ [key(sid)]: jar });
    return changed;
  });
}

/** 清空会话罐；给了 host 只清 domain-match 该主机的 cookie */
export async function clearJar(sid: string, host?: string): Promise<boolean> {
  return withLock(key(sid), async () => {
    const jar = await getJar(sid);
    const keys = Object.keys(jar);
    if (keys.length === 0) return false;
    if (!host) {
      await local.set({ [key(sid)]: {} });
      return true;
    }
    let changed = false;
    for (const k of keys) {
      const c = jar[k]!;
      if (domainMatches(host, c.domain, c.hostOnly)) {
        delete jar[k];
        changed = true;
      }
    }
    if (changed) await local.set({ [key(sid)]: jar });
    return changed;
  });
}

export async function deleteJar(sid: string): Promise<void> {
  await withLock(key(sid), async () => {
    await local.remove(key(sid));
  });
}

export async function purgeExpired(sids?: string[]): Promise<number> {
  const ids =
    sids ??
    Object.keys(await local.getAll())
      .filter((k) => k.startsWith("jar:"))
      .map((k) => k.slice(4));
  const now = Date.now();
  let removed = 0;
  for (const sid of ids) {
    await withLock(key(sid), async () => {
      const jar = await getJar(sid);
      let changed = false;
      for (const k of Object.keys(jar)) {
        if (isExpired(jar[k]!, now)) {
          delete jar[k];
          removed++;
          changed = true;
        }
      }
      if (changed) await local.set({ [key(sid)]: jar });
    });
  }
  return removed;
}
