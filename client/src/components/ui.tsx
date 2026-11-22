import clsx from 'clsx';
import { LoaderCircle, Lock, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { congestionLevel } from '../../../shared/types';
import { LEVEL_LABEL } from '../lib/format';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]', className)}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={clsx('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
            <Icon className="size-4" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('px-5 py-4', className)}>{children}</div>;
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'navy';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
  navy: 'bg-navy-900 text-white hover:bg-navy-800 shadow-sm',
  secondary: 'border border-line bg-white text-ink hover:bg-navy-50',
  ghost: 'text-navy-700 hover:bg-navy-50',
  danger: 'bg-jam text-white hover:bg-red-700 shadow-sm',
  success: 'bg-free text-white hover:bg-green-700 shadow-sm',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: 'sm' | 'md' = 'md'): string {
  return clsx(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
    BUTTON_VARIANTS[variant],
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <button
      className={clsx(buttonClass(variant, size), className)}
      disabled={disabled || loading}
      type="button"
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : Icon ? <Icon className="size-4" /> : null}
      {children}
    </button>
  );
}

export type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'orange' | 'red' | 'navy' | 'sky';

const TONES: Record<Tone, string> = {
  neutral: 'bg-navy-50 text-muted ring-line',
  blue: 'bg-brand-50 text-brand-700 ring-brand-100',
  navy: 'bg-navy-900 text-white ring-navy-900',
  green: 'bg-green-50 text-green-700 ring-green-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-subtle',
  blue: 'bg-brand-500',
  navy: 'bg-white',
  green: 'bg-free',
  amber: 'bg-moderate',
  orange: 'bg-heavy',
  red: 'bg-jam',
  sky: 'bg-sky-500',
};

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', TONES[tone], className)}>
      {dot && <span className={clsx('size-1.5 rounded-full', DOTS[tone])} />}
      {children}
    </span>
  );
}

const LEVEL_TONE = { free: 'green', moderate: 'amber', heavy: 'orange', congested: 'red' } as const;

export function LevelBadge({ score }: { score: number }) {
  const level = congestionLevel(score);
  return (
    <Badge tone={LEVEL_TONE[level]} dot>
      {LEVEL_LABEL[level]}
    </Badge>
  );
}

const STAT_TONES: Record<string, string> = {
  blue: 'bg-brand-50 text-brand-600',
  red: 'bg-red-50 text-jam',
  green: 'bg-green-50 text-free',
  amber: 'bg-amber-50 text-amber-600',
  navy: 'bg-navy-100 text-navy-800',
  sky: 'bg-sky-50 text-sky-600',
};

export function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon: LucideIcon;
  tone?: keyof typeof STAT_TONES;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{label}</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight text-ink">{value}</p>
        </div>
        <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl', STAT_TONES[tone])}>
          <Icon className="size-5" />
        </span>
      </div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-lg bg-navy-50 p-0.5 ring-1 ring-line ring-inset">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-[13px]',
            o.value === value ? 'bg-white text-navy-900 shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-line bg-white px-3 text-sm text-ink placeholder:text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-100 focus:outline-none disabled:bg-navy-50 disabled:text-muted';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(CONTROL, 'h-10', props.className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx(CONTROL, 'h-10 pr-8', className)}>
      {children}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(CONTROL, 'min-h-24 py-2', props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-navy-200',
        )}
      >
        <span className={clsx('absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
      </button>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('skeleton rounded-md', className)} />;
}

export function SkeletonGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-navy-50 text-navy-500">
        <Icon className="size-6" />
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, color, className }: { value: number; color?: string; className?: string }) {
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-navy-50', className)}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color ?? 'var(--color-brand-600)' }} />
    </div>
  );
}

export function Restricted({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState icon={Lock} title={`${what} isn't available for this role`} description="Switch role from the top bar to see this part of the platform." />
    </Card>
  );
}

export const TH = 'px-4 py-2.5 text-left text-xs font-semibold tracking-wide text-muted uppercase';
export const TD = 'px-4 py-3 text-sm text-ink';
