/**
 * options（管理页）
 * 视觉参照同 popup：HeroUI 文档的 Card / Table / Tabs 示例页。整页应用，允许浮层（删除/清空走 AlertDialog）。
 * "站点绑定" tab 是 P1，先不放。
 */
import { Chip, Tabs } from "@heroui/react";
import { t } from "@/src/ui/i18n";
import { SessionsPanel } from "@/src/ui/options/SessionsPanel";
import { SettingsPanel } from "@/src/ui/options/SettingsPanel";

export default function App() {
  return (
    // chrome://extensions 的内嵌弹窗按文档尺寸定大小，内容或 tab 一变就跟着变；
    // 外壳固定 760×600，内容在壳里滚，文档尺寸永远不变。
    <div className="h-[600px] w-[760px] overflow-x-hidden overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold text-foreground">{t("optionsTitle")}</h1>
            <p className="text-sm text-muted">{t("optionsDesc")}</p>
          </div>
          <Chip size="sm" variant="soft">
            <Chip.Label className="font-mono">v{chrome.runtime.getManifest().version}</Chip.Label>
          </Chip>
        </header>

        <Tabs defaultSelectedKey="sessions">
          <Tabs.ListContainer className="w-fit">
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
          <Tabs.Panel id="sessions" className="px-0">
            <SessionsPanel />
          </Tabs.Panel>
          <Tabs.Panel id="settings" className="px-0">
            <SettingsPanel />
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
