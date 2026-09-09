import { Button, Input } from "@heroui/react";
import { useState } from "react";
import { MAX_SESSION_NAME } from "@/src/lib/types";
import type { SessionSummary } from "@/src/messaging";
import { ActionButton } from "../ActionButton";
import { ColorDot } from "../ColorDot";
import { t } from "../i18n";
import { relativeTime } from "../relativeTime";
import { ScopeBadge } from "../ScopeBadge";
import { cx } from "../useApi";

interface Props {
  session: SessionSummary;
  editing: boolean;
  pending: string | null;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (name: string) => void;
  onClear: () => void;
  onDelete: () => void;
}

/** 一行：色点 · 名称（可内联改名）· 作用域 · cookies · tabs · 最后使用 · 操作 */
export function SessionTableRow({
  session,
  editing,
  pending,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onClear,
  onDelete,
}: Props) {
  const busy = pending !== null;
  const small = "h-7 px-2 text-xs";
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <ColorDot color={session.color} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <RenameInline
            initial={session.name}
            pending={pending === `rename:${session.id}`}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          <span className="block truncate text-sm font-medium" title={session.name}>
            {session.name}
          </span>
        )}
      </div>
      <ScopeBadge scope={session.scope} className="shrink-0" />
      <span className="w-20 shrink-0 text-right text-xs text-muted tabular-nums">
        {t("cookies", { n: session.cookieCount })}
      </span>
      <span className="w-14 shrink-0 text-right text-xs text-muted tabular-nums">
        {t("tabsCount", { n: session.tabCount })}
      </span>
      <span
        className="w-20 shrink-0 text-right text-xs text-muted tabular-nums"
        title={`${t("lastUsed")}：${new Date(session.lastUsedAt).toLocaleString("zh-CN")}`}
      >
        {relativeTime(session.lastUsedAt)}
      </span>
      <div className={cx("flex shrink-0 items-center gap-1", editing && "invisible")}>
        <Button size="sm" variant="ghost" className={small} isDisabled={busy} onPress={onStartEdit}>
          {t("rename")}
        </Button>
        <Button size="sm" variant="ghost" className={small} isDisabled={busy} onPress={onClear}>
          {t("clearJar")}
        </Button>
        <Button
          size="sm"
          variant="danger-soft"
          className={small}
          isDisabled={busy}
          onPress={onDelete}
        >
          {t("delete")}
        </Button>
      </div>
    </div>
  );
}

function RenameInline({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial: string;
  pending: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed !== initial && !pending;
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={t("rename")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={MAX_SESSION_NAME}
        autoFocus
        autoComplete="off"
        className="h-7 w-56 py-0 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSave) onSave(trimmed);
          if (e.key === "Escape") onCancel();
        }}
      />
      <ActionButton
        size="sm"
        className="h-7 px-2 text-xs"
        isDisabled={!canSave}
        isPending={pending}
        onPress={() => onSave(trimmed)}
      >
        {t("save")}
      </ActionButton>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        isDisabled={pending}
        onPress={onCancel}
      >
        {t("cancel")}
      </Button>
    </div>
  );
}
