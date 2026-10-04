// Mom mode building blocks: a full page (title + back arrow, no bottom sheets), big buttons, pen colours, and the
// glucose helpers every mom page shares. Big text, few words.
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { cx } from '../../components/ui';
import { formatGlucose } from '../../lib/glucose';
import { relDay } from '../../lib/constants';
import { isEn, locale, t } from '../../i18n';
import type { InjectionSite } from '../../lib/types';

/** The pen colours: NovoRapid orange, Tresiba light green (matched to the pens). */
export const PEN = { rapid: '#F28C28', long: '#8DC63F' } as const;
export const PEN_NAME = { rapid: 'نوفورابيد', long: 'تريسيبا' } as const; // i18n-ok: translated where shown

export const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
export const ago = (ms: number, now = Date.now()) => {
  const m = Math.max(0, Math.round((now - ms) / 60000));
  if (m >= 12 * 60) return `${relDay(new Date(ms))} ${clock(ms)}`;
  return m < 1 ? t('الحين') : t('قبل {d}', { d: span(m) });
};
/** Minutes in words: «43 د», «ساعة», «ساعة و43 د», «ساعتين و5 د», «3 ساعات». */
export const span = (m: number) => {
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return t('{m} د', { m: r });
  const hw = h === 1 ? t('ساعة') : h === 2 ? t('ساعتين') : t('{h} ساعات', { h });
  return r ? t('{h} و{m} د', { h: hw, m: r }) : hw;
};
export const left = (ms: number, now = Date.now()) => {
  const m = Math.max(0, Math.ceil((ms - now) / 60000));
  return span(m);
};
export const glucoseText = (mg: number, unit: 'mmol' | 'mgdl') => formatGlucose(mg, unit);

export function MomPage({ title, back = -1, children, foot }: { title: string; back?: string | number | null; children: ReactNode; foot?: ReactNode }) {
  const nav = useNavigate();
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-[calc(12px+env(safe-area-inset-top))]">
      <header className="mb-3 flex min-h-[48px] items-center gap-3">
        {back !== null && <button aria-label={t('رجوع')} onClick={() => (typeof back === 'number' ? nav(back) : nav(back))} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-2xl shadow-sm">{isEn() ? '←' : '→'}</button>}
        <h1 className="text-[24px] font-bold leading-tight">{title}</h1>
      </header>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
      {foot && <div className="mt-3 space-y-2">{foot}</div>}
    </main>
  );
}

export function Big({ children, onClick, tone = 'primary', disabled, className }: { children: ReactNode; onClick?: () => void; tone?: 'primary' | 'soft' | 'ghost' | 'danger'; disabled?: boolean; className?: string }) {
  const s = { primary: 'bg-brand text-white', soft: 'bg-brand-soft text-brand', ghost: 'bg-white text-slate-800 border border-slate-200', danger: 'bg-over text-white' }[tone];
  return <button disabled={disabled} onClick={onClick} className={cx('min-h-[60px] w-full rounded-2xl px-4 text-[20px] font-bold active:opacity-80 disabled:opacity-40', s, className)}>{children}</button>;
}

/** A choice row: picture/emoji, big words, selected tick. */
export function Choice({ icon, label, sub, on, onClick, color }: { icon?: ReactNode; label: ReactNode; sub?: ReactNode; on?: boolean; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} style={color ? { borderColor: color } : undefined}
      className={cx('flex min-h-[64px] w-full items-center gap-3 rounded-2xl border-2 bg-white px-4 py-2 text-start active:opacity-80', on ? 'border-brand bg-brand-soft' : 'border-slate-200')}>
      {icon && <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl text-3xl">{icon}</span>}
      <span className="min-w-0 flex-1"><span className="block text-[19px] font-bold leading-snug"><bdi>{label}</bdi></span>{sub && <span className="block text-sm text-slate-500">{sub}</span>}</span>
      {on && <span className="text-2xl text-brand">✓</span>}
    </button>
  );
}

export function PenBar({ type }: { type: 'rapid' | 'long' }) {
  return <span aria-hidden className="inline-block h-9 w-3 shrink-0 rounded-full" style={{ background: PEN[type] }} />;
}

export const SITE_NAME: Record<InjectionSite, string> = {
  belly_r: 'بطن يمين', belly_l: 'بطن يسار', thigh_r: 'فخذ يمين', thigh_l: 'فخذ يسار', arm_r: 'ذراع يمين', arm_l: 'ذراع يسار', buttock_r: 'مقعدة يمين', buttock_l: 'مقعدة يسار', // i18n-ok
};

/** Body (front, as you face her: her right on your left) with the sites; tap a site to choose it. */
export function BodyMap({ allowed, last, suggest, sel, onPick, now }: { allowed: InjectionSite[]; last: Map<InjectionSite, number>; suggest: InjectionSite | null; sel: InjectionSite | null; onPick: (s: InjectionSite) => void; now: number }) {
  const Z: Partial<Record<InjectionSite, [number, number, number, number]>> = {
    arm_r: [52, 112, 30, 64], arm_l: [218, 112, 30, 64], belly_r: [106, 146, 42, 52], belly_l: [152, 146, 42, 52], thigh_r: [106, 226, 40, 74], thigh_l: [154, 226, 40, 74],
  };
  const when = (s: InjectionSite) => { const t0 = last.get(s); if (t0 === undefined) return ''; const d = Math.floor((now - t0) / 86400000); return d <= 0 ? t('اليوم') : d === 1 ? t('أمس') : t('{n} أيام', { n: d }); };
  return (
    <svg viewBox="0 0 300 330" className="w-full" role="img" aria-label={t('أماكن الإبرة')}>
      <circle cx="150" cy="52" r="30" fill="#f3e1d4" />
      <rect x="100" y="88" width="100" height="132" rx="34" fill="#f3e1d4" />
      <rect x="54" y="96" width="34" height="110" rx="17" fill="#f3e1d4" transform="rotate(8 71 96)" />
      <rect x="212" y="96" width="34" height="110" rx="17" fill="#f3e1d4" transform="rotate(-8 229 96)" />
      <rect x="104" y="210" width="44" height="112" rx="20" fill="#f3e1d4" />
      <rect x="152" y="210" width="44" height="112" rx="20" fill="#f3e1d4" />
      {(Object.keys(Z) as InjectionSite[]).filter((s) => allowed.includes(s)).map((s) => {
        const [x, y, w, h] = Z[s]!;
        const recent = last.has(s) && now - last.get(s)! < 2 * 86400000;
        const fill = s === sel ? '#5b48d6' : s === suggest ? '#dcf4e8' : recent ? '#fde3e5' : '#ece5fd';
        const stroke = s === sel ? '#5b48d6' : s === suggest ? '#1f8a5b' : '#b9a8f0';
        return (
          <g key={s} onClick={() => onPick(s)} style={{ cursor: 'pointer' }}>
            <rect x={x} y={y} width={w} height={h} rx="12" fill={fill} stroke={stroke} strokeWidth={s === suggest || s === sel ? 3 : 1.5} />
            <text x={x + w / 2} y={y + h / 2 + 5} fontSize="12" fontWeight="700" textAnchor="middle" fill={s === sel ? '#fff' : '#231b3d'}>{s === suggest && s !== sel ? '⭐' : when(s)}</text>
          </g>
        );
      })}
      <text x="40" y="18" fontSize="12" fill="#8a84a0" textAnchor="middle">{t('يمينها')}</text>
      <text x="260" y="18" fontSize="12" fill="#8a84a0" textAnchor="middle">{t('يسارها')}</text>
    </svg>
  );
}
