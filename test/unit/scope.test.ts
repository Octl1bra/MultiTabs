import { isInScope, siteKeyFor } from "@/src/lib/scope";

const site = { siteKey: "example.com", scope: "site" as const };
const host = { siteKey: "www.example.com", scope: "host" as const };

describe("isInScope", () => {
  it("site 作用域含子域、端口、大小写", () => {
    expect(isInScope(site, new URL("https://example.com/"))).toBe(true);
    expect(isInScope(site, new URL("https://API.Example.com:8443/x"))).toBe(true);
    expect(isInScope(site, new URL("https://a.b.example.com/"))).toBe(true);
    expect(isInScope(site, new URL("https://notexample.com/"))).toBe(false);
    expect(isInScope(site, new URL("https://example.com.evil.com/"))).toBe(false);
  });
  it("host 作用域只认精确主机", () => {
    expect(isInScope(host, new URL("https://www.example.com/"))).toBe(true);
    expect(isInScope(host, new URL("http://WWW.example.com:8080/"))).toBe(true);
    expect(isInScope(host, new URL("https://api.example.com/"))).toBe(false);
    expect(isInScope(host, new URL("https://example.com/"))).toBe(false);
  });
  it("非 http 协议一律不在范围内", () => {
    expect(isInScope(site, new URL("chrome://extensions"))).toBe(false);
    expect(isInScope(site, new URL("ftp://example.com/"))).toBe(false);
    expect(isInScope(site, new URL("blob:https://example.com/abc"))).toBe(false);
  });
});

describe("siteKeyFor", () => {
  const u = new URL("https://www.bonjour.com.cn/x");
  it("host 作用域返回主机名", () => expect(siteKeyFor(u, "host")).toBe("www.bonjour.com.cn"));
  it("优先用 Chrome 的 topLevelSite", () => {
    expect(siteKeyFor(u, "site", "https://bonjour.com.cn")).toBe("bonjour.com.cn");
    expect(
      siteKeyFor(new URL("https://app.localtest.me:8443/"), "site", "https://localtest.me"),
    ).toBe("localtest.me");
  });
  it("topLevelSite 缺失或非法时回退后缀表", () => {
    expect(siteKeyFor(u, "site", null)).toBe("bonjour.com.cn");
    expect(siteKeyFor(u, "site", "not a url")).toBe("bonjour.com.cn");
  });
});
