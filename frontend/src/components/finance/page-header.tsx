import { ChromePortal } from "@/components/layout/PageChrome";

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <ChromePortal>
      <div className="w-full min-w-0 lg:flex-1">
        <h1 className="m-0 text-[22px] font-bold leading-tight tracking-tight text-pretty">{title}</h1>
        {(eyebrow || subtitle) && (
          <div className="mt-0.5 text-[13px] leading-snug text-pretty" style={{ color: "var(--text2)" }}>
            {eyebrow}{eyebrow && subtitle ? " · " : ""}{subtitle}
          </div>
        )}
      </div>
      {actions ? <div className="header-actions">{actions}</div> : null}
    </ChromePortal>
  );
}
