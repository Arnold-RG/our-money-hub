/** Tiny 40–48px sparkline. Values are already in display units; no interpolation. */
export function Sparkline({ values, color = "var(--c1)", width = 88, height = 40, label }: { values: number[]; color?: string; width?: number; height?: number; label: string }) {
  if (values.length < 2) return <span className="sr-only">{label}: not enough points</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="sparkw overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.join(" ")} />
    </svg>
  );
}
