import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Primary({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-full rounded-md bg-text px-3 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted ${className}`}
      {...props}
    />
  );
}

export function AmountField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  balance?: string;
  onMax?: () => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs text-muted">
        {props.label}
        {props.balance !== undefined && (
          <button type="button" className="font-mono hover:text-text" onClick={props.onMax}>
            Max {props.balance}
          </button>
        )}
      </span>
      <input
        inputMode="decimal"
        placeholder={props.note ?? "0.0"}
        value={props.disabled ? "" : props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded-md border border-line bg-ink px-3 py-2 font-mono text-sm disabled:opacity-60"
      />
    </label>
  );
}

export function Toggle(props: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--color-usdc)]"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.label}
    </label>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`font-mono text-lg ${tone ?? ""}`}>{value}</dd>
    </div>
  );
}
