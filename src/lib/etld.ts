/**
 * eTLD+1 的回退实现。主路径是 chrome.cookies.getPartitionKey（Chrome 自带 PSL），
 * 这里只覆盖常见的两段公共后缀；其余取最后两段。
 */
const MULTI_PART_SUFFIXES = new Set([
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "edu.cn",
  "ac.cn",
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "co.jp",
  "ne.jp",
  "or.jp",
  "com.hk",
  "com.tw",
  "com.au",
  "com.br",
  "com.sg",
  "com.my",
  "co.kr",
  "co.in",
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "herokuapp.com",
  "web.app",
  "firebaseapp.com",
]);

export function listSuffixes(): string[] {
  return [...MULTI_PART_SUFFIXES];
}

const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isIp(host: string): boolean {
  if (host.startsWith("[") && host.endsWith("]")) return true; // URL.hostname 里的 IPv6
  if (host.includes(":")) return true; // 裸 IPv6
  return IPV4.test(host);
}

export function etld1(hostInput: string): string {
  const host = hostInput.toLowerCase().replace(/\.$/, "");
  if (isIp(host) || host === "localhost" || !host.includes(".")) return host;
  const parts = host.split(".");
  if (parts.length > 2 && MULTI_PART_SUFFIXES.has(parts.slice(-2).join("."))) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}
