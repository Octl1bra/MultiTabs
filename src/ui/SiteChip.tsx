import { Chip } from "@heroui/react";
import type { Scope } from "@/src/lib/types";
import { t } from "./i18n";

interface Props {
  siteKey: string;
  scope: Scope;
}

/** 当前 siteKey 的 Chip：颜色跟作用域走（site = default，host = accent），等宽字体 */
export function SiteChip({ siteKey, scope }: Props) {
  const isHost = scope === "host";
  return (
    <Chip
      size="sm"
      variant="soft"
      color={isHost ? "accent" : "default"}
      className="max-w-full overflow-hidden"
      title={isHost ? t("scopeHostTitle") : t("scopeSiteTitle")}
    >
      <Chip.Label className="truncate font-mono">{siteKey}</Chip.Label>
    </Chip>
  );
}
