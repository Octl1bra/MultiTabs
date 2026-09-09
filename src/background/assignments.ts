import type { Assignment } from "@/src/lib/types";
import { session, withLock } from "./store";

export const tabKey = (tabId: number) => `tab:${tabId}`;
export const pendingKey = (tabId: number) => `pending:${tabId}`;
export const rulesKey = (tabId: number) => `rules:${tabId}`;

export function withTabLock<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  return withLock(`tablock:${tabId}`, fn);
}

export async function getAssignment(tabId: number): Promise<Assignment | null> {
  return (await session.get<Assignment>(tabKey(tabId))) ?? null;
}

export async function getPending(tabId: number): Promise<Assignment | null> {
  return (await session.get<Assignment>(pendingKey(tabId))) ?? null;
}

/** 正式挂载或 pending，二者取其一 */
export async function getEffective(
  tabId: number,
): Promise<{ a: Assignment; pending: boolean } | null> {
  const a = await getAssignment(tabId);
  if (a) return { a, pending: false };
  const p = await getPending(tabId);
  return p ? { a: p, pending: true } : null;
}

export async function setAssignment(tabId: number, a: Assignment): Promise<void> {
  await session.set({ [tabKey(tabId)]: a });
  await session.remove(pendingKey(tabId));
}

export async function setPending(tabId: number, a: Assignment): Promise<void> {
  await session.set({ [pendingKey(tabId)]: a });
}

export async function clearPending(tabId: number): Promise<void> {
  await session.remove(pendingKey(tabId));
}

export async function clearAssignment(tabId: number): Promise<void> {
  await session.remove([tabKey(tabId), pendingKey(tabId)]);
}

export async function tabsForSession(
  sessionId: string,
): Promise<{ assigned: number[]; pending: number[] }> {
  const all = await session.getAll();
  const assigned: number[] = [];
  const pending: number[] = [];
  for (const [k, v] of Object.entries(all)) {
    const a = v as Assignment | undefined;
    if (!a || a.sessionId !== sessionId) continue;
    if (k.startsWith("tab:")) assigned.push(Number(k.slice(4)));
    else if (k.startsWith("pending:")) pending.push(Number(k.slice(8)));
  }
  return { assigned, pending };
}

export async function allAssignedTabs(): Promise<Record<string, number[]>> {
  const all = await session.getAll();
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith("tab:")) continue;
    const a = v as Assignment;
    (out[a.sessionId] ??= []).push(Number(k.slice(4)));
  }
  return out;
}
