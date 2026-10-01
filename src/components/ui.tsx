import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { fmt, type Level } from '../lib/carbs';
import { emojiFor } from '../lib/constants';
import { photoUrl } from '../lib/supabase';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

// ── toast ───────────────────────────────────────────────────────────────────
export const toast = (msg: string) => window.dispatchEvent(new CustomEvent('kc-toast', { detail: msg }));
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: number;
    const on = (e: Event) => { setMsg((e as CustomEvent).detail); window.clearTimeout(t); t = window.setTimeout(() => setMsg(null), 2600); };
    window.addEventListener('kc-toast', on);
    return () => window.removeEventListener('kc-toast', on);
  }, []);
  if (!msg) return null;
  return <div role="status" className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-sm rounded-2xl bg-slate-900 px-4 py-3 text-center text-white shadow-lg">{msg}</div>;
}

// ── basics ──────────────────────────────────────────────────────────────────
export function Page({ title, back, action, children }: { title: string; back?: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-4">
      <header className="mb-4 flex items-center gap-3">
        {back && <button onClick={back} aria-label="رجوع" className="grid h-10 w-10 place-items-center rounded-full bg-white text-xl shadow-sm">→</button>}
        <h1 className="flex-1 text-2xl font-bold">{title}</h1>
        {action}
      </header>
      {children}
    </main>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) =>
  <section className={cx('rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100', className)}>{children}</section>;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' | 'soft'; block?: boolean };
export function Btn({ kind = 'soft', block, className, ...p }: BtnProps) {
  const styles = {
    primary: 'bg-brand text-white active:opacity-80',
    soft: 'bg-brand-soft text-brand active:opacity-80',
    ghost: 'bg-white text-slate-700 ring-1 ring-slate-200 active:bg-slate-50',
    danger: 'bg-over-soft text-over active:opacity-80',
  }[kind];
  return <button {...p} className={cx('min-h-[44px] rounded-xl px-4 py-2 text-base font-medium disabled:opacity-40', styles, block && 'w-full', className)} />;
}

export function Alert({ tone = 'near', children }: { tone?: 'near' | 'over' | 'ok' | 'info'; children: ReactNode }) {
  const t = { near: 'bg-near-soft text-near', over: 'bg-over-soft text-over', ok: 'bg-ok-soft text-ok', info: 'bg-brand-soft text-brand' }[tone];
  return <div role="alert" className={cx('rounded-xl px-3 py-2 text-sm leading-relaxed', t)}>{children}</div>;
}

export const Chip = ({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) =>
  <button onClick={onClick} className={cx('shrink-0 rounded-full px-3 py-1.5 text-sm', active ? 'bg-brand text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>{children}</button>;

export const Badge = ({ tone = 'gray', children }: { tone?: 'gray' | 'ok' | 'near' | 'over' | 'brand'; children: ReactNode }) => {
  const t = { gray: 'bg-slate-100 text-slate-600', ok: 'bg-ok-soft text-ok', near: 'bg-near-soft text-near', over: 'bg-over-soft text-over', brand: 'bg-brand-soft text-brand' }[tone];
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
};

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-ok' : 'bg-slate-300')}>
      <span className={cx('absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all', on ? 'start-0.5' : 'start-[1.375rem]')} />
    </button>
  );
}

/** Layan asset pack (public/assets). Relative to the page, so it works under any sub-path. */
export const asset = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

const FOOD_ART: Record<string, string> = { meal: '05_food/food_meal.svg', cereal: '05_food/food_cereal.svg', snack: '05_food/food_snack.svg', juice: '05_food/food_juice.svg' };

/** The user's photo if there is one; otherwise Layan food art (recipes, snacks) or the category emoji (products). */
export function Photo({ path, category, className, art }: { path?: string | null; category?: string | null; className?: string; art?: keyof typeof FOOD_ART }) {
  const url = photoUrl(path);
  if (url) return <img src={url} alt="" loading="lazy" className={cx('object-cover', className)} />;
  return (
    <div aria-hidden className={cx('grid place-items-center bg-brand-soft/60 text-4xl', className)}>
      {art ? <img src={asset(FOOD_ART[art])} alt="" className="h-3/5 max-h-28 w-auto" /> : emojiFor(category)}
    </div>
  );
}
export const recipeArt = (category?: string | null) => (category === 'فطور' ? 'cereal' : 'meal') as 'cereal' | 'meal';
export const snackArt = (name?: string | null) => (name && /عصير|juice/i.test(name) ? 'juice' : 'snack') as 'juice' | 'snack';

// ── carbs ───────────────────────────────────────────────────────────────────
const LEVEL = {
  normal: { cls: 'bg-ok-soft text-ok', text: 'ضمن المعدل' },
  near: { cls: 'bg-near-soft text-near', text: 'قريبة من الحد' },
  over: { cls: 'bg-over-soft text-over', text: 'تتجاوز الحد' },
} as const;

export function CarbBadge({ carbs, level, size = 'md', unknown }: { carbs: number; level: Level; size?: 'md' | 'lg'; unknown?: boolean }) {
  if (unknown) return <span className="rounded-xl bg-slate-100 px-3 py-1 text-sm text-slate-500">كارب غير مكتمل</span>;
  return (
    <span className={cx('inline-flex items-baseline gap-1 rounded-xl px-3 py-1 font-bold', LEVEL[level].cls, size === 'lg' ? 'text-4xl' : 'text-2xl')}>
      <span className="num">{fmt(carbs)}</span><span className="text-sm font-medium">غ كارب</span>
    </span>
  );
}
export const levelText = (l: Level) => LEVEL[l].text;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
export const inputCls = 'w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft';

export function NumInput({ value, onChange, ...p }: { value: number | null | undefined; onChange: (v: number | null) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  // keep what is being typed ("1." or "") instead of fighting the cursor
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value || (t === '' && (value === null || value === undefined)) ? t : value === null || value === undefined ? '' : String(value)));
  }, [value]);
  return (
    <input {...p} inputMode="decimal" dir="ltr" className={cx(inputCls, 'text-start num', p.className)} value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.');
        if (!/^\d*\.?\d*$/.test(t)) return;
        setText(t);
        onChange(t === '' || t === '.' ? null : Number(t));
      }} />
  );
}

export function Nutrition({ n, partial }: { n: { carbs: number; fat: number; fiber: number; protein: number; kcal: number }; partial?: boolean }) {
  const cell = (label: string, v: string, unit: string) => (
    <div className="rounded-xl bg-slate-50 p-2 text-center"><div className="num text-lg font-bold">{v}</div><div className="text-xs text-slate-500">{label} <span className="num">{unit}</span></div></div>
  );
  const p = (v: number) => (partial ? '—' : fmt(v));
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {cell('كارب', fmt(n.carbs), 'غ')}{cell('دهون', p(n.fat), 'غ')}{cell('ألياف', p(n.fiber), 'غ')}{cell('بروتين', p(n.protein), 'غ')}{cell('سعرات', partial ? '—' : String(Math.round(n.kcal)), '')}
      </div>
      {partial && <p className="mt-1 text-xs text-slate-500">بعض المكونات ليس لها دهون/ألياف/بروتين/سعرات مسجلة، لذلك لا تُعرض هذه الأرقام حتى لا تكون ناقصة.</p>}
    </div>
  );
}
