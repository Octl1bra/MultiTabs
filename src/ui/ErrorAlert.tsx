import { Alert } from "@heroui/react";
import type { ReactNode } from "react";

interface Props {
  message: string | null | undefined;
  status?: "danger" | "success" | "warning" | "accent" | "default";
  /** 右侧可选动作（比如"重试"），照 Alert 文档的排法放在 Content 之后 */
  action?: ReactNode;
  className?: string;
}

/** 内联提示。popup 里不能用 toast，所有反馈都走这里。 */
export function InlineAlert({ message, status = "danger", action, className }: Props) {
  if (!message) return null;
  return (
    <Alert status={status} className={className}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title className="wrap-break-word">{message}</Alert.Title>
      </Alert.Content>
      {action}
    </Alert>
  );
}
