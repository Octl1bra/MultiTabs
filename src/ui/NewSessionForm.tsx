import { Card, Checkbox, Description, Input } from "@heroui/react";
import { useState, type FormEvent } from "react";
import { MAX_SESSION_NAME, type Scope } from "@/src/lib/types";
import { ActionButton } from "./ActionButton";
import { t } from "./i18n";

interface Props {
  /** 勾选"仅隔离当前主机名"时显示的完整主机名 */
  host: string;
  scope: Scope;
  onScopeChange: (scope: Scope) => void;
  /** "new" | "here" | 其它动作的 key；非空时整块禁用 */
  pending: string | null;
  onSubmit: (name: string, action: "newTab" | "here") => void;
}

/**
 * 新建会话卡片。结构照 HeroUI Card「With Form」：
 * Card.Header（标题 + 描述）→ form → Card.Content（Input + Checkbox）→ Card.Footer（两个按钮）。
 * 卡片是 bg-surface，所以表单控件一律 variant="secondary"（Surface 文档的要求）。
 */
export function NewSessionForm({ host, scope, onScopeChange, pending, onSubmit }: Props) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const busy = pending !== null;
  const canSubmit = trimmed.length > 0 && !busy;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit(trimmed, "newTab");
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title>{t("newSession")}</Card.Title>
        <Card.Description>{t("newSessionDesc")}</Card.Description>
      </Card.Header>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Card.Content className="gap-3">
          <Input
            aria-label={t("namePlaceholder")}
            placeholder={t("namePlaceholder")}
            variant="secondary"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_SESSION_NAME}
            autoFocus
            autoComplete="off"
          />
          <Checkbox
            variant="secondary"
            isSelected={scope === "host"}
            onChange={(v) => onScopeChange(v ? "host" : "site")}
            isDisabled={busy}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              {t("hostOnly")}
            </Checkbox.Content>
            <Description className="font-mono">{host}</Description>
          </Checkbox>
        </Card.Content>
        <Card.Footer className="gap-2">
          <ActionButton
            type="submit"
            size="sm"
            fullWidth
            isDisabled={!canSubmit}
            isPending={pending === "new"}
          >
            {t("newTab")}
          </ActionButton>
          <ActionButton
            type="button"
            variant="secondary"
            size="sm"
            fullWidth
            isDisabled={!canSubmit}
            isPending={pending === "here"}
            onPress={() => onSubmit(trimmed, "here")}
          >
            {t("useHere")}
          </ActionButton>
        </Card.Footer>
      </form>
    </Card>
  );
}
