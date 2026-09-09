import { Button, Kbd } from "@heroui/react";
import { useState } from "react";
import { call } from "@/src/messaging";
import { ActionButton } from "../ActionButton";
import { InlineAlert } from "../ErrorAlert";
import { t } from "../i18n";
import { useAction } from "../useApi";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUTS_URL = "chrome://extensions/shortcuts";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-4 px-3 py-3">
      <div className="pt-0.5 text-sm text-muted">{label}</div>
      <div className="min-w-0 text-sm">{children}</div>
    </div>
  );
}

/** 设置 tab：快捷键 / 清理过期 cookie / 版本 */
export function SettingsPanel() {
  const { pending, error, run } = useAction();
  const [purged, setPurged] = useState<number | null>(null);
  const version = chrome.runtime.getManifest().version;

  const purge = () =>
    void run("purge", () => call("purgeExpired", {})).then((res) => {
      if (res) setPurged(res.removed);
    });

  return (
    <div className="flex flex-col gap-4">
      <InlineAlert message={error} />
      <section className="divide-y divide-border rounded-md border border-border">
        <Row label={t("shortcut")}>
          <div className="flex flex-wrap items-center gap-2">
            {/* mac 显示 ⌘⇧Y；其它平台 HeroUI 的 ctrl 会画成 ⌃，不如直接写 Ctrl+Shift+Y */}
            {isMac ? (
              <Kbd>
                <Kbd.Abbr keyValue="command" />
                <Kbd.Abbr keyValue="shift" />
                <Kbd.Content>Y</Kbd.Content>
              </Kbd>
            ) : (
              <Kbd>
                <Kbd.Content>Ctrl+Shift+Y</Kbd.Content>
              </Kbd>
            )}
            <span>{t("shortcutDesc")}</span>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {t("shortcutHint")}
            {/* 扩展页面不能直接 <a href="chrome://…">，得走 tabs.create */}
            <Button
              size="sm"
              variant="ghost"
              className="ms-1 h-6 px-1.5 text-xs text-link"
              onPress={() => void chrome.tabs.create({ url: SHORTCUTS_URL })}
            >
              {t("openShortcuts")}
            </Button>
          </p>
        </Row>

        <Row label={t("maintenance")}>
          <div className="flex flex-wrap items-center gap-3">
            <ActionButton
              size="sm"
              variant="secondary"
              isPending={pending === "purge"}
              onPress={purge}
            >
              {t("purge")}
            </ActionButton>
            <span className="text-xs text-muted">{t("purgeDesc")}</span>
          </div>
          {purged !== null ? (
            <InlineAlert
              status="success"
              message={t("purgeResult", { n: purged })}
              className="mt-2"
            />
          ) : null}
        </Row>

        <Row label={t("version")}>
          <span className="font-mono text-xs">{version}</span>
        </Row>
      </section>
    </div>
  );
}
