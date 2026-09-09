import { generateRules, PRIORITY_BASE, PRIORITY_INJECT } from "@/src/lib/rulegen";
import type { Assignment, StoredCookie } from "@/src/lib/types";

const NOW = 1_700_000_000_000;
function mk(over: Partial<StoredCookie>): StoredCookie {
  return {
    name: "n",
    value: "v",
    domain: "localtest.me",
    hostOnly: false,
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "lax",
    expires: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}
const site: Assignment = { sessionId: "s1", siteKey: "localtest.me", scope: "site" };
const host: Assignment = { sessionId: "s1", siteKey: "app.localtest.me", scope: "host" };
const gen = (a: Assignment, jar: StoredCookie[]) => {
  let i = 0;
  return generateRules({ tabId: 7, assignment: a, jar, now: NOW, nextId: () => ++i });
};
/** 去掉 Server-Timing 的具体值，快照才稳定 */
const stable = (rules: ReturnType<typeof gen>) =>
  rules.map((r) => ({
    ...r,
    action: {
      ...r.action,
      responseHeaders: r.action.responseHeaders?.map((h) =>
        h.header === "Server-Timing" ? { ...h, value: "<signal>" } : h,
      ),
    },
  }));

describe("generateRules", () => {
  it("空罐只有基础规则、缓存规则和信号规则", () => {
    const rules = gen(site, []);
    expect(rules).toHaveLength(3);
    expect(rules[2]!.condition.resourceTypes).toEqual(["main_frame", "sub_frame"]);
    expect(rules[2]!.action.responseHeaders![0]!.header).toBe("Server-Timing");
    expect(rules[0]!.condition.tabIds).toEqual([7]);
    expect(rules[0]!.condition.requestDomains).toEqual(["localtest.me"]);
    expect(rules[0]!.condition.resourceTypes).toContain("main_frame");
    expect(rules[0]!.action.requestHeaders).toEqual([{ header: "Cookie", operation: "remove" }]);
    expect(rules[0]!.action.responseHeaders?.map((h) => h.header)).toEqual([
      "Set-Cookie",
      "Clear-Site-Data",
    ]);
    expect(rules[1]!.action.requestHeaders).toEqual([
      { header: "Cache-Control", operation: "set", value: "no-cache" },
    ]);
    expect(rules.every((r) => r.priority === PRIORITY_BASE)).toBe(true);
  });

  it("domain cookie + hostOnly cookie：两个 target，各两条，优先级按段数", () => {
    const jar = [
      mk({ name: "who", value: "A", domain: "localtest.me" }),
      mk({ name: "sid", value: "A", domain: "app.localtest.me", hostOnly: true, httpOnly: true }),
    ];
    const rules = gen(site, jar);
    expect(rules).toHaveLength(3 + 2 + 2);
    const inj = rules.slice(3);
    const byTarget = Object.groupBy(inj, (r) => r.condition.requestDomains![0]!);
    expect(Object.keys(byTarget).sort()).toEqual(["app.localtest.me", "localtest.me"]);
    expect(byTarget["localtest.me"]![0]!.priority).toBe(PRIORITY_INJECT + 2);
    expect(byTarget["app.localtest.me"]![0]!.priority).toBe(PRIORITY_INJECT + 3);
    // app 的 value 包含父域 cookie；localtest.me 的不含 hostOnly
    expect(byTarget["app.localtest.me"]![0]!.action.requestHeaders![0]!.value).toBe("who=A; sid=A");
    expect(byTarget["localtest.me"]![0]!.action.requestHeaders![0]!.value).toBe("who=A");
    // 导航规则带信号，非导航规则带 firstParty
    const nav = inj.filter((r) => r.condition.resourceTypes);
    const other = inj.filter((r) => r.condition.excludedResourceTypes);
    expect(nav.every((r) => r.action.responseHeaders?.[0]?.header === "Server-Timing")).toBe(true);
    expect(other.every((r) => r.condition.domainType === "firstParty")).toBe(true);
    // 全是 secure：只有 https 变体
    expect(inj.every((r) => r.condition.urlFilter === "|https:")).toBe(true);
    expect(stable(rules)).toMatchSnapshot();
  });

  it("含非 secure cookie 时拆 http/https 两组；全非 secure 时合成一组", () => {
    const mixed = gen(site, [mk({ name: "s", secure: true }), mk({ name: "p", secure: false })]);
    const inj = mixed.slice(3);
    expect(inj.map((r) => r.condition.urlFilter).sort()).toEqual([
      "|http:",
      "|http:",
      "|https:",
      "|https:",
    ]);
    const http = inj.filter((r) => r.condition.urlFilter === "|http:");
    expect(http.every((r) => r.action.requestHeaders![0]!.value === "p=v")).toBe(true);

    const plain = gen(site, [mk({ name: "p", secure: false })]);
    expect(plain.slice(3)).toHaveLength(2);
    expect(plain.slice(3).every((r) => r.condition.urlFilter === undefined)).toBe(true);
  });

  it("host 作用域：全部正则，只有一个 target，Domain cookie 也只注给该主机", () => {
    const rules = gen(host, [
      mk({ name: "who", domain: "localtest.me" }),
      mk({ name: "other", domain: "api.localtest.me", hostOnly: true }),
    ]);
    expect(rules.every((r) => r.condition.regexFilter && !r.condition.requestDomains)).toBe(true);
    const inj = rules.slice(3);
    expect(inj).toHaveLength(2);
    expect(inj[0]!.condition.regexFilter).toBe("^https://app\\.localtest\\.me(?::\\d+)?(?:/|$)");
    expect(inj[0]!.action.requestHeaders![0]!.value).toBe("who=v");
    expect(stable(rules)).toMatchSnapshot();
  });

  it("过期 cookie 不生成规则；信号只含非 HttpOnly", () => {
    const rules = gen(site, [mk({ name: "dead", expires: NOW - 1 })]);
    expect(rules).toHaveLength(3);
    const r2 = gen(site, [mk({ name: "h", httpOnly: true }), mk({ name: "v" })]);
    const sig = r2[3]!.action.responseHeaders![0]!.value!;
    const desc = /desc="([^"]+)"/.exec(sig)![1]!;
    const json = JSON.parse(
      Buffer.from(desc.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
    expect(json.cookies.map((c: { name: string }) => c.name)).toEqual(["v"]);
  });
});
