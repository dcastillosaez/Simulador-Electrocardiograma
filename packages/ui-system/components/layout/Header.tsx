import type { ReactNode } from "react";
import styles from "./Header.module.css";

export interface HeaderProps {
  title: string;
  children?: ReactNode;
}

export function Header({ title, children }: HeaderProps) {
  return (
    <header className={styles.header} role="banner">
      <h1 className={styles.title}>{title}</h1>
      {children && <div className={styles.slot}>{children}</div>}
    </header>
  );
}
