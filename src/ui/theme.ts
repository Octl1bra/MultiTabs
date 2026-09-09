import { PALETTE } from "@/src/lib/types";

export { PALETTE };
export const BADGE_GRAY = "#9ca3af";

/** 跟随系统深色模式：给 <html> 加/去 dark 类 */
export function applySystemTheme(): void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    document.documentElement.classList.toggle("dark", mq.matches);
    document.documentElement.dataset.theme = mq.matches ? "dark" : "light";
  };
  apply();
  mq.addEventListener("change", apply);
}
