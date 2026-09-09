import { Button, EmptyState, Spinner } from "@heroui/react";
import { useCallback, useMemo, useState } from "react";
import { call, type SessionSummary } from "@/src/messaging";
import { InlineAlert } from "../ErrorAlert";
import { t } from "../i18n";
import { useAction, useQuery } from "../useApi";
import { ConfirmDialog } from "./ConfirmDialog";
import { SessionTableRow } from "./SessionTableRow";

type Confirm = { kind: "delete" | "clear"; session: SessionSummary };

/** 会话 tab：按 siteKey 分组的平铺列表（不用 Accordion，站点少时折叠只会碍事） */
export function SessionsPanel() {
  const load = useCallback(() => call("listAllSessions", {}).then((r) => r.sessions), []);
  const { data, error: loadError, loading, refresh } = useQuery(load);
  const { pending, error, run } = useAction();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  // listAllSessions 已按 siteKey 排好序，这里只是切段
  const groups = useMemo(() => {
    const map = new Map<string, SessionSummary[]>();
    for (const s of data ?? []) {
      const list = map.get(s.siteKey);
      if (list) list.push(s);
      else map.set(s.siteKey, [s]);
    }
    return [...map.entries()];
  }, [data]);

  const rename = (s: SessionSummary, name: string) =>
    void run(`rename:${s.id}`, () => call("renameSession", { sessionId: s.id, name })).then(
      (res) => {
        if (!res) return;
        setEditingId(null);
        void refresh();
      },
    );

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted">
        <Spinner size="sm" color="current" />
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {loadError ? (
        <InlineAlert
          message={loadError}
          action={
            <Button size="sm" variant="ghost" onPress={() => void refresh()}>
              {t("retry")}
            </Button>
          }
        />
      ) : null}
      <InlineAlert message={error} />

      {groups.length === 0 && !loadError ? (
        <EmptyState className="py-10 text-center">
          <p className="text-sm text-foreground">{t("emptyAll")}</p>
          <p className="mt-1 text-xs">{t("emptyAllHint")}</p>
        </EmptyState>
      ) : null}

      {groups.map(([siteKey, list]) => (
        <section key={siteKey} className="overflow-hidden rounded-md border border-border">
          <header className="flex items-baseline gap-2 border-b border-border bg-surface-secondary px-3 py-1.5">
            <span className="font-mono text-xs font-medium">{siteKey}</span>
            <span className="text-xs text-muted">{t("sessionsCount", { n: list.length })}</span>
          </header>
          <div className="divide-y divide-border">
            {list.map((s) => (
              <SessionTableRow
                key={s.id}
                session={s}
                editing={editingId === s.id}
                pending={pending}
                onStartEdit={() => setEditingId(s.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={(name) => rename(s, name)}
                onClear={() => setConfirm({ kind: "clear", session: s })}
                onDelete={() => setConfirm({ kind: "delete", session: s })}
              />
            ))}
          </div>
        </section>
      ))}

      {confirm ? (
        <ConfirmDialog
          key={`${confirm.kind}:${confirm.session.id}`}
          title={t(confirm.kind === "delete" ? "deleteTitle" : "clearTitle", {
            name: confirm.session.name,
          })}
          body={t(confirm.kind === "delete" ? "deleteBody" : "clearBody", {
            n: confirm.kind === "delete" ? confirm.session.tabCount : confirm.session.cookieCount,
          })}
          confirmLabel={t(confirm.kind === "delete" ? "delete" : "clearJar")}
          onConfirm={() =>
            confirm.kind === "delete"
              ? call("deleteSession", { sessionId: confirm.session.id })
              : call("clearJar", { sessionId: confirm.session.id })
          }
          onClose={() => {
            setConfirm(null);
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}
