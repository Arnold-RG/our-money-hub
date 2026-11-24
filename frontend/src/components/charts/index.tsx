"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, formatAmount, type Currency, type Money } from "@/lib/money";
import { niceDate } from "@/lib/labels";

// Chart geometry needs numbers; labels and tooltips always show the exact API strings.
const n = (m: Money) => m.minor;

function Tip({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-xl px-3 py-2 text-xs shadow-xl">{children}</div>;
}

export function PulseChart({ points, events, height = 220 }: { points: { date: string; balance: Money }[]; events: { date: string; name: string; amount: Money }[]; height?: number }) {
  const data = points.map((p) => ({ date: p.date, v: n(p.balance), m: p.balance }));
  const byDate = new Map(data.map((d) => [d.date, d]));
  const dots = events.filter((e) => byDate.has(e.date)).slice(0, 24);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 6, left: 6, bottom: 0 }}>
          <defs>
            <linearGradient id="pulse" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--omh-accent)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--omh-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={(d) => niceDate(d)} tickLine={false} axisLine={false} minTickGap={48} />
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as { date: string; m: Money };
              const ev = events.filter((e) => e.date === d.date);
              return (
                <Tip>
                  <div className="text-faint">{niceDate(d.date, { weekday: "short", day: "numeric", month: "short" })} · forecast</div>
                  <div className="tnum mt-0.5 text-sm font-semibold">{fmt(d.m)}</div>
                  {ev.map((e) => (
                    <div key={e.name} className="tnum mt-1 text-muted">
                      {e.name}: {fmt(e.amount, { sign: true })}
                    </div>
                  ))}
                </Tip>
              );
            }}
          />
          <Area type="monotone" dataKey="v" stroke="var(--omh-accent)" strokeWidth={2.2} fill="url(#pulse)" isAnimationActive animationDuration={900} />
          {dots.map((e) => (
            <ReferenceDot key={e.date + e.name} x={e.date} y={byDate.get(e.date)!.v} r={3.5} fill={e.amount.minor < 0 ? "var(--omh-accent-2)" : "var(--arn-positive)"} stroke="var(--arn-bg)" strokeWidth={1.5} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CashflowChart({ series, currency }: { series: { month: string; income: Money; expense: Money; net: Money }[]; currency: Currency }) {
  const data = series.map((s) => ({ ...s, inc: n(s.income), exp: n(s.expense) }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={4} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--arn-border)" />
          <XAxis dataKey="month" tickFormatter={(m: string) => niceDate(m + "-01", { month: "short" })} tickLine={false} axisLine={false} />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--arn-surface-3)", opacity: 0.4 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              return (
                <Tip>
                  <div className="text-faint">{niceDate(d.month + "-01", { month: "long", year: "numeric" })}</div>
                  <div className="tnum mt-1 text-positive">In {fmt(d.income)}</div>
                  <div className="tnum text-accent-2">Out {fmt(d.expense)}</div>
                  <div className="tnum mt-1 font-semibold">Net {formatAmount(d.net.amount, currency, { sign: true })}</div>
                </Tip>
              );
            }}
          />
          <Bar dataKey="inc" radius={[6, 6, 2, 2]} fill="var(--arn-positive)" maxBarSize={26} />
          <Bar dataKey="exp" radius={[6, 6, 2, 2]} fill="var(--omh-accent-2)" maxBarSize={26} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const DONUT = ["var(--omh-accent)", "var(--omh-accent-2)", "var(--arn-info)", "var(--arn-warning)", "var(--arn-positive)", "var(--arn-sage)", "var(--arn-caramel)", "var(--arn-faint)"];

export function Donut({ rows, center }: { rows: { name: string; amount: Money }[]; center?: React.ReactNode }) {
  const data = rows.map((r) => ({ name: r.name, v: n(r.amount), m: r.amount }));
  return (
    <div className="relative h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="v" nameKey="name" innerRadius="66%" outerRadius="92%" paddingAngle={2} stroke="none" cornerRadius={6}>
            {data.map((_, i) => (
              <Cell key={i} fill={DONUT[i % DONUT.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              return (
                <Tip>
                  <div className="text-faint">{d.name}</div>
                  <div className="tnum font-semibold">{fmt(d.m)}</div>
                </Tip>
              );
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {center && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">{center}</div>}
    </div>
  );
}
export const donutColor = (i: number) => DONUT[i % DONUT.length];

export function Ring({ value, size = 64, stroke = 7, tone = "accent", children }: { value: number; size?: number; stroke?: number; tone?: "accent" | "warning" | "danger"; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = tone === "danger" ? "var(--arn-danger)" : tone === "warning" ? "var(--arn-warning)" : "var(--omh-accent)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--arn-surface-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.22,1,.36,1)" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-xs font-semibold">{children}</div>
    </div>
  );
}
