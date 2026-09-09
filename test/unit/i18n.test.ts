import { localeFromLanguage, setLocale, t } from "@/src/lib/i18n";

describe("i18n", () => {
  it("zh-* 归中文，其余英文", () => {
    expect(localeFromLanguage("zh-CN")).toBe("zh");
    expect(localeFromLanguage("zh-TW")).toBe("zh");
    expect(localeFromLanguage("en-US")).toBe("en");
    expect(localeFromLanguage("ja")).toBe("en");
    expect(localeFromLanguage(undefined)).toBe("en");
  });
  it("英文单复数按 n 选", () => {
    setLocale("en");
    expect(t("cookies", { n: 1 })).toBe("1 cookie");
    expect(t("cookies", { n: 3 })).toBe("3 cookies");
    expect(t("autoName", { n: 2 })).toBe("Session 2");
    expect(t("errNameTaken", { name: "QA", site: "example.com" })).toBe("“QA” already exists for example.com");
  });
  it("中文不分单复数", () => {
    setLocale("zh");
    expect(t("cookies", { n: 1 })).toBe("1 cookies");
    expect(t("autoName", { n: 2 })).toBe("会话 2");
    setLocale("en");
  });
});
