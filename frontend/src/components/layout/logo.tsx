export function Logo({ size = 32 }: { size?: number }) {
  return (
    <div
      className="mono-mark shrink-0"
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      M
    </div>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <div className="logo-type leading-tight">
        <b className="block text-[15px] font-bold leading-tight" style={{ color: "var(--side-text)", filter: "brightness(1.25)" }}>Our Money Hub</b>
        <small className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--side-text)" }}>Arnova Group</small>
      </div>
    </div>
  );
}
