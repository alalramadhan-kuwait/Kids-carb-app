import { useMemo } from 'react';
import { cx } from './ui';
import { locale, t } from '../i18n';

const MIN = 60000, DAY = 86400000;
const p2 = (n: number) => String(n).padStart(2, '0');
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * When something happened, time first (as in Gluroo): the day is a small −1 / +1 stepper, the time is big and opens
 * the phone's hour–minute wheel, and ±5 / ±15 minute nudges cover most corrections. Never later than now.
 */
export function TimePicker({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const now = Date.now(), max = now + 5 * MIN;
  const set = (ms: number) => onChange(Math.min(ms, max));
  const d = new Date(value);
  const dayLabel = useMemo(() => {
    const diff = Math.round((startOfDay(now) - startOfDay(value)) / DAY);
    return diff === 0 ? t('اليوم') : diff === 1 ? t('أمس') : new Date(value).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  }, [value, now]);
  const clock = new Date(value).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  const step = 'min-h-[40px] rounded-xl bg-slate-50 px-3 text-sm font-medium text-slate-700 active:bg-slate-100 disabled:opacity-40';

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
        <button type="button" className={step} onClick={() => set(value - DAY)}>{t('−1 يوم')}</button>
        <span className="text-center text-sm font-medium text-slate-600">{dayLabel}</span>
        <button type="button" className={step} disabled={value + DAY > max} onClick={() => set(value + DAY)}>{t('+1 يوم')}</button>
      </div>
      <label className="relative block">
        <span className="flex min-h-[64px] w-full items-center justify-center rounded-2xl bg-brand-soft text-3xl font-bold text-brand"><span className="num" dir="ltr">{clock}</span></span>
        {/* the native time field sits on top, invisible: tapping the big time opens the phone's wheel */}
        <input type="time" aria-label={t('الوقت')} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={`${p2(d.getHours())}:${p2(d.getMinutes())}`}
          onChange={(e) => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isNaN(h) || Number.isNaN(m)) return; const x = new Date(value); x.setHours(h, m, 0, 0); set(x.getTime()); }} />
      </label>
      <div className="grid grid-cols-5 gap-1.5">
        {[-15, -5].map((m) => <button key={m} type="button" className={step} onClick={() => set(value + m * MIN)} dir="ltr">{m}{t('د')}</button>)}
        <button type="button" className={cx(step, 'bg-brand-soft text-brand')} onClick={() => set(now)}>{t('الآن')}</button>
        {[5, 15].map((m) => <button key={m} type="button" className={step} disabled={value + m * MIN > max} onClick={() => set(value + m * MIN)} dir="ltr">+{m}{t('د')}</button>)}
      </div>
    </div>
  );
}
