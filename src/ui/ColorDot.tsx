import { cx } from "./useApi";

interface Props {
  color: string;
  title?: string;
  className?: string;
}

/** 会话色点。颜色来自 PALETTE，只能内联，不走语义色。 */
export function ColorDot({ color, title, className }: Props) {
  return (
    <span
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      title={title}
      className={cx("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ background: color }}
    />
  );
}
