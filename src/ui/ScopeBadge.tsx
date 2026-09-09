import { Chip } from "@heroui/react";
import type { Scope } from "@/src/lib/types";
import { t } from "./i18n";

interface Props {
  scope: Scope;
  /** soft = 有底色（默认）；tertiary = 纯文字，跟在别的 Chip 后面当注脚 */
  variant?: "soft" | "tertiary";
  className?: string;
}

/** 作用域 Chip：site = default，host = accent。提示用 title 而不是 Tooltip（popup 里禁浮层） */
export function ScopeBadge({ scope, variant = "soft", className }: Props) {
  const isHost = scope === "host";
  return (
    <Chip
      size="sm"
      variant={variant}
      color={isHost ? "accent" : "default"}
      className={className}
      title={isHost ? t("scopeHostTitle") : t("scopeSiteTitle")}
    >
      {isHost ? t("scopeHost") : t("scopeSite")}
    </Chip>
  );
}
