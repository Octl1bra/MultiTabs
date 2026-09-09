import { Button, Card, Chip, EmptyState, Spinner, Table } from "@heroui/react";
import { useCallback, useMemo, useState } from "react";
import { call, type SessionSummary } from "@/src/messaging";
import { InlineAlert } from "../ErrorAlert";
import { t } from "../i18n";
import { useAction, useQuery } from "../useApi";
import { ConfirmDialog } from "./ConfirmDialog";
import { SessionTableRow } from "./SessionTableRow";

type Confirm = { kind: "delete" | "clear"; session: SessionSummary };

/**
 * 会话 tab：每个 siteKey 一张 Card，卡片里一张 HeroUI Table（列照文档「Custom Cells」的排法：
 * 会话（色点 + 名称 + cookies/tab 注脚）· 作用域 Chip · 最后使用 · 操作按钮组）。
 */
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
            <Button size="sm" variant="danger" onPress={() => void refresh()}>
              {t("retry")}
            </Button>
          }
        />
      ) : null}
      <InlineAlert message={error} />

      {groups.length === 0 && !loadError ? (
        <Card>
          <EmptyState className="py-8 text-center">
            <p className="text-foreground">{t("emptyAll")}</p>
            <p>{t("emptyAllHint")}</p>
          </EmptyState>
        </Card>
      ) : null}

      {groups.map(([siteKey, list]) => (
        <Card key={siteKey}>
          <Card.Header className="flex-row items-center gap-2">
            <Card.Title className="font-mono">{siteKey}</Card.Title>
            <Chip size="sm" variant="soft">
              {t("sessionsCount", { n: list.length })}
            </Chip>
          </Card.Header>
          <Card.Content>
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label={siteKey}>
                  <Table.Header>
                    <Table.Column isRowHeader>{t("colSession")}</Table.Column>
                    <Table.Column>{t("colScope")}</Table.Column>
                    <Table.Column>{t("lastUsed")}</Table.Column>
                    <Table.Column className="text-end">{t("colActions")}</Table.Column>
                  </Table.Header>
                  <Table.Body>
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
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          </Card.Content>
        </Card>
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
