/**
 * UI and background strings. English is the primary language; Chinese is shown when the browser
 * UI language is zh-*. Plural forms: "one|other" split on "|" and picked by vars.n.
 * Usage: t("cookies", { n: 3 }) → "3 cookies"
 */

export const en = {
  appName: "MultiTabs",
  loading: "Loading…",
  retry: "Retry",
  cancel: "Cancel",
  save: "Save",
  noTab: "Couldn't find the current tab",

  /* popup */
  notHttp: "This page isn't a website (http/https), so MultiTabs can't be used here.",
  currentTab: "This tab",
  leave: "Leave",
  outOfScope: "The current page is outside this session's site",
  sessionDeleted: "Session deleted",
  newSession: "New session",
  newSessionDesc: "A separate login, fully isolated from your other tabs.",
  namePlaceholder: "Session name",
  newTab: "New tab",
  hostOnly: "Isolate this hostname only",
  useHere: "Use in this tab",
  savedSessions: "Saved sessions",
  cookies: "{n} cookie|{n} cookies",
  open: "Open",
  here: "Here",
  emptySessions: "No sessions for this site yet",
  emptySessionsHint: "Type a name above to create the first isolated session.",
  manage: "Manage sessions…",
  scopeSite: "Site",
  scopeHost: "Host",
  scopeSiteTitle: "Isolates the whole site, including subdomains",
  scopeHostTitle: "Isolates this hostname only",

  /* options */
  optionsTitle: "MultiTabs",
  optionsDesc: "Manage isolated sessions, their cookie jars, and the keyboard shortcut.",
  colSession: "Session",
  colScope: "Scope",
  colActions: "Actions",
  about: "About",
  tabSessions: "Sessions",
  tabSettings: "Settings",
  sessionsCount: "{n} session|{n} sessions",
  tabsCount: "{n} tab|{n} tabs",
  lastUsed: "Last used",
  rename: "Rename",
  clearJar: "Clear cookies",
  delete: "Delete",
  deleteTitle: "Delete session “{name}”?",
  deleteBody:
    "Its cookie jar will be erased, and the {n} tab attached to it will return to the browser's default session. This can't be undone.|Its cookie jar will be erased, and the {n} tabs attached to it will return to the browser's default session. This can't be undone.",
  clearTitle: "Clear cookies for “{name}”?",
  clearBody:
    "The {n} cookie in this session will be removed and its tabs will be signed out. The session itself stays.|All {n} cookies in this session will be removed and its tabs will be signed out. The session itself stays.",
  emptyAll: "No sessions yet",
  emptyAllHint: "Click the toolbar icon on any website to create one.",
  shortcut: "Keyboard shortcut",
  shortcutDesc: "Create a session for the current site and open it in a new tab",
  shortcutHint: "You can change it on Chrome's extension shortcuts page.",
  openShortcuts: "Open shortcut settings",
  maintenance: "Maintenance",
  purge: "Remove expired cookies",
  purgeDesc: "Deletes cookies that have already expired from every session.",
  purgeResult: "Removed {n} expired cookie.|Removed {n} expired cookies.",
  version: "Version",

  /* relative time */
  justNow: "just now",
  minutesAgo: "{n} min ago",
  hoursAgo: "{n} hour ago|{n} hours ago",
  daysAgo: "{n} day ago|{n} days ago",

  /* background: errors shown in the UI, badge, auto names */
  errNotHttp: "This page isn't http/https",
  errNoSession: "Session not found",
  errNameEmpty: "Session name can't be empty",
  errNameTooLong: "Session name can't be longer than {n} characters",
  errNameTaken: "“{name}” already exists for {site}",
  autoName: "Session {n}",
  badgePending: "(pending)",
  badgeOutOfScope: "(current page is outside the site)",
} as const;

export type I18nKey = keyof typeof en;

export const zh: Record<I18nKey, string> = {
  appName: "MultiTabs",
  loading: "加载中…",
  retry: "重试",
  cancel: "取消",
  save: "保存",
  noTab: "无法获取当前标签页",

  notHttp: "当前页面不是网页（http/https），MultiTabs 在这里不可用。",
  currentTab: "当前 tab",
  leave: "退出",
  outOfScope: "当前页面不在范围内",
  sessionDeleted: "会话已删除",
  newSession: "新建会话",
  newSessionDesc: "登录状态与其它 tab 完全隔离，互不干扰。",
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

  optionsTitle: "MultiTabs 管理",
  optionsDesc: "管理各站点的隔离会话、cookie 罐与快捷键。",
  colSession: "会话",
  colScope: "作用域",
  colActions: "操作",
  about: "关于",
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

  justNow: "刚刚",
  minutesAgo: "{n} 分钟前",
  hoursAgo: "{n} 小时前",
  daysAgo: "{n} 天前",

  errNotHttp: "当前页面不是 http/https",
  errNoSession: "会话不存在",
  errNameEmpty: "会话名不能为空",
  errNameTooLong: "会话名不能超过 {n} 个字符",
  errNameTaken: "“{name}” 在 {site} 下已存在",
  autoName: "会话 {n}",
  badgePending: "（待挂载）",
  badgeOutOfScope: "（当前页面不在范围内）",
};

export type Locale = "en" | "zh";
const dicts: Record<Locale, Record<I18nKey, string>> = { en, zh };

/** zh-* → zh, everything else → en */
export function localeFromLanguage(lang: string | undefined | null): Locale {
  return lang && /^zh\b/i.test(lang) ? "zh" : "en";
}

export function detectLocale(): Locale {
  try {
    const ui = (
      globalThis as { chrome?: { i18n?: { getUILanguage?: () => string } } }
    ).chrome?.i18n?.getUILanguage?.();
    if (ui) return localeFromLanguage(ui);
  } catch {
    /* not an extension context */
  }
  try {
    return localeFromLanguage(
      (globalThis as { navigator?: { language?: string } }).navigator?.language,
    );
  } catch {
    return "en";
  }
}

let locale: Locale = detectLocale();

export function setLocale(l: Locale): void {
  locale = l;
}

export function getLocale(): Locale {
  return locale;
}

export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let raw = dicts[locale][key] ?? en[key];
  if (raw.includes("|")) {
    const [one, other] = raw.split("|");
    raw = Number(vars?.n) === 1 ? one! : (other ?? one!);
  }
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
