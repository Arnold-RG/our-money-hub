export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <defs>
        <linearGradient id="omh-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#193F30" />
          <stop offset="1" stopColor="#302119" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#omh-g)" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#C38D58" strokeWidth="4" />
      <circle cx="32" cy="32" r="5" fill="#8FB49A" />
      <circle cx="47" cy="32" r="3.5" fill="#F5EAD9" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <Logo />
      <div className="leading-tight">
        <div className="display text-[17px] font-semibold">Our Money Hub</div>
        <div className="text-xs uppercase tracking-[0.18em] text-faint">Arnova Group</div>
      </div>
    </div>
  );
}
