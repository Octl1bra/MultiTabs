/**
 * popup（360 × ≤520）
 * 视觉参照：Linear 的设置面板 —— 13px 字、1px 分隔线、小圆角、没有阴影和渐变。
 * 规矩：不用任何浮层组件（Modal/Popover/Tooltip/Dropdown/Select/Toast…），反馈全走内联 Alert。
 */
import { Button, Spinner } from "@heroui/react";
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
import { BADGE_GRAY } from "@/src/ui/theme";
import { currentTabId, useAction, useQuery } from "@/src/ui/useApi";

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-3 pt-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
      {children}
    </div>
  );
}

export default function App() {
  const load = useCallback(async () => {
    const tabId = await currentTabId();
    return call("getPopupState", { tabId });
  }, []);
  const { data: state, error: loadError, loading, refresh } = useQuery(load);
  const { pending, error, run } = useAction();
  const [scope, setScope] = useState<Scope>("site");

  const shell = (children: React.ReactNode) => (
    <div className="flex max-h-[520px] w-[360px] flex-col overflow-x-hidden overflow-y-auto text-[13px] leading-5">
      {children}
    </div>
  );

  if (loading && !state) {
    return shell(
      <div className="flex items-center gap-2 px-3 py-6 text-muted">
        <Spinner size="sm" color="current" />
        {t("loading")}
      </div>,
    );
  }

  if (!state) {
    return shell(
      <div className="p-3">
        <InlineAlert
          message={loadError ?? t("noTab")}
          action={
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onPress={() => void refresh()}
            >
              {t("retry")}
            </Button>
          }
        />
      </div>,
    );
  }

  if (!state.tab.isHttp || !state.siteKeys || !state.tab.host) {
    return shell(<p className="px-3 py-4 text-muted">{t("notHttp")}</p>);
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
      {/* 标题行：名字 + 当前 tab 的会话色点 */}
      <header className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-sm font-semibold">{t("appName")}</span>
        {assignment ? (
          <ColorDot
            color={dotColor}
            title={activeSession ? activeSession.name : t("sessionDeleted")}
            className="size-3"
          />
        ) : null}
      </header>
      <div className="flex min-w-0 items-center gap-2 px-3 pb-2.5">
        <span className="min-w-0 truncate font-mono text-xs text-muted" title={siteKey}>
          {siteKey}
        </span>
        <ScopeBadge scope={scope} className="shrink-0" />
      </div>

      {error || loadError ? (
        <div className="px-3 pb-2">
          <InlineAlert message={error ?? loadError} />
        </div>
      ) : null}

      {/* 已挂载 */}
      {assignment ? (
        <section className="border-t border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted">{t("currentTab")}：</span>
              {activeSession ? (
                <span className="font-medium">{activeSession.name}</span>
              ) : (
                <span className="text-muted">{t("sessionDeleted")}</span>
              )}
            </span>
            <ActionButton
              size="sm"
              variant="danger-soft"
              className="h-7 px-2.5 text-xs"
              isDisabled={pending !== null}
              isPending={pending === "leave"}
              onPress={leave}
            >
              {t("leave")}
            </ActionButton>
          </div>
          {!assignment.inScope ? (
            <p className="mt-0.5 text-xs text-muted">{t("outOfScope")}</p>
          ) : null}
        </section>
      ) : null}

      {/* 新建 */}
      <section className="border-t border-border pb-3">
        <SectionLabel>{t("newSession")}</SectionLabel>
        <div className="px-3">
          <NewSessionForm
            host={host}
            scope={scope}
            onScopeChange={setScope}
            pending={pending}
            onSubmit={create}
          />
        </div>
      </section>

      {/* 已保存 */}
      <section className="border-t border-border pb-1">
        <SectionLabel>{t("savedSessions")}</SectionLabel>
        <SessionList
          sessions={sessions}
          activeId={assignment?.sessionId ?? null}
          pending={pending}
          onOpen={openSession}
          onHere={hereSession}
        />
      </section>

      <footer className="border-t border-border p-2">
        <Button
          size="sm"
          variant="ghost"
          fullWidth
          className="h-7 text-[13px]"
          onPress={() => void chrome.runtime.openOptionsPage()}
        >
          {t("manage")}
        </Button>
      </footer>
    </>,
  );
}
