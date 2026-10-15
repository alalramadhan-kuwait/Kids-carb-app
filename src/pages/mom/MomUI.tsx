// Mom mode building blocks: a full page (title + back arrow, no bottom sheets), big buttons, pen colours, and the
// glucose helpers every mom page shares. Big text, few words.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { draftOps } from '../../lib/mom';
import { useLocation, useNavigate } from 'react-router-dom';
import { asset, cx } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { IconName } from '../../icons/defs';
import { formatGlucose } from '../../lib/glucose';
import { relDay } from '../../lib/constants';
import { isEn, locale, t } from '../../i18n';
import type { InjectionSite } from '../../lib/types';

/** The pen colours: NovoRapid orange, Tresiba light green (matched to the pens). */
export const PEN = { rapid: '#F28C28', long: '#8DC63F' } as const;
export const PEN_NAME = { rapid: 'نوفورابيد', long: 'تريسيبا' } as const; // i18n-ok: translated where shown

export const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
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

export function MomPage({ title, back = -1, children, foot, tabs, top, compact, keyboard }: { title: string; back?: string | number | null; children: ReactNode; foot?: ReactNode; tabs?: boolean; /** stays under the title while the page scrolls (a search box) */ top?: ReactNode;
  /** the add-meal pages: a slightly smaller title and tighter rows, so more of the list shows */ compact?: boolean;
  /** a page searched with the phone's keyboard: room under the list for the keyboard, and dragging the list puts the keyboard away */ keyboard?: boolean }) {
  const nav = useNavigate();
  const scroller = useKeptScroll();
  const kb = useKeyboardHeight(!!keyboard);
  return (
    <main className="mx-auto flex h-[100dvh] max-w-md flex-col">
      {/* the title and back arrow stay put below the phone's clock/camera; the page scrolls under them, the buttons stay at the bottom */}
      <header className={cx('flex min-h-[48px] shrink-0 items-center gap-3 px-4 pt-[calc(12px+env(safe-area-inset-top))]', compact ? 'pb-2' : 'pb-3')}>
        {back !== null && <button aria-label={t('رجوع')} onClick={() => (typeof back === 'number' ? nav(back) : nav(back))} className={cx('grid shrink-0 place-items-center rounded-full bg-white shadow-sm', compact ? 'h-11 w-11 text-xl' : 'h-12 w-12 text-2xl')}>{isEn() ? '←' : '→'}</button>}
        <h1 className={cx('min-w-0 font-bold leading-tight', compact ? 'text-[21px]' : 'text-[24px]')}><bdi>{title}</bdi></h1>
      </header>
      {top && <div className="shrink-0 px-4 pb-2">{top}</div>}
      <div ref={scroller.ref} onScroll={scroller.onScroll} onTouchMove={keyboard ? putKeyboardAway : undefined} className={cx('flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4', compact ? 'gap-2' : 'gap-3', tabs && !foot ? TABS_PAD : !foot && 'pb-[calc(16px+env(safe-area-inset-bottom))]')}>{children}{kb > 0 && <div aria-hidden className="shrink-0" style={{ height: kb }} />}</div>
      {/* with the tabs, the buttons sit just above them */}
      {foot && <div className={cx('shrink-0 space-y-2 px-4 pt-3', tabs ? TABS_PAD : 'pb-[calc(16px+env(safe-area-inset-bottom))]')}>{foot}</div>}
    </main>
  );
}

/** How much of the screen the phone's keyboard covers (iPhone: the keyboard lies over the page, which keeps its
 *  height), from the visual viewport; 0 when it is closed or the browser does not say. */
function useKeyboardHeight(on: boolean) {
  const [h, setH] = useState(0);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!on || !vv) return;
    const read = () => setH(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    read();
    vv.addEventListener('resize', read); vv.addEventListener('scroll', read);
    return () => { vv.removeEventListener('resize', read); vv.removeEventListener('scroll', read); };
  }, [on]);
  return h > 80 ? h : 0; // small changes are the browser's bars, not a keyboard
}
/** Dragging the list closes the keyboard, so the results under it can be reached. */
const putKeyboardAway = () => { const a = document.activeElement; if (a instanceof HTMLInputElement) a.blur(); };

/** Starting a meal of the other kind (now / plan), or putting another meal on the plate, replaces the one being built:
 *  asked first when it has food on it. False when she keeps it. */
