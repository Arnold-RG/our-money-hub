"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getPortal, useDialog } from "@/lib/use-dialog";
import { useIsDesktop, useVisualViewportBox } from "@/lib/visual-viewport";

export const cx = clsx;

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card p-5 sm:p-6", className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-pretty text-muted">{hint}</p>}
      </div>
      {action ? <div className="header-actions sm:w-auto">{action}</div> : null}
    </div>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md"; icon?: React.ReactNode }
>(function Button({ variant = "primary", size = "md", icon, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[transform,background,color,box-shadow] duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-9 px-3.5 text-xs" : "h-11 px-5 text-sm",
        variant === "primary" && "bg-accent text-accent-ink shadow-[0_8px_24px_-10px_var(--omh-accent)] hover:brightness-110",
        variant === "secondary" && "border border-line-strong bg-surface-2 text-ink hover:bg-surface-3",
        variant === "ghost" && "text-muted hover:bg-surface-2 hover:text-ink",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "positive" | "warning" | "danger" | "info" | "accent"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-3 text-muted",
        tone === "positive" && "bg-positive/15 text-positive",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "danger" && "bg-danger/15 text-danger",
        tone === "info" && "bg-info/15 text-info",
        tone === "accent" && "bg-accent/15 text-accent",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

const inputCls =
  "h-11 w-full rounded-xl border border-line bg-surface-2 px-3.5 text-[15px] text-ink placeholder:text-faint outline-none transition focus:border-accent/60 focus:bg-surface focus:ring-4 focus:ring-accent/10";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(inputCls, className)} {...rest} />;
});

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(inputCls, "appearance-none bg-[length:12px] bg-[right_14px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' stroke='%23999' stroke-width='1.6' fill='none'/></svg>\")" }} {...rest}>
      {children}
    </select>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "md" }: { value: T; options: { value: T; label: React.ReactNode }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("relative inline-flex rounded-full border border-line bg-surface-2 p-1", size === "sm" ? "text-xs" : "text-sm")}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx("relative z-10 rounded-full font-medium transition-colors", size === "sm" ? "h-9 px-3" : "h-10 px-4", active ? "text-accent-ink" : "text-muted hover:text-ink")}
          >
            {active && <motion.span layoutId={`seg-${label}`} className="absolute inset-0 -z-10 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const isDesktop = useIsDesktop();
  const vv = useVisualViewportBox();
  useEffect(() => setMounted(true), []);
  useDialog(ref, open, onClose, getPortal);
  const titleId = useId();
  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-6"
          style={!isDesktop && vv.height ? { top: vv.top, height: vv.height, bottom: "auto" } : undefined}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cx("glass-solid relative w-full overflow-y-auto rounded-t-[28px] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:rounded-[28px] sm:max-h-[92dvh]", wide ? "sm:max-w-2xl" : "sm:max-w-lg")}
            style={!isDesktop && vv.height ? { maxHeight: vv.height } : undefined}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
            <div className="mb-5 flex items-center justify-between">
              <h2 id={titleId} className="display text-xl">{title}</h2>
              <button onClick={onClose} className="grid size-11 place-items-center rounded-full text-muted hover:bg-surface-3 hover:text-ink" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    getPortal()!,
  );
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-[22px] border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="grid-bg absolute inset-0 opacity-70" aria-hidden />
      <div className="relative mb-3 grid size-12 place-items-center rounded-2xl bg-accent/12 text-accent">{icon}</div>
      <p className="relative text-[15px] font-semibold">{title}</p>
      <p className="relative mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="relative mt-5">{action}</div>}
    </div>
  );
}

export function Progress({ value, tone = "accent", label }: { value: number; tone?: "accent" | "warning" | "danger"; label: string }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className={cx("h-full rounded-full", tone === "accent" && "bg-accent", tone === "warning" && "bg-[var(--bar-warning)]", tone === "danger" && "bg-danger")}
        initial={{ width: 0 }}
        animate={{ width: `${w}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("rounded-xl bg-surface-3/70", className)} />;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
}
