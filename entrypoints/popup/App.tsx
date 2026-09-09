/**
 * popup（360 × ≤520，内部滚动）
 * 视觉参照：HeroUI 文档的 Card「With Form」/ Surface「With Form Components」/ ListBox「With Sections」——
 * bg-background 上铺 rounded-3xl 的白卡片，药丸按钮，text-muted 说明文字，gap-3 / p-4 的呼吸感。
 * 规矩：不用任何浮层组件（Modal/Popover/Tooltip/Dropdown/Select/Toast…），反馈全走内联 Alert。
 */
import { Button, Card, Spinner } from "@heroui/react";
import { useCallback, useState } from "react";
import type { Scope } from "@/src/lib/types";
import { call, type SessionSummary } from "@/src/messaging";
import { ActionButton } from "@/src/ui/ActionButton";
import { ColorDot } from "@/src/ui/ColorDot";
import { InlineAlert } from "@/src/ui/ErrorAlert";
import { t } from "@/src/ui/i18n";
import { NewSessionForm } from "@/src/ui/NewSessionForm";
import { ScopeBadge } from "@/src/ui/ScopeBadge";
import { SessionList } from "@/src/ui/SessionList";
import { SiteChip } from "@/src/ui/SiteChip";
import { BADGE_GRAY } from "@/src/ui/theme";
import { currentTabId, useAction, useQuery } from "@/src/ui/useApi";

export default function App() {
  const load = useCallback(async () => {
    const tabId = await currentTabId();
    return call("getPopupState", { tabId });
  }, []);
  const { data: state, error: loadError, loading, refresh } = useQuery(load);
  const { pending, error, run } = useAction();
  const [scope, setScope] = useState<Scope>("site");

  const shell = (children: React.ReactNode) => (
    <div className="flex max-h-[520px] w-[360px] flex-col gap-3 overflow-x-hidden overflow-y-auto p-3">
      {children}
    </div>
  );

  if (loading && !state) {
    return shell(
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Spinner size="sm" color="current" />
        {t("loading")}
      </div>,
    );
  }

  if (!state) {
    return shell(
      <InlineAlert
        message={loadError ?? t("noTab")}
        action={
          <Button size="sm" variant="danger" onPress={() => void refresh()}>
            {t("retry")}
          </Button>
        }
      />,
    );
  }

  if (!state.tab.isHttp || !state.siteKeys || !state.tab.host) {
    return shell(
      <Card>
        <Card.Header>
          <Card.Title>{t("appName")}</Card.Title>
          <Card.Description>{t("notHttp")}</Card.Description>
        </Card.Header>
      </Card>,
    );
  }

  const host: string = state.tab.host;
  const { tab, siteKeys, assignment, sessions } = state;
  const tabId = tab.id;
  const siteKey = scope === "host" ? siteKeys.host : siteKeys.site;
  const activeSession = assignment?.session ?? null;
  const dotColor =
    assignment && assignment.inScope && activeSession ? activeSession.color : BADGE_GRAY;

  const create = (name: string, action: "newTab" | "here") =>
    void run(action === "newTab" ? "new" : "here", () =>
      call("createSession", { tabId, name, scope, action }),
    ).then((res) => {
      if (!res) return;
      if (action === "newTab") window.close();
      else void refresh();
    });

  const openSession = (s: SessionSummary) =>
    void run(`open:${s.id}`, () =>
      call("openInNewTab", { sessionId: s.id, url: tab.url ?? "" }),
    ).then((res) => res && window.close());

  const hereSession = (s: SessionSummary) =>
    void run(`here:${s.id}`, () => call("useHere", { sessionId: s.id, tabId })).then(
      (res) => res && void refresh(),
    );

  const leave = () =>
    void run("leave", () => call("leave", { tabId })).then((res) => res && void refresh());

  return shell(
    <>
      {/* 标题区：应用名 + 当前 tab 的会话色点；下一行是 siteKey Chip（颜色 = 作用域） */}
      <header className="flex flex-col gap-2 px-1 pt-1">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-base font-semibold text-foreground">{t("appName")}</h1>
          {assignment ? (
            <ColorDot
              color={dotColor}
              className="ring-2 ring-background"
              title={activeSession ? activeSession.name : t("sessionDeleted")}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <SiteChip siteKey={siteKey} scope={scope} />
          <ScopeBadge scope={scope} variant="tertiary" />
        </div>
      </header>

      <InlineAlert message={error ?? loadError} />

      {/* 已挂载：secondary 卡片，右侧 danger-soft 退出 */}
      {assignment ? (
        <Card variant="secondary" className="flex-row items-center justify-between gap-3">
          <Card.Header className="min-w-0">
            <Card.Title className="truncate">
              <span className="text-muted">{t("currentTab")}：</span>
              {activeSession ? activeSession.name : t("sessionDeleted")}
            </Card.Title>
            {!assignment.inScope ? <Card.Description>{t("outOfScope")}</Card.Description> : null}
          </Card.Header>
          <ActionButton
            size="sm"
            variant="danger-soft"
            isDisabled={pending !== null}
            isPending={pending === "leave"}
            onPress={leave}
          >
            {t("leave")}
          </ActionButton>
        </Card>
      ) : null}

      <NewSessionForm
        host={host}
        scope={scope}
        onScopeChange={setScope}
        pending={pending}
        onSubmit={create}
      />

      <SessionList
        sessions={sessions}
        activeId={assignment?.sessionId ?? null}
        pending={pending}
        onOpen={openSession}
        onHere={hereSession}
      />

      <Button
        size="sm"
        variant="ghost"
        fullWidth
        onPress={() => void chrome.runtime.openOptionsPage()}
      >
        {t("manage")}
      </Button>
    </>,
  );
}
