import { t } from "./i18n";

/** "3 分钟前" 这种；超过 30 天直接给日期 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t("justNow");
  if (minutes < 60) return t("minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("daysAgo", { n: days });
  return new Date(ts).toLocaleDateString("zh-CN");
}
