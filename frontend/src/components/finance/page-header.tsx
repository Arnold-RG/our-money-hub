import { ChromePortal } from "@/components/layout/PageChrome";

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <ChromePortal>
      <div className="min-w-0">
        <h1 className="m-0 text-[22px] font-bold tracking-tight">{title}</h1>
        {(eyebrow || subtitle) && (
          <div className="mt-0.5 truncate text-[12.5px]" style={{ color: "var(--text2)" }}>
            {eyebrow}{eyebrow && subtitle ? " · " : ""}{subtitle}
          </div>
        )}
      </div>
      <div className="hidden flex-1 lg:block" />
      {actions && <div className="ml-auto hidden flex-wrap items-center gap-2 sm:flex">{actions}</div>}
    </ChromePortal>
  );
}
