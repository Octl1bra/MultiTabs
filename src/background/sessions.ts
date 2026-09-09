import { t } from "@/src/lib/i18n";
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
  if (!n) throw new Error(t("errNameEmpty"));
  if ([...n].length > MAX_SESSION_NAME)
    throw new Error(t("errNameTooLong", { n: MAX_SESSION_NAME }));
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
      throw new Error(t("errNameTaken", { name, site: input.siteKey }));
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

/** For the keyboard shortcut: auto-name "Session N" */
export async function nextAutoName(siteKey: string): Promise<string> {
  const all = await getSessions();
  const used = new Set(
    Object.values(all)
      .filter((s) => s.siteKey === siteKey)
      .map((s) => s.name),
  );
  for (let i = 1; ; i++) {
    const n = t("autoName", { n: i });
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
    if (!s) throw new Error(t("errNoSession"));
    if (patch.name !== undefined) {
      const name = validateName(patch.name);
      if (
        Object.values(all).some((o) => o.id !== id && o.siteKey === s.siteKey && o.name === name)
      ) {
        throw new Error(t("errNameTaken", { name, site: s.siteKey }));
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
