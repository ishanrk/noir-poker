import type { ReactNode } from "react";

export function Keycap({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <span className={`keycap${wide ? " keycap-wide" : ""}`}>
      <span className="keycap-depth" aria-hidden="true" />
      <span className="keycap-face">
        <span className="keycap-label">{children}</span>
      </span>
    </span>
  );
}
