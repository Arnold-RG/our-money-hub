import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Sparkline } from "./Sparkline";

export function KpiCard({
  label, value, icon, delta, period, series, hero, badge, invertDelta, sparkColor,
}: {
  label: string; value: ReactNode; icon?: ReactNode; delta?: number | null; period?: string;
  series?: number[]; hero?: boolean; badge?: ReactNode; invertDelta?: boolean; sparkColor?: string;
}) {
  const good = delta == null ? null : invertDelta ? delta < 0 : delta > 0;
  const bad = delta == null ? null : invertDelta ? delta > 0 : delta < 0;
  const signed = delta == null ? null : `${delta > 0 ? "+" : ""}${Number.isInteger(delta) ? delta : delta.toFixed(1)}%`;
  return (
    <div className={`card kpi p-4 ${hero ? "hero" : ""}`}>
      <div className="mb-2 flex items-center gap-2 text-[12.5px] font-medium" style={{ color: "var(--text2)" }}>
        {icon && <span className="grid h-7 w-7 place-items-center rounded-lg" style={{ background: "var(--s3)", color: "var(--text)" }}>{icon}</span>}
        <span>{label}</span>
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="num" style={{ font: `700 ${hero ? 28 : 24}px/1.1 var(--arn-font-num)`, letterSpacing: "-0.02em" }}>{value}</div>
          <div className="delta mt-1 flex items-center gap-1.5 text-xs" style={{ color: "var(--text2)" }}>
            {delta == null ? (period ? <span>{period}</span> : null) : (
              <>
                <span className={good ? "up" : bad ? "down" : ""}>
                  {delta > 0 ? <ArrowUpRight size={12} /> : delta < 0 ? <ArrowDownRight size={12} /> : null}
                  {signed}
                </span>
                {period && <span>{period}</span>}
              </>
            )}
          </div>
        </div>
        {series && series.length > 1 && <Sparkline values={series} color={sparkColor ?? "var(--c1)"} label={`${label} trend`} />}
      </div>
    </div>
  );
}
