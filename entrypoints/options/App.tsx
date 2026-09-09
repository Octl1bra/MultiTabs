/**
 * options（管理页）
 * 视觉参照同 popup：Linear 设置面板。整页应用，允许浮层（删除/清空走 AlertDialog）。
 * "站点绑定" tab 是 P1，先不放。
 */
import { Tabs } from "@heroui/react";
import { t } from "@/src/ui/i18n";
import { SessionsPanel } from "@/src/ui/options/SessionsPanel";
import { SettingsPanel } from "@/src/ui/options/SettingsPanel";

export default function App() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-base font-semibold">{t("optionsTitle")}</h1>
        <span className="font-mono text-xs text-muted">
          v{chrome.runtime.getManifest().version}
        </span>
      </header>

      <Tabs variant="secondary" defaultSelectedKey="sessions">
        <Tabs.ListContainer>
          <Tabs.List aria-label={t("optionsTitle")}>
            <Tabs.Tab id="sessions">
              {t("tabSessions")}
              <Tabs.Indicator />
            </Tabs.Tab>
            <Tabs.Tab id="settings">
              {t("tabSettings")}
              <Tabs.Indicator />
            </Tabs.Tab>
          </Tabs.List>
        </Tabs.ListContainer>
        <Tabs.Panel id="sessions" className="px-0 pt-4">
          <SessionsPanel />
        </Tabs.Panel>
        <Tabs.Panel id="settings" className="px-0 pt-4">
          <SettingsPanel />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
