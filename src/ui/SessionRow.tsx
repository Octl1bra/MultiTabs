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
 * 自绘列表行（不用 ListBox）：色点 · 名称 · N cookies · [打开][此处]
 * 高亮行左侧压一条 2px 会话色边，比整行染色安静。
 */
export function SessionRow({ session, active, pending, onOpen, onHere }: Props) {
  const busy = pending !== null;
  const btn = "h-6 min-w-0 px-2 text-xs";
  return (
    <div
      className={cx("flex items-center gap-2 px-3 py-1.5", active && "bg-default-soft")}
      style={active ? { boxShadow: `inset 2px 0 0 ${session.color}` } : undefined}
      data-active={active || undefined}
    >
      <ColorDot color={session.color} />
      <span className={cx("min-w-0 flex-1 truncate", active && "font-medium")} title={session.name}>
        {session.name}
      </span>
      {session.scope === "host" ? <ScopeBadge scope="host" className="shrink-0" /> : null}
      <span className="shrink-0 text-xs text-muted tabular-nums">
        {t("cookies", { n: session.cookieCount })}
      </span>
      <ActionButton
        size="sm"
        variant="secondary"
        className={btn}
        isDisabled={busy}
        isPending={pending === `open:${session.id}`}
        onPress={onOpen}
      >
        {t("open")}
      </ActionButton>
      <ActionButton
        size="sm"
        variant="ghost"
        className={btn}
        isDisabled={busy || active}
        isPending={pending === `here:${session.id}`}
        onPress={onHere}
      >
        {t("here")}
      </ActionButton>
    </div>
  );
}
