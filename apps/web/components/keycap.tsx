import type { ReactNode } from "react";

// github write test
export function Keycap({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const top = wide ? "M11 2H89L93 12H7Z" : "M11 2H89L84 12H16Z";
  const left = wide ? "M3 8L11 2L7 12V54L4 66L2 58V13Z" : "M3 8L11 2L16 12V54L9 66L2 58V13Z";
  const right = wide ? "M89 2L97 8L99 13V58L96 66L93 54V12Z" : "M89 2L97 8L99 13V58L91 66L84 54V12Z";
  const bottom = wide ? "M4 66L7 54H93L96 66L89 70H11Z" : "M9 66L16 54H84L91 66L89 70H11Z";

  return (
    <span className="keycap">
      <svg
        className="keycap-shape"
        viewBox="0 0 100 72"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          className="keycap-body"
          d="M11 2H89Q94 2 97 8L99 13V57Q99 62 94 67L89 70H11L6 67Q1 62 1 57V13L3 8Q6 2 11 2Z"
        />
        <path className="keycap-wall keycap-wall-top" d={top} />
        <path className="keycap-wall keycap-wall-left" d={left} />
        <path className="keycap-wall keycap-wall-right" d={right} />
        <path className="keycap-wall keycap-wall-bottom" d={bottom} />
        <rect className="keycap-face" x={wide ? 7 : 16} y="12" width={wide ? 86 : 68} height="42" rx="5" />
        <path className="keycap-accent" d="M13 67H87" />
      </svg>
      <span className="keycap-label">{children}</span>
    </span>
  );
}
