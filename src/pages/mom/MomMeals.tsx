// Mom mode's «الوجبات» tab: one simple table. Each meal with the glucose when Layan ate and two hours later, and the
// NovoRapid given with it (within 15 minutes). Today, yesterday, or the week. A row opens the meal.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { mealTitle } from '../../lib/unknownMeal';
import { fetchGraphSeries } from '../../engine/useSeries';
import type { Series } from '../../engine/series';
import { mealTable, type MealRow } from '../../engine/mealTable';
import { dayStartOf, dayTitle } from '../../engine/day';
import { effectiveRange, formatGlucose } from '../../lib/glucose';
import { fmt } from '../../lib/carbs';
import { cx } from '../../components/ui';
import { t } from '../../i18n';
import { MomPage, clock } from './MomUI';

const DAY = 86400000, H = 3600000;
type Span = 'today' | 'yesterday' | 'week';

export function MomMeals() {
  const nav = useNavigate();
  const { events, history, settings } = useData();
  const [sp, setSp] = useSearchParams();
  const span = (sp.get('s') as Span) || 'today';
  const setSpan = (s: Span) => setSp({ s }, { replace: true });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);
  const today = dayStartOf(now);
  const from = span === 'today' ? today : span === 'yesterday' ? today - DAY : today - 6 * DAY;
  const to = span === 'yesterday' ? today + 2 * H : now + 60000;
  // the readings for the chosen days, once per choice (the two-hour number of a meal still cooking comes with the next minute's refetch)
  const [series, setSeries] = useState<{ key: string; s: Series } | null>(null);
  const key = `${span}:${Math.floor(now / 300000)}`;
  useEffect(() => { let on = true; void fetchGraphSeries(from, to).then((s) => { if (on) setSeries({ key, s }); }).catch(() => undefined); return () => { on = false; }; }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const meals = history.filter((h) => !h.deleted_at && h.intake !== 'pending').map((h) => ({ id: h.id, t: Date.parse(h.eaten_at), name: mealTitle(h), carbs: h.total_carbs })).filter((m) => m.t >= from && m.t < (span === 'yesterday' ? today : now + 60000));
    const doses = events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type !== 'long' && e.insulin_units).map((e) => ({ id: e.id, t: Date.parse(e.occurred_at), units: Number(e.insulin_units) }));
    return mealTable(meals, doses, series?.s ?? null, now);
  }, [history, events, series, from, span, today, now]);
  const range = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const tone = (mg: number) => (range.low !== null && mg < range.low ? 'text-over' : range.high !== null && mg > range.high ? 'text-near' : 'text-ok');
  const g = (mg: number | null) => (mg === null ? <span className="text-slate-300">–</span> : <span className={cx('num', tone(mg))}>{formatGlucose(mg, settings.glucose_unit)}</span>);
  const days = [...new Set(rows.map((r) => dayStartOf(r.t)))];
  return (
    <MomPage title={t('الوجبات')} back={null} tabs>
      <p className="-mt-2 text-[14px] text-slate-500">{t('السكر عند الأكل وبعد ساعتين · 💉 جرعة الوجبة')}</p>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-[15px]">
        {(['today', 'yesterday', 'week'] as const).map((k) => <button key={k} onClick={() => setSpan(k)} className={cx('min-h-[44px] rounded-full', span === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'today' ? t('اليوم') : k === 'yesterday' ? t('أمس') : t('الأسبوع')}</button>)}
      </div>
      {!rows.length && <p className="py-6 text-center text-[18px] text-slate-500">{t('ما في وجبات')}</p>}
      {days.map((d, i) => (
        <section key={d}>
          <h2 className="mb-1.5 text-[16px] font-bold text-slate-500">{dayTitle(d, now)}</h2>
          <div className="rounded-3xl bg-white px-4">
            {i === 0 && <div className="flex justify-end gap-2 pt-2 text-[11px] text-slate-500 whitespace-nowrap"><span className="w-[58px] text-center">{t('عند الأكل')}</span><span className="w-5" /><span className="w-[58px] text-center">{t('بعد ساعتين')}</span></div>}
            <ul className="divide-y divide-slate-100">
              {rows.filter((r) => dayStartOf(r.t) === d).map((r) => <Row key={r.id} r={r} g={g} onClick={() => nav(`/mom/meal-entry/${r.id}`)} />)}
            </ul>
          </div>
        </section>
      ))}
      {rows.length > 0 && <p className="flex flex-wrap justify-center gap-x-4 text-[12px] text-slate-500"><span><span className="text-ok">●</span> {t('ضمن المدى')}</span><span><span className="text-near">●</span> {t('مرتفع')}</span><span><span className="text-over">●</span> {t('منخفض')}</span></p>}
    </MomPage>
  );
}

function Row({ r, g, onClick }: { r: MealRow; g: (mg: number | null) => React.ReactNode; onClick: () => void }) {
  const sub = [clock(r.t), r.carbs === null ? t('الكارب غير معروف') : t('{g} غ', { g: fmt(r.carbs) }), r.dose !== null ? `💉 ${fmt(r.dose)}` : ''].filter(Boolean).join(' · ');
  return (
    <li><button onClick={onClick} className="flex min-h-[64px] w-full items-center gap-3 py-2.5 text-start">
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold leading-snug"><bdi>{r.name}</bdi></span>
        <span className="block text-[13px] text-slate-500">{sub}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[24px] font-bold">
        <span className="w-[58px] text-center">{g(r.atMg)}</span>
        <span className="w-5 text-center text-[18px] font-normal text-slate-300">←</span>
        {r.waitMin > 0 ? <span className="w-[58px] text-center text-[13px] font-normal text-slate-400">{t('بعد {m} د', { m: r.waitMin })}</span> : <span className="w-[58px] text-center">{g(r.afterMg)}</span>}
      </span>
    </button></li>
  );
}
