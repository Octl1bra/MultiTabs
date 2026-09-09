import { EmptyState } from "@heroui/react";
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

export function SessionList({ sessions, activeId, pending, onOpen, onHere }: Props) {
  if (sessions.length === 0) {
    return (
      <EmptyState className="px-3 py-2">
        <p className="text-foreground">{t("emptySessions")}</p>
        <p className="mt-0.5 text-xs">{t("emptySessionsHint")}</p>
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col">
      {sessions.map((s) => (
        <SessionRow
          key={s.id}
          session={s}
          active={s.id === activeId}
          pending={pending}
          onOpen={() => onOpen(s)}
          onHere={() => onHere(s)}
        />
      ))}
    </div>
  );
}