export function okToReplace(mode?: 'now' | 'plan'): boolean {
  const d = draftOps.get();
  if (!d.items.length || (mode && d.mode === mode)) return true;
  return window.confirm(t('في وجبة ما خلصت ({n} صنف). تمسحينها وتبدين من جديد؟', { n: d.items.length }));
}

/** The page's scroll position, kept per history entry (the page scrolls inside its own box, which the browser does
 *  not restore): coming Back to a list puts it where she left it. */
function useKeptScroll() {
  const { key } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  const id = 'mom-scroll:' + key;
  useLayoutEffect(() => {
    let y = 0;
    try { y = Number(sessionStorage.getItem(id) ?? 0); } catch { /* storage blocked */ }
    if (!(y > 0)) return;
    // the list may still be loading: try again for a moment until the page is tall enough
    let tries = 0, raf = 0;
    const go = () => { const el = ref.current; if (!el) return; el.scrollTop = y; if (Math.abs(el.scrollTop - y) > 2 && tries++ < 60) raf = requestAnimationFrame(go); };
    go();
    return () => cancelAnimationFrame(raf);
  }, [id]);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => { try { sessionStorage.setItem(id, String(Math.round(e.currentTarget.scrollTop))); } catch { /* storage blocked */ } };
  return { ref, onScroll };
}

export function Big({ children, onClick, tone = 'primary', disabled, className, md }: { children: ReactNode; onClick?: () => void; tone?: 'primary' | 'soft' | 'ghost' | 'danger'; disabled?: boolean; className?: string; /** the add-meal pages: 56 tall, 18 px */ md?: boolean }) {
  const s = { primary: 'bg-brand text-white', soft: 'bg-brand-soft text-brand', ghost: 'bg-white text-slate-800 border border-slate-200', danger: 'bg-over text-white' }[tone];
  return <button disabled={disabled} onClick={onClick} className={cx('w-full rounded-2xl px-4 font-bold active:opacity-80 disabled:opacity-40', md ? 'min-h-[56px] text-[18px]' : 'min-h-[60px] text-[20px]', s, className)}>{children}</button>;
}

/** A choice row: picture/emoji, big words, selected tick. */
export function Choice({ icon, label, sub, on, onClick, color, compact, dense }: { icon?: ReactNode; label: ReactNode; sub?: ReactNode; on?: boolean; onClick: () => void; color?: string; /** two side by side on a phone: smaller icon, and the coloured border alone marks the choice */ compact?: boolean;
  /** the add-meal pages: 56 tall, 17 px, a smaller icon */ dense?: boolean }) {
  return (
    <button onClick={onClick} style={color ? { borderColor: color } : undefined} aria-pressed={on}
      className={cx('flex w-full items-center rounded-2xl border-2 bg-white text-start active:opacity-80', dense ? 'min-h-[56px] py-1.5' : 'min-h-[64px] py-2', compact || dense ? 'gap-2.5 px-3' : 'gap-3 px-4', on ? 'border-brand bg-brand-soft' : 'border-slate-200')}>
      {icon && <span className={cx('grid shrink-0 place-items-center overflow-hidden rounded-xl', compact || dense ? 'h-9 w-9 text-2xl' : 'h-11 w-11 text-3xl')}>{icon}</span>}
      <span className="min-w-0 flex-1"><span className={cx('block font-bold leading-snug', dense ? 'text-[17px]' : compact ? 'text-[18px]' : 'text-[19px]')}><bdi>{label}</bdi></span>{sub && <span className={cx('block text-slate-500', dense ? 'text-[13px] leading-snug' : 'text-sm')}>{sub}</span>}</span>
      {on && !compact && <span className="shrink-0 text-2xl text-brand">✓</span>}
    </button>
  );
}
export function PenBar({ type, small }: { type: 'rapid' | 'long'; small?: boolean }) {
  return <span aria-hidden className={cx('inline-block shrink-0 rounded-full', small ? 'h-6 w-2.5' : 'h-9 w-3')} style={{ background: PEN[type] }} />;
}

export const SITE_NAME: Record<InjectionSite, string> = {
  belly_r: 'بطن يمين', belly_l: 'بطن يسار', thigh_r: 'فخذ يمين', thigh_l: 'فخذ يسار', arm_r: 'ذراع يمين', arm_l: 'ذراع يسار', buttock_r: 'مقعدة يمين', buttock_l: 'مقعدة يسار', // i18n-ok
};

/** Where insulin goes, drawn as a girl seen from the back (left) and the front (right), like the care team's chart:
 *  back of the upper arms, belly around the navel, outer thighs, buttocks. As you face her front, her right is on
 *  your left; from the back it is on your right. Tap a site to choose it; the sensor's site is grey and locked. */
