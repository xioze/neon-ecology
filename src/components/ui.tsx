/**
 * Shared presentational primitives for the NEON//ECOLOGY UI.
 * No domain mutation happens here: every form calls back into the caller,
 * which is responsible for invoking the real simulation store.
 */
import type { CSSProperties, ReactNode } from "react";
import { RESOURCE_LABELS } from "../shared/constants";
import { formatMoney } from "../shared/format";
import type { BuildingInventory } from "../shared/types";

export type Tone = "good" | "warn" | "bad" | "neutral" | "cyan" | "magenta" | "purple" | "blue" | "gold";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Returns null when the field is empty or not a finite number, so forms can block NaN. */
export function parseNumberInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function formatSigned(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `${rounded}`;
  return "±0";
}

export function validateNumberRange(
  raw: string,
  label: string,
  min: number,
  max: number,
  integer = false,
): { value: number | null; error: string | null } {
  const value = parseNumberInput(raw);
  if (value === null) return { value: null, error: `${label}必须是有效数字。` };
  if (integer && !Number.isInteger(value)) return { value: null, error: `${label}必须是整数。` };
  if (value < min || value > max) return { value: null, error: `${label}必须在 ${min} 到 ${max} 之间。` };
  return { value, error: null };
}

export function toneForScore(value: number, goodAt = 62, warnAt = 40): Tone {
  if (value >= goodAt) return "good";
  if (value >= warnAt) return "warn";
  return "bad";
}

export function toneForInverse(value: number, goodBelow = 38, warnBelow = 60): Tone {
  if (value <= goodBelow) return "good";
  if (value <= warnBelow) return "warn";
  return "bad";
}

export interface SectionProps {
  title: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function PanelSection({ title, hint, right, children, className, id }: SectionProps) {
  return (
    <section className={cx("ui-section", className)} id={id}>
      <header className="ui-section-head">
        <h4 className="ui-section-title">{title}</h4>
        {hint ? <span className="ui-section-hint">{hint}</span> : null}
        {right ? <div className="ui-section-right">{right}</div> : null}
      </header>
      <div className="ui-section-body">{children}</div>
    </section>
  );
}

export function MetricBar({
  label,
  value,
  max = 100,
  display,
  tone = "neutral",
  title,
  compact = false,
}: {
  label: ReactNode;
  value: number;
  max?: number;
  display?: ReactNode;
  tone?: Tone;
  title?: string;
  compact?: boolean;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const percent = clampNumber((safeValue / max) * 100, 0, 100);
  return (
    <div className={cx("metric-bar", `tone-${tone}`, compact && "is-compact")} title={title}>
      <div className="metric-bar-head">
        <span className="metric-bar-label">{label}</span>
        <span className="metric-bar-value">{display ?? `${Math.round(safeValue)}%`}</span>
      </div>
      <div className="metric-track">
        <div className="metric-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function Tag({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <span className={cx("tag", `tag-${tone}`)} title={title}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className={cx("stat", tone && `tone-${tone}`)} title={hint}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export function DataRow({
  label,
  children,
  title,
  mono = false,
}: {
  label: ReactNode;
  children: ReactNode;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div className="data-row" title={title}>
      <span className="data-row-label">{label}</span>
      <span className={cx("data-row-value", mono && "mono")}>{children}</span>
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return <p className="empty-hint">{children}</p>;
}

export function ObserveNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="observe-notice" role="note">
      <span className="observe-notice-mark">观察模式</span>
      <span>{children ?? "只读视图。切换到「干预」模式后才能提交造物主编辑。"}</span>
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  invalid = false,
  wide = false,
  className,
}: {
  label?: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  invalid?: boolean;
  wide?: boolean;
  className?: string;
}) {
  return (
    <label className={cx("field", wide && "field-wide", invalid && "is-invalid", className)}>
      {label ? <span className="field-label">{label}</span> : null}
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  disabled = false,
  hint,
  wide = false,
  invalid = false,
}: {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  hint?: ReactNode;
  wide?: boolean;
  invalid?: boolean;
}) {
  return (
    <Field label={label} hint={hint} wide={wide} invalid={invalid}>
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  maxLength,
  disabled = false,
  hint,
  wide = true,
  invalid = false,
}: {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  hint?: ReactNode;
  wide?: boolean;
  invalid?: boolean;
}) {
  return (
    <Field label={label} hint={hint} wide={wide} invalid={invalid}>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  placeholder,
  disabled = false,
  hint,
  wide = false,
  invalid = false,
}: {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  hint?: ReactNode;
  wide?: boolean;
  invalid?: boolean;
}) {
  return (
    <Field label={label} hint={hint} wide={wide} invalid={invalid}>
      <span className="field-input-combo">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix ? <span className="field-suffix">{suffix}</span> : null}
      </span>
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
  hint,
  wide = false,
  invalid = false,
}: {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  hint?: ReactNode;
  wide?: boolean;
  invalid?: boolean;
}) {
  return (
    <Field label={label} hint={hint} wide={wide} invalid={invalid}>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ColorField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <span className="field-color-combo">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#5af2d0"}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className="mono field-color-code">{value}</span>
      </span>
    </Field>
  );
}

export function ImportanceDots({ value }: { value: number }) {
  const safe = clampNumber(Math.round(value), 0, 10);
  return (
    <span className="importance-dots" title={`重要度 ${safe}/10`} aria-label={`重要度 ${safe}/10`}>
      {Array.from({ length: 10 }, (_, index) => (
        <i key={index} className={index < safe ? "is-on" : undefined} />
      ))}
    </span>
  );
}

export const INVENTORY_ORDER: Array<keyof BuildingInventory> = ["credits", "food", "energy", "meds"];

export function InventoryRows({
  inventory,
  onAdjust,
  disabled = false,
}: {
  inventory: BuildingInventory;
  onAdjust: (key: keyof BuildingInventory, delta: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inventory-rows">
      {INVENTORY_ORDER.map((key) => (
        <div className="inventory-row" key={key}>
          <span className="inventory-label">{RESOURCE_LABELS[key]}</span>
          <span className="inventory-value mono">{formatMoney(inventory[key])}</span>
          <span className="inventory-actions">
            {[-10, -1, 1, 10].map((delta) => (
              <button
                key={delta}
                type="button"
                className={cx("btn", "btn-tiny", delta < 0 ? "btn-ghost" : "btn-ghost")}
                disabled={disabled}
                onClick={() => onAdjust(key, delta)}
              >
                {delta > 0 ? `+${delta}` : delta}
              </button>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function InlineMeter({
  value,
  max = 100,
  tone = "cyan",
  style,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  style?: CSSProperties;
}) {
  const percent = clampNumber((Number.isFinite(value) ? value : 0) / max * 100, 0, 100);
  return (
    <span className={cx("inline-meter", `tone-${tone}`)} style={style}>
      <i style={{ width: `${percent}%` }} />
    </span>
  );
}
