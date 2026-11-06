"use client";

import { useId, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Primary({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-full rounded-lg px-3 py-3 text-sm font-semibold hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-raised disabled:text-muted disabled:hover:brightness-100 brand ${className}`}
      {...props}
    />
  );
}

export function AmountField(props: {
  label: string;
  value: string;
  token?: string;
  dot?: string;
  /** Without it the field is read-only. */
  onChange?: (value: string) => void;
  balance?: string;
  onMax?: () => void;
  onHalf?: () => void;
  disabled?: boolean;
  note?: string;
}) {
  const id = useId();
  return (
    <div className={`rounded-lg border border-line bg-ink px-3 py-2 focus-within:border-accent ${props.disabled ? "opacity-50" : ""}`}>
      <div className="mb-0.5 flex items-center justify-between text-xs text-muted">
        <label htmlFor={id}>{props.label}</label>
        <span className="flex items-center gap-2 font-mono">
          {props.balance !== undefined && props.onHalf && (
            <button type="button" className="hover:text-text" disabled={props.disabled} onClick={props.onHalf}>
              50%
            </button>
          )}
          {props.balance !== undefined &&
            (props.onMax ? (
              <button type="button" className="hover:text-text" disabled={props.disabled} onClick={props.onMax}>
                Max {props.balance}
              </button>
            ) : (
              <span>Balance {props.balance}</span>
            ))}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          inputMode="decimal"
          placeholder={props.note ?? "0.0"}
          value={props.disabled ? "" : props.value}
          disabled={props.disabled}
          readOnly={!props.onChange}
          onChange={(e) => props.onChange?.(e.target.value)}
          className={`w-full min-w-0 flex-1 bg-transparent font-mono outline-none ${props.note ? "text-sm" : "text-lg"}`}
        />
        {props.token && (
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <i className={`h-2.5 w-2.5 rounded-full ${props.dot}`} />
            {props.token}
          </span>
        )}
      </div>
    </div>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent"
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

export function PairIcon() {
  return (
    <span className="flex" aria-hidden>
      <i className="grid h-6.5 w-6.5 place-items-center rounded-full border-2 border-panel bg-weth font-mono text-[10px] font-semibold text-ink not-italic">
        W
      </i>
      <i className="-ml-2 grid h-6.5 w-6.5 place-items-center rounded-full border-2 border-panel bg-usdc font-mono text-[10px] font-semibold text-ink not-italic">
        U
      </i>
    </span>
  );
}

export const FlipIcon = ({ size = 17 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 4v16M7 4 3 8M7 4l4 4" />
    <path d="M17 20V4M17 20l4-4M17 20l-4-4" />
  </svg>
);

export const LoopIcon = ({ size = 19 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M20 11a8 8 0 0 0-14.3-4.3L3 9.5" />
    <path d="M3 4v5.5h5.5" />
    <path d="M4 13a8 8 0 0 0 14.3 4.3L21 14.5" />
    <path d="M21 20v-5.5h-5.5" />
  </svg>
);

export const AimIcon = ({ size = 19 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </svg>
);
