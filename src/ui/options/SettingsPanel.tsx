import { Button, Card, Kbd } from "@heroui/react";
import { useState } from "react";
import { call } from "@/src/messaging";
import { ActionButton } from "../ActionButton";
import { InlineAlert } from "../ErrorAlert";
import { t } from "../i18n";
import { useAction } from "../useApi";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUTS_URL = "chrome://extensions/shortcuts";

/** 设置 tab：快捷键 / 清理过期 cookie / 关于，一项一张 Card */
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

      <Card>
        <Card.Header>
          <Card.Title>{t("shortcut")}</Card.Title>
          <Card.Description>{t("shortcutDesc")}</Card.Description>
        </Card.Header>
        <Card.Content>
          <div className="flex flex-wrap items-center gap-3">
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
            <span className="text-sm text-muted">{t("shortcutHint")}</span>
          </div>
        </Card.Content>
        <Card.Footer>
          {/* 扩展页面不能直接 <a href="chrome://…">，得走 tabs.create */}
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void chrome.tabs.create({ url: SHORTCUTS_URL })}
          >
            {t("openShortcuts")}
          </Button>
        </Card.Footer>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t("maintenance")}</Card.Title>
          <Card.Description>{t("purgeDesc")}</Card.Description>
        </Card.Header>
        {purged !== null ? (
          <Card.Content>
            <InlineAlert status="success" message={t("purgeResult", { n: purged })} />
          </Card.Content>
        ) : null}
        <Card.Footer>
          <ActionButton
            size="sm"
            variant="secondary"
            isPending={pending === "purge"}
            onPress={purge}
          >
            {t("purge")}
          </ActionButton>
        </Card.Footer>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>{t("about")}</Card.Title>
          <Card.Description>
            {t("version")} <span className="font-mono">{version}</span>
          </Card.Description>
        </Card.Header>
      </Card>
    </div>
  );
}
