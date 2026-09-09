import { Chip } from "@heroui/react";
import type { Scope } from "@/src/lib/types";
import { t } from "./i18n";

interface Props {
  scope: Scope;
  className?: string;
}

/** 作用域 Chip：site = 默认灰，host = accent，提示用 title 而不是 Tooltip（popup 里禁浮层） */
export function ScopeBadge({ scope, className }: Props) {
  const isHost = scope === "host";
  return (
    <Chip
      size="sm"
      variant="soft"
      color={isHost ? "accent" : "default"}
      className={className}
      title={isHost ? t("scopeHostTitle") : t("scopeSiteTitle")}
    >
      {isHost ? t("scopeHost") : t("scopeSite")}
    </Chip>
  );
}
