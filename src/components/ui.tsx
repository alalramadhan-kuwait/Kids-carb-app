import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { fmt, type Level } from '../lib/carbs';
import { emojiFor } from '../lib/constants';
import { photoUrl } from '../lib/supabase';
import { isEn, t, tr } from '../i18n';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

// ── toast (optionally with one action, e.g. "تراجع") ────────────────────────
type ToastMsg = { text: string; action?: { label: string; run: () => void } };
export const toast = (text: string, action?: ToastMsg['action']) =>
  window.dispatchEvent(new CustomEvent<ToastMsg>('kc-toast', { detail: { text, action } }));
const hideToast = () => window.dispatchEvent(new Event('kc-toast-hide'));
/**
 * At the top of the screen, so it never covers a sheet's buttons. Tap it or its ✕ to close; it also closes by itself
 * and whenever a sheet opens.
 */
export function Toaster() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    let t: number;
    const on = (e: Event) => {
      const m = (e as CustomEvent<ToastMsg>).detail;
      setMsg(m); window.clearTimeout(t);
      t = window.setTimeout(() => setMsg(null), m.action ? 6000 : 2600);
    };
    const off = () => { window.clearTimeout(t); setMsg(null); };
    window.addEventListener('kc-toast', on); window.addEventListener('kc-toast-hide', off);
    return () => { window.removeEventListener('kc-toast', on); window.removeEventListener('kc-toast-hide', off); };
  }, []);
  if (!msg) return null;
  return (
    <div role="status" onClick={() => setMsg(null)} className="fixed inset-x-4 top-[calc(8px+env(safe-area-inset-top))] z-[60] mx-auto flex max-w-sm items-center gap-2 rounded-2xl bg-slate-900 py-2 pe-1.5 ps-4 text-sm text-white shadow-lg">
      <span className="flex-1">{msg.text}</span>
      {msg.action && <button className="min-h-[40px] rounded-xl bg-white/15 px-3 font-bold" onClick={(e) => { e.stopPropagation(); msg.action!.run(); setMsg(null); }}>{msg.action.label}</button>}
      <button aria-label={t('إغلاق')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-white/70" onClick={(e) => { e.stopPropagation(); setMsg(null); }}>✕</button>
    </div>
  );
}

/** Bottom sheet: one task at a time, closes on the backdrop. */
/**
 * The part of the screen the keyboard leaves free. iOS draws the keyboard over a fixed layer, so a sheet sized to the
 * visual viewport stays fully above it (its main action never hides under the keyboard).
 */
export function useVisibleArea() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  const read = () => ({ top: vv?.offsetTop ?? 0, height: vv?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 800) });
  const [area, setArea] = useState(read);
  useEffect(() => {
    if (!vv) return;
    const f = () => setArea(read());
    vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
    return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); };
  }, []);
  return area;
}

