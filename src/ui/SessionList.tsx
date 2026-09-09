import { Card, Chip, EmptyState } from "@heroui/react";
import type { SessionSummary } from "@/src/messaging";
import { t } from "./i18n";
import { SessionRow } from "./SessionRow";

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  pending: string | null;
  onOpen: (s: SessionSummary) => void;
  onHere: (s: SessionSummary) => void;
}

/** 已保存的会话卡片：Card.Header 标题 + 计数 Chip，Card.Content 里一行一个会话 */
export function SessionList({ sessions, activeId, pending, onOpen, onHere }: Props) {
  return (
    <Card>
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Title>{t("savedSessions")}</Card.Title>
        {sessions.length > 0 ? (
          <Chip size="sm" variant="soft">
            {sessions.length}
          </Chip>
        ) : null}
      </Card.Header>
      {/* -mx-2 让行内 px-2 的内容跟卡片标题左对齐，跟 Surface + ListBox(p-2) 的示例一样 */}
      <Card.Content className="-mx-2">
        {sessions.length === 0 ? (
          <EmptyState>
            <p className="text-foreground">{t("emptySessions")}</p>
            <p>{t("emptySessionsHint")}</p>
          </EmptyState>
        ) : (
          sessions.map((s) => (
            <SessionRow
              key={s.id}
              session={s}
              active={s.id === activeId}
              pending={pending}
              onOpen={() => onOpen(s)}
              onHere={() => onHere(s)}
            />
          ))
        )}
      </Card.Content>
    </Card>
  );
}