export function BodyMap({ allowed, last, suggest, sel, onPick, now, sensor = null }: { allowed: InjectionSite[]; last: Map<InjectionSite, number>; suggest: InjectionSite | null; sel: InjectionSite | null; onPick: (s: InjectionSite) => void; now: number; sensor?: InjectionSite | null }) {
  const when = (s: InjectionSite) => { const t0 = last.get(s); if (t0 === undefined) return ''; const d = Math.floor((now - t0) / 86400000); return d <= 0 ? t('اليوم') : d === 1 ? t('أمس') : t('{n} أيام', { n: d }); };
  // one zone: an ellipse (cx, cy, rx, ry), turned by rot degrees, in the figure's own coordinates
  const zone = (s: InjectionSite, cx: number, cy: number, rx: number, ry: number, label = true, rot = 0) => {
    const turn = rot ? `rotate(${rot} ${cx} ${cy})` : undefined;
    if (s === sensor) return (
      <g key={s + cx} aria-label={t('الحساس')}>
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={turn} fill="#d9d4e2" stroke="#8a84a0" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={cx} y={cy + 5} fontSize="13" textAnchor="middle">📡</text>
      </g>
    );
    if (!allowed.includes(s)) return null;
    const recent = last.has(s) && now - last.get(s)! < 2 * 86400000;
    const fill = s === sel ? '#db2777' : s === suggest ? '#d8f5e6' : recent ? '#fff1d6' : '#fde4f0';
    const stroke = s === sel ? '#9d174d' : s === suggest ? '#1f8a5b' : recent ? '#f0a020' : '#f472b6';
    const mark = s === sel ? '✓' : s === suggest ? '⭐' : label ? when(s) : '';
    return (
      <g key={s + cx} onClick={() => onPick(s)} style={{ cursor: 'pointer' }}>
        <ellipse cx={cx} cy={cy} rx={rx + 6} ry={ry + 6} transform={turn} fill="transparent" />
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={turn} fill={fill} stroke={stroke} strokeWidth={s === sel || s === suggest ? 3 : 1.8} />
        {mark && <text x={cx} y={cy + 4} fontSize={mark.length > 2 ? 8.5 : 12} fontWeight="700" textAnchor="middle" fill={s === sel ? '#fff' : '#3b1a2e'}>{mark}</text>}
      </g>
    );
  };
  // the girl, drawn for us (public/assets/girl-*.webp): each view is a 180 x 318 canvas centred on x = c
  const girl = (c: number, back: boolean) => {
    const side = (her: 'r' | 'l') => (her === 'r' ? (back ? 1 : -1) : back ? -1 : 1); // where her right/left falls on screen
    return (
      <g key={back ? 'back' : 'front'}>
        <image href={asset(back ? 'girl-back.webp' : 'girl-front.webp')} x={c - 90} y={0} width={180} height={318} />
        {/* the sites, placed on this drawing; the upper arms lean out like hers */}
        {zone('arm_r', c + side('r') * 40, 134, 7, 16, false, side('r') * -20)}
        {zone('arm_l', c + side('l') * 40, 134, 7, 16, false, side('l') * -20)}
        {back ? <>
          {zone('buttock_r', c + side('r') * 16, 178, 13, 12)}
          {zone('buttock_l', c + side('l') * 16, 178, 13, 12)}
        </> : <>
          {zone('belly_r', c + side('r') * 15, 163, 12, 11)}
          {zone('belly_l', c + side('l') * 15, 163, 12, 11)}
          {zone('thigh_r', c + side('r') * 18, 222, 9, 16)}
          {zone('thigh_l', c + side('l') * 18, 222, 9, 16)}
        </>}
      </g>
    );
  };
  return (
    <svg viewBox="0 0 360 318" className="w-full" direction="ltr" role="img" aria-label={t('أماكن الإبرة')}>
      {girl(90, true)}
      {girl(270, false)}
      <text x={90} y={312} fontSize="13" fill="#8a84a0" textAnchor="middle">{t('من ورا')}</text>
      <text x={270} y={312} fontSize="13" fill="#8a84a0" textAnchor="middle">{t('من قدّام')}</text>
      <text x={42} y={14} fontSize="11" fill="#8a84a0" textAnchor="middle">{t('يسارها')}</text>
      <text x={138} y={14} fontSize="11" fill="#8a84a0" textAnchor="middle">{t('يمينها')}</text>
      <text x={222} y={14} fontSize="11" fill="#8a84a0" textAnchor="middle">{t('يمينها')}</text>
      <text x={318} y={14} fontSize="11" fill="#8a84a0" textAnchor="middle">{t('يسارها')}</text>
    </svg>
  );
}

