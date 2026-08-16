type CardProps = {
  value?: string;
  hidden?: boolean;
};

export function Card({ value, hidden = false }: CardProps) {
  const red = value?.includes("♥") || value?.includes("♦");
  const empty = !hidden && !value;
  const className = `card${hidden ? " card-hidden" : ""}${empty ? " card-empty" : ""}${red ? " card-red" : ""}`;
  const label = hidden ? "Hidden card" : value ? `${value} card` : "Empty card slot";

  return (
    <span className={className} aria-label={label} role="img">
      {hidden ? "??" : value}
    </span>
  );
}
