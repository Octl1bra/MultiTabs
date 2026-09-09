import { Checkbox, Input } from "@heroui/react";
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("namePlaceholder")}
          placeholder={t("namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_SESSION_NAME}
          autoFocus
          autoComplete="off"
          fullWidth
          className="h-8 min-w-0 flex-1 py-0 text-[13px]"
        />
        <ActionButton
          type="submit"
          size="sm"
          className="h-8 shrink-0 px-3 text-[13px]"
          isDisabled={!canSubmit}
          isPending={pending === "new"}
        >
          {t("newTab")}
        </ActionButton>
      </div>

      <Checkbox
        isSelected={scope === "host"}
        onChange={(v) => onScopeChange(v ? "host" : "site")}
        isDisabled={busy}
        className="gap-0"
      >
        <Checkbox.Content className="text-[13px]">
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
          <span>
            {t("hostOnly")}
            <span className="ms-1 font-mono text-xs text-muted">({host})</span>
          </span>
        </Checkbox.Content>
      </Checkbox>

      <ActionButton
        type="button"
        variant="secondary"
        size="sm"
        fullWidth
        className="h-8 text-[13px]"
        isDisabled={!canSubmit}
        isPending={pending === "here"}
        onPress={() => onSubmit(trimmed, "here")}
      >
        {t("useHere")}
      </ActionButton>
    </form>
  );
}
