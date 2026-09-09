import {
  cookieKey,
  cookiesForHost,
  defaultPath,
  domainMatches,
  isExpired,
  parseClearSiteData,
  parseSetCookie,
  serializeCookieHeader,
} from "@/src/lib/cookie";
import { SESSION_COOKIE_TTL_MS, type StoredCookie } from "@/src/lib/types";

const url = new URL("https://app.localtest.me:8443/a/b/c?x=1");
const NOW = 1_700_000_000_000;

describe("parseSetCookie", () => {
  it("基本属性与缺省 path", () => {
    const p = parseSetCookie("sid=A; Path=/; Secure; HttpOnly; SameSite=Lax", url, NOW)!;
    expect(p.isDeletion).toBe(false);
    expect(p.cookie).toMatchObject({
      name: "sid",
      value: "A",
      domain: "app.localtest.me",
      hostOnly: true,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      expires: null,
    });
    const q = parseSetCookie("x=1", url, NOW)!;
    expect(q.cookie.path).toBe("/a/b");
  });
  it("Domain 去前导点、小写、hostOnly=false", () => {
    const p = parseSetCookie("who=A; Domain=.LocalTest.me; Path=/", url, NOW)!;
    expect(p.cookie.domain).toBe("localtest.me");
    expect(p.cookie.hostOnly).toBe(false);
  });
  it("非法 Domain 拒绝：不相干域、高于 eTLD+1", () => {
    expect(parseSetCookie("a=1; Domain=evil.com", url, NOW)).toBeNull();
    expect(parseSetCookie("a=1; Domain=me", url, NOW)).toBeNull();
    expect(parseSetCookie("a=1; Domain=com", new URL("https://www.example.com/"), NOW)).toBeNull();
    expect(parseSetCookie("a=1; Domain=sub.app.localtest.me", url, NOW)).toBeNull();
  });
  it("Max-Age 优先于 Expires；<=0 为删除", () => {
    const p = parseSetCookie("a=1; Max-Age=60; Expires=Wed, 21 Oct 2015 07:28:00 GMT", url, NOW)!;
    expect(p.cookie.expires).toBe(NOW + 60_000);
    expect(parseSetCookie("a=1; Max-Age=0", url, NOW)!.isDeletion).toBe(true);
    expect(parseSetCookie("a=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT", url, NOW)!.isDeletion).toBe(
      true,
    );
    expect(parseSetCookie("a=1; Expires=Wed, 21 Oct 2099 07:28:00 GMT", url, NOW)!.isDeletion).toBe(
      false,
    );
  });
  it("__Host- / __Secure- 前缀", () => {
    expect(parseSetCookie("__Host-a=1; Secure; Path=/", url, NOW)).not.toBeNull();
    expect(parseSetCookie("__Host-a=1; Path=/", url, NOW)).toBeNull();
    expect(parseSetCookie("__Host-a=1; Secure; Path=/x", url, NOW)).toBeNull();
    expect(parseSetCookie("__Host-a=1; Secure; Domain=localtest.me", url, NOW)).toBeNull();
    expect(parseSetCookie("__Secure-a=1", url, NOW)).toBeNull();
  });
  it("空串与非法名", () => {
    expect(parseSetCookie("", url, NOW)).toBeNull();
    expect(parseSetCookie("=", url, NOW)).toBeNull();
    expect(parseSetCookie("a b=1", url, NOW)).toBeNull();
    expect(parseSetCookie("justvalue", url, NOW)!.cookie).toMatchObject({
      name: "",
      value: "justvalue",
    });
  });
});

describe("domainMatches / cookieKey / defaultPath", () => {
  it("domain-match", () => {
    expect(domainMatches("api.example.com", "example.com", false)).toBe(true);
    expect(domainMatches("example.com", "example.com", false)).toBe(true);
    expect(domainMatches("api.example.com", "example.com", true)).toBe(false);
    expect(domainMatches("notexample.com", "example.com", false)).toBe(false);
  });
  it("key", () => expect(cookieKey({ domain: "a", path: "/", name: "n" })).toBe("a|/|n"));
  it("default-path", () => {
    expect(defaultPath("/")).toBe("/");
    expect(defaultPath("/a")).toBe("/");
    expect(defaultPath("/a/b")).toBe("/a");
    expect(defaultPath("")).toBe("/");
    expect(defaultPath("x")).toBe("/");
  });
});

function mk(over: Partial<StoredCookie>): StoredCookie {
  return {
    name: "n",
    value: "v",
    domain: "example.com",
    hostOnly: false,
    path: "/",
    secure: false,
    httpOnly: false,
    sameSite: "unspecified",
    expires: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe("serializeCookieHeader", () => {
  it("path 长的在前，其次创建早的在前", () => {
    const h = serializeCookieHeader([
      mk({ name: "b", path: "/", createdAt: 2 }),
      mk({ name: "a", path: "/", createdAt: 1 }),
      mk({ name: "deep", path: "/x/y", createdAt: 9 }),
    ]);
    expect(h).toBe("deep=v; a=v; b=v");
  });
});

describe("cookiesForHost / isExpired", () => {
  const jar = [
    mk({ name: "dom", domain: "example.com" }),
    mk({ name: "host", domain: "www.example.com", hostOnly: true }),
    mk({ name: "sec", secure: true }),
    mk({ name: "http", httpOnly: true }),
    mk({ name: "dead", expires: NOW - 1 }),
    mk({ name: "stale", updatedAt: NOW - SESSION_COOKIE_TTL_MS - 1 }),
  ];
  const names = (l: StoredCookie[]) => l.map((c) => c.name).sort();
  it("https + httpOnly", () => {
    expect(
      names(
        cookiesForHost(jar, "www.example.com", {
          secureContext: true,
          includeHttpOnly: true,
          now: NOW,
        }),
      ),
    ).toEqual(["dom", "host", "http", "sec"]);
  });
  it("http 排除 secure；页面排除 httpOnly；子域排除 hostOnly", () => {
    expect(
      names(
        cookiesForHost(jar, "api.example.com", {
          secureContext: false,
          includeHttpOnly: false,
          now: NOW,
        }),
      ),
    ).toEqual(["dom"]);
  });
  it("isExpired", () => {
    expect(isExpired(mk({ expires: NOW - 1 }), NOW)).toBe(true);
    expect(isExpired(mk({ expires: NOW + 1 }), NOW)).toBe(false);
    expect(isExpired(mk({}), NOW)).toBe(false);
    expect(isExpired(mk({ updatedAt: NOW - SESSION_COOKIE_TTL_MS - 1 }), NOW)).toBe(true);
  });
});

describe("parseClearSiteData", () => {
  it("去引号小写", () => {
    expect([...parseClearSiteData('"cookies", "Storage"')]).toEqual(["cookies", "storage"]);
    expect(parseClearSiteData('"*"').has("*")).toBe(true);
  });
});
