/**
 * 文案集中在这里。先只有中文；英文位留着（P1），key 一致即可。
 * 用法：t("cookies", { n: 3 }) → "3 cookies"
 */

const zh = {
  appName: "MultiTabs",
  loading: "加载中…",
  retry: "重试",
  cancel: "取消",
  save: "保存",
  noTab: "无法获取当前标签页",

  /* popup */
  notHttp: "当前页面不是网页（http/https），MultiTabs 在这里不可用。",
  currentTab: "当前 tab",
  leave: "退出",
  outOfScope: "当前页面不在范围内",
  sessionDeleted: "会话已删除",
  newSession: "新建会话",
  namePlaceholder: "会话名称",
  newTab: "新 tab",
  hostOnly: "仅隔离当前主机名",
  useHere: "在当前 tab 使用",
  savedSessions: "已保存的会话",
  cookies: "{n} cookies",
  open: "打开",
  here: "此处",
  emptySessions: "这个站点还没有会话",
  emptySessionsHint: "在上面输入名称，新建第一个隔离会话。",
  manage: "管理会话…",
  scopeSite: "站点",
  scopeHost: "主机",
  scopeSiteTitle: "隔离整个站点（含子域名）",
  scopeHostTitle: "只隔离这个主机名",

  /* options */
  optionsTitle: "MultiTabs 管理",
  tabSessions: "会话",
  tabSettings: "设置",
  sessionsCount: "{n} 个会话",
  tabsCount: "{n} 个 tab",
  lastUsed: "最后使用",
  rename: "重命名",
  clearJar: "清空 cookie",
  delete: "删除",
  deleteTitle: "删除会话「{name}」？",
  deleteBody:
    "该会话的 cookie 罐会被整体清除；挂载在它上面的 {n} 个 tab 会退回主会话。此操作无法撤销。",
  clearTitle: "清空「{name}」的 cookie？",
  clearBody: "会清除该会话罐里的全部 {n} 条 cookie，相关 tab 会变成未登录状态。会话本身保留。",
  emptyAll: "还没有任何会话",
  emptyAllHint: "在网页上点击工具栏图标即可新建。",
  shortcut: "快捷键",
  shortcutDesc: "为当前站点新建会话并在新标签页打开",
  shortcutHint: "可以在 Chrome 的扩展快捷键页面修改。",
  openShortcuts: "打开快捷键设置",
  maintenance: "维护",
  purge: "清理所有过期 cookie",
  purgeDesc: "删除所有会话罐里已经过期的 cookie。",
  purgeResult: "已清理 {n} 条过期 cookie。",
  version: "版本",

  /* relative time */
  justNow: "刚刚",
  minutesAgo: "{n} 分钟前",
  hoursAgo: "{n} 小时前",
  daysAgo: "{n} 天前",
} as const;

export type I18nKey = keyof typeof zh;

/** 英文位（P1）：缺的 key 回落到中文 */
const en: Partial<Record<I18nKey, string>> = {};

const dicts = { zh, en } as const;
export type Locale = keyof typeof dicts;

let locale: Locale = "zh";
export function setLocale(l: Locale): void {
  locale = l;
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  const raw = (locale === "zh" ? undefined : dicts[locale][key]) ?? zh[key];
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
