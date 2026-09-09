import { etld1, isIp, listSuffixes } from "@/src/lib/etld";

describe("etld1", () => {
  it("普通两段域名", () => {
    expect(etld1("www.example.com")).toBe("example.com");
    expect(etld1("example.com")).toBe("example.com");
    expect(etld1("a.b.c.example.org")).toBe("example.org");
  });
  it("表中每个后缀各一例", () => {
    for (const suf of listSuffixes()) {
      expect(etld1(`www.foo.${suf}`)).toBe(`foo.${suf}`);
      expect(etld1(`foo.${suf}`)).toBe(`foo.${suf}`);
    }
  });
  it("后缀本身原样返回", () => {
    expect(etld1("github.io")).toBe("github.io");
    expect(etld1("com.cn")).toBe("com.cn");
  });
  it("IP / localhost / 单段", () => {
    expect(etld1("127.0.0.1")).toBe("127.0.0.1");
    expect(etld1("[::1]")).toBe("[::1]");
    expect(etld1("localhost")).toBe("localhost");
    expect(etld1("intranet")).toBe("intranet");
  });
  it("大小写与尾点", () => {
    expect(etld1("WWW.Example.COM.")).toBe("example.com");
  });
});

describe("isIp", () => {
  it.each(["1.2.3.4", "[::1]", "[2001:db8::1]", "::1"])("%s 是 IP", (h) =>
    expect(isIp(h)).toBe(true),
  );
  it.each(["example.com", "localhost", "1.2.3", "a.b.c.d"])("%s 不是 IP", (h) =>
    expect(isIp(h)).toBe(false),
  );
});
