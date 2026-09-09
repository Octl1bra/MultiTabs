import { generateRules } from "@/src/lib/rulegen";
import { getEffective, rulesKey, tabsForSession, withTabLock } from "./assignments";
import { listJar } from "./jar";
import { markRulesReady } from "./lifecycle";
import { log, session, withLock } from "./store";

const SEQ_KEY = "ruleSeq";

async function allocIds(n: number): Promise<number[]> {
  if (n === 0) return [];
  return withLock(SEQ_KEY, async () => {
    const seq = (await session.get<number>(SEQ_KEY)) ?? 0;
    const ids: number[] = [];
    for (let i = 1; i <= n; i++) ids.push(seq + i);
    await session.set({ [SEQ_KEY]: seq + n });
    return ids;
  });
}

/** 幂等：先删该 tab 旧规则再加新规则，一次 updateSessionRules 完成 */
export async function applyRules(tabId: number): Promise<void> {
  await withTabLock(tabId, async () => {
    const old = (await session.get<number[]>(rulesKey(tabId))) ?? [];
    const eff = await getEffective(tabId);
    if (!eff) {
      if (old.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old });
      await session.remove(rulesKey(tabId));
      return;
    }
    const jar = await listJar(eff.a.sessionId);
    let tmp = 0;
    const rules = generateRules({ tabId, assignment: eff.a, jar, nextId: () => ++tmp });
    const ids = await allocIds(rules.length);
    rules.forEach((r, i) => (r.id = ids[i]!));
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: old,
        addRules: rules as unknown as chrome.declarativeNetRequest.Rule[],
      });
    } catch (err) {
      log("updateSessionRules failed", err, rules);
      throw err;
    }
    await session.set({ [rulesKey(tabId)]: ids });
    markRulesReady(tabId);
  });
}

export async function removeRules(tabId: number): Promise<void> {
  await withTabLock(tabId, async () => {
    const old = (await session.get<number[]>(rulesKey(tabId))) ?? [];
    if (old.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old });
    await session.remove(rulesKey(tabId));
  });
}

export async function refreshSession(sessionId: string): Promise<void> {
  const { assigned, pending } = await tabsForSession(sessionId);
  await Promise.all(
    [...assigned, ...pending].map((t) => applyRules(t).catch((e) => log("applyRules", t, e))),
  );
}