/** Mom mode's bottom tabs: home, the log, nutrition (the food list with its values), more. */
export function MomTabs({ pathname }: { pathname: string }) {
  const nav = useNavigate();
  const tabs = [{ to: '/mom', icon: '🏠', label: 'الرئيسية' }, { to: '/mom/log', icon: '📋', label: 'السجل' }, { to: '/mom/food', icon: '🥗', label: 'التغذية' }, { to: '/mom/more', icon: '☰', label: 'المزيد' }]; // i18n-ok: translated where shown
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {tabs.map((x) => {
          const on = pathname === x.to;
          return (
            <li key={x.to}><button onClick={() => nav(x.to, { replace: true })} aria-current={on ? 'page' : undefined} className="flex min-h-[60px] w-full items-center justify-center">
              <span className={cx('flex flex-col items-center rounded-2xl px-3 py-1 text-[15px]', on ? 'bg-brand-soft font-bold text-brand' : 'text-slate-500')}><span className="text-[22px] leading-none">{x.icon}</span>{t(x.label)}</span>
            </button></li>
          );
        })}
      </ul>
    </nav>
  );
}
/** Room left at the bottom of a page for MomTabs. */
export const TABS_PAD = 'pb-[calc(76px+env(safe-area-inset-bottom))]';
/** «اليوم», «بكرة», «أمس», or the weekday (planned meals can be tomorrow). */
export const dayWord = (ms: number, now = Date.now()) => {
  const a = new Date(ms), b = new Date(now);
  const diff = Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
  return diff === 1 ? t('بكرة') : relDay(a, b);
};
/** Time left on the sensor in words: «9 أيام», «يومين», «يوم», or hours under a day. */
export const sensorLeft = (leftMs: number) => {
  const d = Math.floor(leftMs / 86400000);
  return d >= 3 ? t('{n} أيام', { n: d }) : d === 2 ? t('يومين') : d === 1 ? t('يوم') : span(Math.max(1, Math.ceil(leftMs / 60000)));
};

// ── settings list (simple-mode More): grouped rows like iOS Settings, in the app's colours ──
/** A small heading and one rounded group of rows with hairline separators. */
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h2 className="px-4 text-[12px] font-semibold text-slate-500">{title}</h2>
      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white">{children}</div>
    </section>
  );
}

/** An on/off switch, iOS style: the knob sits at the end when on (right in English, left in Arabic). */
export function Switch({ on, label, onChange, disabled }: { on: boolean; label: string; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    // the track is iOS-sized (51 × 31); the button around it is 44 tall so it is easy to tap
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className="-my-[6.5px] shrink-0 py-[6.5px] disabled:opacity-40">
      <span className={cx('relative block h-[31px] w-[51px] rounded-full transition-colors', on ? 'bg-brand' : 'bg-[#cfcbd8]')}>
        <span className={cx('absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all', on ? 'end-[2px]' : 'start-[2px]')} />
      </span>
    </button>
  );
}

/** One settings row: a tinted icon tile, the label with an optional second line, then a switch or a chevron. */
export function SettingsRow({ icon, tint, label, sub, onClick, end, subTone }: { icon: IconName; tint: string; label: string; sub?: ReactNode; onClick?: () => void; end?: ReactNode; subTone?: 'warn' }) {
  const body = (
    <>
      <span aria-hidden className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg text-white" style={{ background: tint }}><Icon name={icon} size={19} /></span>
      <span className="min-w-0 flex-1 py-0.5">
        <span className="block text-[16px] font-semibold leading-snug">{label}</span>
        {sub && <span className={cx('block text-[13px] leading-snug', subTone === 'warn' ? 'text-over' : 'text-slate-500')}>{sub}</span>}
      </span>
      {end ?? (onClick && <span aria-hidden className="shrink-0 text-[22px] leading-none text-slate-300">{isEn() ? '›' : '‹'}</span>)}
    </>
  );
  const cls = 'flex min-h-[48px] w-full items-center gap-3 px-4 py-1.5 text-start'; // More fits on one screen
  return onClick && !end ? <button onClick={onClick} className={cx(cls, 'active:bg-slate-50')}>{body}</button> : <div className={cls}>{body}</div>;
}
