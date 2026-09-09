import { AlertDialog, Button } from "@heroui/react";
import type { ReactNode } from "react";
import { ActionButton } from "../ActionButton";
import { InlineAlert } from "../ErrorAlert";
import { t } from "../i18n";
import { useAction } from "../useApi";

interface Props {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** 真正执行；抛错会显示在对话框里 */
  onConfirm: () => Promise<unknown>;
  /** 成功或取消后都会调用 */
  onClose: () => void;
}

/**
 * options 页专用的二次确认（popup 里禁用浮层）。结构照 AlertDialog 文档的 Default 示例。
 * 受控：挂载即打开，关掉就由父级卸载。
 */
export function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose }: Props) {
  const { pending, error, run } = useAction();

  const confirm = () =>
    void run("confirm", onConfirm).then((res) => {
      if (res !== undefined) onClose();
    });

  return (
    <AlertDialog.Backdrop isOpen onOpenChange={(open) => !open && onClose()}>
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p>{body}</p>
            <InlineAlert message={error} className="mt-3" />
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary" isDisabled={pending !== null}>
              {t("cancel")}
            </Button>
            <ActionButton variant="danger" isPending={pending !== null} onPress={confirm}>
              {confirmLabel}
            </ActionButton>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
