import { Button, Description, Input, Table } from "@heroui/react";
import { useState } from "react";
import { MAX_SESSION_NAME } from "@/src/lib/types";
import type { SessionSummary } from "@/src/messaging";
import { ActionButton } from "../ActionButton";
import { ColorDot } from "../ColorDot";
import { t } from "../i18n";
import { relativeTime } from "../relativeTime";
import { ScopeBadge } from "../ScopeBadge";

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

/**
 * Table.Row：色点 + 名称 / cookies · tabs 注脚 · 作用域 · 最后使用 · 操作
 * 改名时名称格换成 Input，操作格换成 保存 / 取消——按钮留在操作列里，表格宽度不会被撑爆。
 */
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
  const [draft, setDraft] = useState(session.name);
  const trimmed = draft.trim();
  const renaming = pending === `rename:${session.id}`;
  const canSave = trimmed.length > 0 && trimmed !== session.name && !renaming;

  const startEdit = () => {
    setDraft(session.name);
    onStartEdit();
  };

  return (
    <Table.Row id={session.id}>
      <Table.Cell>
        {editing ? (
          <Input
            aria-label={t("rename")}
            variant="secondary"
            className="w-48"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_SESSION_NAME}
            autoFocus
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) onSaveEdit(trimmed);
              if (e.key === "Escape") onCancelEdit();
            }}
          />
        ) : (
          <div className="flex max-w-64 items-center gap-3">
            <ColorDot color={session.color} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-foreground" title={session.name}>
                {session.name}
              </span>
              <Description className="tabular-nums">
                {t("cookies", { n: session.cookieCount })} ·{" "}
                {t("tabsCount", { n: session.tabCount })}
              </Description>
            </div>
          </div>
        )}
      </Table.Cell>
      <Table.Cell>
        <ScopeBadge scope={session.scope} />
      </Table.Cell>
      <Table.Cell>
        <span
          className="text-muted tabular-nums"
          title={`${t("lastUsed")}：${new Date(session.lastUsedAt).toLocaleString("zh-CN")}`}
        >
          {relativeTime(session.lastUsedAt)}
        </span>
      </Table.Cell>
      <Table.Cell>
        <div className="flex items-center justify-end gap-1">
          {editing ? (
            <>
              <ActionButton
                size="sm"
                isDisabled={!canSave}
                isPending={renaming}
                onPress={() => onSaveEdit(trimmed)}
              >
                {t("save")}
              </ActionButton>
              <Button size="sm" variant="tertiary" isDisabled={renaming} onPress={onCancelEdit}>
                {t("cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={startEdit}>
                {t("rename")}
              </Button>
              <Button size="sm" variant="ghost" isDisabled={busy} onPress={onClear}>
                {t("clearJar")}
              </Button>
              <Button size="sm" variant="danger-soft" isDisabled={busy} onPress={onDelete}>
                {t("delete")}
              </Button>
            </>
          )}
        </div>
      </Table.Cell>
    </Table.Row>
  );
}
