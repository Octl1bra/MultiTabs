import { newId } from "@/src/lib/ids";
import { hostInScope } from "@/src/lib/scope";
import { MAX_SESSION_NAME, PALETTE, type Scope, type Session } from "@/src/lib/types";
import { local, withLock } from "./store";

const KEY = "sessions";

export async function getSessions(): Promise<Record<string, Session>> {
  return (await local.get<Record<string, Session>>(KEY)) ?? {};
}

export async function getSession(id: string): Promise<Session | null> {
  return (await getSessions())[id] ?? null;
}

export function sessionsForHost(all: Record<string, Session>, host: string): Session[] {
  return Object.values(all)
    .filter((s) => hostInScope(s, host))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function validateName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error("会话名不能为空");
  if ([...n].length > MAX_SESSION_NAME)
    throw new Error(`会话名不能超过 ${MAX_SESSION_NAME} 个字符`);
  return n;
}

export async function createSession(input: {
  name: string;
  siteKey: string;
  scope: Scope;
}): Promise<Session> {
  return withLock(KEY, async () => {
    const all = await getSessions();
    const name = validateName(input.name);
    const siblings = Object.values(all).filter((s) => s.siteKey === input.siteKey);
    if (siblings.some((s) => s.name === name))
      throw new Error(`"${name}" 在 ${input.siteKey} 下已存在`);
    const now = Date.now();
    const s: Session = {
      id: newId(),
      name,
      siteKey: input.siteKey,
      scope: input.scope,
      color: PALETTE[siblings.length % PALETTE.length]!,
      createdAt: now,
      lastUsedAt: now,
    };
    all[s.id] = s;
    await local.set({ [KEY]: all });
    return s;
  });
}

/** 快捷键用：自动起名"会话 N" */
export async function nextAutoName(siteKey: string): Promise<string> {
  const all = await getSessions();
  const used = new Set(
    Object.values(all)
      .filter((s) => s.siteKey === siteKey)
      .map((s) => s.name),
  );
  for (let i = 1; ; i++) {
    const n = `会话 ${i}`;
    if (!used.has(n)) return n;
  }
}

export async function updateSession(
  id: string,
  patch: Partial<Pick<Session, "name" | "color" | "lastUsedAt">>,
): Promise<Session> {
  return withLock(KEY, async () => {
    const all = await getSessions();
    const s = all[id];
    if (!s) throw new Error("会话不存在");
    if (patch.name !== undefined) {
      const name = validateName(patch.name);
      if (
        Object.values(all).some((o) => o.id !== id && o.siteKey === s.siteKey && o.name === name)
      ) {
        throw new Error(`"${name}" 在 ${s.siteKey} 下已存在`);
      }
      s.name = name;
    }
    if (patch.color !== undefined) s.color = patch.color;
    if (patch.lastUsedAt !== undefined) s.lastUsedAt = patch.lastUsedAt;
    await local.set({ [KEY]: all });
    return s;
  });
}

export async function touchSession(id: string): Promise<void> {
  await updateSession(id, { lastUsedAt: Date.now() }).catch(() => {});
}

export async function removeSessionRecord(id: string): Promise<void> {
  await withLock(KEY, async () => {
    const all = await getSessions();
    delete all[id];
    await local.set({ [KEY]: all });
  });
}
