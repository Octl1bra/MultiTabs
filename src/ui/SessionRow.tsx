import { Description } from "@heroui/react";
import type { SessionSummary } from "@/src/messaging";
import { ActionButton } from "./ActionButton";
import { ColorDot } from "./ColorDot";
import { t } from "./i18n";
import { ScopeBadge } from "./ScopeBadge";
import { cx } from "./useApi";

interface Props {
  session: SessionSummary;
  /** 当前 tab 就挂在这个会话上 */
  active: boolean;
  /** 全局 pending key，用来判断本行哪个按钮在转 */
  pending: string | null;
  onOpen: () => void;
  onHere: () => void;
}

/**
 * 一行 = 色点 · 名称/N cookies · [作用域] · [打开][此处]
 * 形状照 HeroUI ListBox.Item（rounded-2xl px-2 py-1.5 gap-3，Label + Description 上下叠），
 * 但不用 ListBox：一行要放两个按钮，嵌在可按压的 item 里不自然。
 * 当前挂载的那行用 bg-surface-secondary 垫一层。
 */
export function SessionRow({ session, active, pending, onOpen, onHere }: Props) {
  const busy = pending !== null;
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-2xl px-2 py-1.5",
        active && "bg-surface-secondary",
      )}
      data-active={active || undefined}
    >
      <ColorDot color={session.color} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground" title={session.name}>
          {session.name}
        </span>
        <Description className="tabular-nums">
          {t("cookies", { n: session.cookieCount })}
        </Description>
      </div>
      {session.scope === "host" ? <ScopeBadge scope="host" /> : null}
      <ActionButton
        size="sm"
        variant="secondary"
        isDisabled={busy}
        isPending={pending === `open:${session.id}`}
        onPress={onOpen}
      >
        {t("open")}
      </ActionButton>
      <ActionButton
        size="sm"
        variant="tertiary"
        isDisabled={busy || active}
        isPending={pending === `here:${session.id}`}
        onPress={onHere}
      >
        {t("here")}
      </ActionButton>
    </div>
  );
}
