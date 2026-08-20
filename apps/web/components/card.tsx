import type { CSSProperties } from "react";

type CardProps = {
  value?: string;
  hidden?: boolean;
  delay?: number;
};

export function Card({ value, hidden = false, delay = 0 }: CardProps) {
  const red = value?.includes("♥") || value?.includes("♦");
  const empty = !hidden && !value;
  const className = `card${hidden ? " card-hidden" : ""}${empty ? " card-empty" : ""}${red ? " card-red" : ""}`;
  const label = hidden ? "Hidden card" : value ? `${value} card` : "Empty card slot";

  return (
    <span
      className={className}
      aria-label={label}
      role="img"
      style={{ "--deal-delay": `${delay}ms` } as CSSProperties}
      data-filled={value || hidden ? "true" : "false"}
    >
      {hidden ? <i aria-hidden="true">NP</i> : value}
    </span>
  );
}