/** Dragging the sheet down (from its handle, or anywhere once its content is scrolled to the top) closes it. */
function useSwipeDown(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let y0 = 0, dy = 0, active = false;
    const start = (e: TouchEvent) => { y0 = e.touches[0].clientY; dy = 0; active = el.scrollTop <= 0; el.style.transition = 'none'; };
    const move = (e: TouchEvent) => {
      if (!active) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) { e.preventDefault(); el.style.transform = `translateY(${dy}px)`; }
      else { active = el.scrollTop <= 0 && dy >= 0; el.style.transform = ''; }
    };
    const end = () => {
      el.style.transition = 'transform 180ms ease-out';
      if (active && dy > 90) { el.style.transform = 'translateY(100%)'; window.setTimeout(onClose, 160); }
      else el.style.transform = '';
      active = false;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end); el.addEventListener('touchcancel', end);
    return () => { el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end); };
  });
  return ref;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const area = useVisibleArea();
  const panel = useSwipeDown(onClose);
  useEffect(() => { if (open) hideToast(); }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-x-0 z-50 flex items-end justify-center bg-black/40" style={{ top: area.top, height: area.height }} onClick={onClose}>
      <div ref={panel} role="dialog" aria-label={title} className="w-full max-w-2xl overflow-y-auto overscroll-contain rounded-t-[22px] bg-white px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-2" style={{ maxHeight: area.height - 24, touchAction: 'pan-y' }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label={t('إغلاق')} className="mx-auto mb-1 flex h-6 w-16 items-center justify-center"><span className="h-1.5 w-10 rounded-full bg-slate-200" /></button>
        <h2 className="mb-2 text-lg font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ── basics ──────────────────────────────────────────────────────────────────
export function Page({ title, back, action, children }: { title: string; back?: () => void; action?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-3">
      <header className="mb-3 flex items-center gap-3">
        {back && <button onClick={back} aria-label={t('رجوع')} className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm">{isEn() ? '←' : '→'}</button>}
        <h1 className="flex-1 text-[22px] font-bold tracking-tight">{title}</h1>
        {action}
      </header>
      {children}
    </main>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) =>
  <section className={cx('rounded-2xl border border-slate-100 bg-white p-3.5 shadow-sm', className)}>{children}</section>;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'ghost' | 'danger' | 'soft'; block?: boolean };
export function Btn({ kind = 'soft', block, className, ...p }: BtnProps) {
  const styles = {
    primary: 'bg-brand text-white active:opacity-80',
    soft: 'bg-brand-soft text-brand active:opacity-80',
    ghost: 'bg-slate-50 text-slate-700 active:bg-slate-100',
    danger: 'bg-over-soft text-over active:opacity-80',
  }[kind];
  return <button {...p} className={cx('min-h-[44px] rounded-2xl px-4 py-2 text-base font-semibold disabled:opacity-40', styles, block && 'w-full', className)} />;
}

export function Alert({ tone = 'near', children }: { tone?: 'near' | 'over' | 'ok' | 'info'; children: ReactNode }) {
  // not glucose: neutral boxes whose words carry the meaning; the side bar marks how much attention it needs
  const t = { near: 'bg-white text-slate-800 border-s-4 border-brand-muted ring-1 ring-slate-100', over: 'bg-white font-medium text-slate-800 border-s-4 border-brand ring-1 ring-slate-100', ok: 'bg-brand-soft text-brand', info: 'bg-brand-soft text-brand' }[tone];
  return <div role="alert" className={cx('rounded-xl px-3 py-2 text-sm leading-relaxed', t)}>{children}</div>;
}

export const Chip = ({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: ReactNode }) =>
  <button onClick={onClick} className={cx('min-h-[36px] shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium', active ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600')}>{children}</button>;

export const Badge = ({ tone = 'gray', children }: { tone?: 'gray' | 'ok' | 'near' | 'over' | 'brand'; children: ReactNode }) => {
  const t = { gray: 'bg-slate-100 text-slate-600', ok: 'bg-brand-soft text-brand', near: 'bg-slate-100 text-slate-700', over: 'bg-white text-slate-800 ring-1 ring-inset ring-brand', brand: 'bg-brand-soft text-brand' }[tone];
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
};

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', on ? 'bg-brand' : 'bg-slate-300')}>
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
export const recipeArt = (category?: string | null) => (category === 'فطور' ? 'cereal' : 'meal') as 'cereal' | 'meal'; // i18n-ok: stored category
export const snackArt = (name?: string | null) => (name && /عصير|juice/i.test(name) ? 'juice' : 'snack') as 'juice' | 'snack'; // i18n-ok

// ── carbs ───────────────────────────────────────────────────────────────────
const LEVEL = {
  // red, green and amber belong to glucose only (DESIGN_SYSTEM §3): carbs stay neutral; over the limit is outlined
  // and always says so in words where it matters (recipe view, logging confirmation)
  normal: tr({ cls: 'bg-brand-soft text-brand-num', text: 'ضمن المعدل' }), // i18n-ok
  near: tr({ cls: 'bg-brand-soft text-brand-num', text: 'قريبة من الحد' }), // i18n-ok
  over: tr({ cls: 'bg-white text-brand-num ring-2 ring-inset ring-brand', text: 'تتجاوز الحد' }), // i18n-ok
} as const;

export function CarbBadge({ carbs, level, size = 'md', unknown }: { carbs: number; level: Level; size?: 'sm' | 'md' | 'lg'; unknown?: boolean }) {
  if (unknown) return <span className="rounded-xl bg-slate-100 px-3 py-1 text-sm text-slate-500">{t('كارب غير مكتمل')}</span>;
  return (
    <span className={cx('inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap rounded-xl font-bold', LEVEL[level].cls,
      size === 'lg' ? 'px-3 py-1 text-4xl' : size === 'sm' ? 'px-2 py-0.5 text-lg' : 'px-3 py-1 text-2xl')}>
      <span className="num">{fmt(carbs)}</span><span className="whitespace-nowrap text-sm font-medium">{t('غ كارب')}</span>
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
export const inputCls = 'w-full min-h-[44px] rounded-2xl border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft';

export function NumInput({ value, onChange, ...p }: { value: number | null | undefined; onChange: (v: number | null) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  // keep what is being typed ("1." or "") instead of fighting the cursor
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  useEffect(() => {
    setText((t) => (Number(t) === value || (t === '' && (value === null || value === undefined)) ? t : value === null || value === undefined ? '' : String(value)));
  }, [value]);
  return (
    <input {...p} inputMode="decimal" dir="ltr" className={cx(inputCls, 'text-start num', p.className)} value={text}
      onChange={(e) => {
        const t = e.target.value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.'); // i18n-ok: Arabic digits typed
        if (!/^\d*\.?\d*$/.test(t)) return;
        setText(t);
        onChange(t === '' || t === '.' ? null : Number(t));
      }} />
  );
}

/** `missing`: the totals some ingredient has no figure for; only those show «—». (`partial`: all four, the old way.) */
export function Nutrition({ n, partial, missing }: { n: { carbs: number; fat: number; fiber: number; protein: number; kcal: number }; partial?: boolean; missing?: Partial<Record<'fat' | 'fiber' | 'protein' | 'kcal', boolean>> }) {
  const cell = (label: string, v: string, unit: string) => (
    <div className="rounded-xl bg-slate-50 p-2 text-center"><div className="num text-lg font-bold">{v}</div><div className="text-xs text-slate-500">{label} <span className="num">{unit}</span></div></div>
  );
  const gone = (k: 'fat' | 'fiber' | 'protein' | 'kcal') => (missing ? !!missing[k] : !!partial);
  const p = (v: number, k: 'fat' | 'fiber' | 'protein') => (gone(k) ? '—' : fmt(v));
  const any = missing ? Object.values(missing).some(Boolean) : !!partial;
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {cell(t('كارب'), fmt(n.carbs), t('غ'))}{cell(t('دهون'), p(n.fat, 'fat'), t('غ'))}{cell(t('ألياف'), p(n.fiber, 'fiber'), t('غ'))}{cell(t('بروتين'), p(n.protein, 'protein'), t('غ'))}{cell(t('سعرات'), gone('kcal') ? '—' : String(Math.round(n.kcal)), '')}
      </div>
      {any && <p className="mt-1 text-xs text-slate-500">{t('«—»: أحد المكونات بلا هذا الرقم في ملصقه.')}</p>}
    </div>
  );
}
