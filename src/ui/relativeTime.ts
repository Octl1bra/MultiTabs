import { getLocale, t } from "./i18n";

/** "3 min ago" style; past 30 days it's just the date */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("daysAgo", { n: days });
  return new Date(ts).toLocaleDateString(getLocale() === "zh" ? "zh-CN" : "en-US");
}
