import { Alert } from "@heroui/react";
import type { ReactNode } from "react";
import { cx } from "./useApi";

interface Props {
  message: string | null | undefined;
  status?: "danger" | "success" | "warning" | "accent" | "default";
  /** 右侧可选动作（比如"重试"） */
  action?: ReactNode;
  className?: string;
}

/** 内联提示。popup 里不能用 toast，所有反馈都走这里。 */
export function InlineAlert({ message, status = "danger", action, className }: Props) {
  if (!message) return null;
  return (
    <Alert status={status} className={cx("gap-2 px-3 py-2 shadow-none", className)}>
      <Alert.Indicator className="p-0.5" />
      <Alert.Content>
        <Alert.Title className="text-[13px] leading-5 wrap-break-word">{message}</Alert.Title>
      </Alert.Content>
      {action}
    </Alert>
  );
}
