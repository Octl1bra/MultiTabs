import { Button, Spinner, type ButtonProps } from "@heroui/react";
import type { ReactNode } from "react";

type Props = Omit<ButtonProps, "children"> & { children: ReactNode };

/** Button + isPending 时自动带一个 Spinner，省得每处都写 render prop */
export function ActionButton({ children, ...rest }: Props) {
  return (
    <Button {...rest}>
      {({ isPending }) => (
        <>
          {isPending ? <Spinner color="current" size="sm" /> : null}
          {children}
        </>
      )}
    </Button>
  );
}
