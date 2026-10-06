// Care-team report: overnight stretches when only the long-acting insulin was working (no rapid insulin for 6 hours,
// nothing eaten for 3). Shows what her glucose does then, night by night. Evidence to discuss, never a dose.
import { useEffect, useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { fetchSeries } from '../engine/useSeries';
import { BASAL_DEFAULTS, atNight, basalStretches, basalSummary, type Mark, type Stretch } from '../engine/basal';
import type { Series } from '../engine/series';
import { effectiveRange, formatGlucose } from '../lib/glucose';
import { nightOf } from '../lib/schedule';
import { fmt } from '../lib/carbs';
import { fmtTime, hourWord, relDay } from '../lib/constants';
import { dur } from '../pages/PlanReview';
import { Card, cx } from './ui';
import { isEn, t } from '../i18n';

const H = 3600000;
const clockMin = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const nightKey = (ms: number) => new Date(ms - 12 * H).toDateString(); // the night it belongs to (evening's date)

export function OvernightBasal({ from, pattern }: { from: number; pattern: number }) {
  const { settings, events, history } = useData();
  const [series, setSeries] = useState<Series | null>(null);
  useEffect(() => { let stop = false; setSeries(null); void fetchSeries(from - 12 * H, Date.now()).then((s) => { if (!stop) setSeries(s); }, () => { if (!stop) setSeries(null); }); return () => { stop = true; }; }, [from]);
  const unit = settings.glucose_unit, g = (mg: number) => formatGlucose(mg, unit);
  const range = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const low = range.low ?? 70;
  const night = nightOf(settings);
  const rules = BASAL_DEFAULTS;
  const name = settings.basal_insulin?.split(' (')[0].trim() || t('الإنسولين الطويل');

  const list = useMemo(() => {
    if (!series) return null;
    const marks: Mark[] = [
      ...events.filter((e) => e.kind === 'insulin' && e.insulin_type !== 'long').map((e) => ({ t: Date.parse(e.occurred_at), kind: 'rapid' as const })),
      ...events.filter((e) => e.kind === 'treatment').map((e) => ({ t: Date.parse(e.occurred_at), kind: 'treatment' as const })),
      ...events.filter((e) => e.kind === 'carbs' && (e.carbs_g ?? 0) >= 5).map((e) => ({ t: Date.parse(e.occurred_at), kind: 'food' as const })),
      ...history.filter((h) => h.total_carbs >= 5).map((h) => ({ t: Date.parse(h.eaten_at), kind: 'food' as const })),
    ];
    const long = events.filter((e) => e.kind === 'insulin' && e.insulin_type === 'long').map((e) => ({ t: Date.parse(e.occurred_at), units: e.insulin_units }));
    return basalStretches(series, marks, long, low, from, Date.now(), rules).filter((x) => atNight(x, clockMin, night.start, night.end)).reverse();
  }, [series, events, history, low, from, rules, night.start, night.end]);

  const sum = list ? basalSummary(list, rules, nightKey) : null;
  const flag = sum && sum.n >= pattern && sum.falling * 3 >= sum.n * 2;
  const ended = (x: Stretch) => x.endedBy === 'treatment' ? t('انتهت بعلاج انخفاض') : x.endedBy === 'food' ? t('انتهت بأكل') : x.endedBy === 'rapid' ? t('انتهت بجرعة سريعة') : '';
  const perH = (r: number) => { const v = g(Math.abs(r)); return /^0(\.0)?$/.test(v) ? v : `${r > 0 ? '+' : '−'}${v}`; };

  // one line and the chart; the night-by-night list, the rule behind it and the sensor caveat open on request
  const fell = sum ? sum.rate !== null && sum.rate < 0 : false;
  return (
    <Card className="space-y-2">
      <h2 className="font-bold">🌙 {t('الليل ({name} وحده)', { name })}</h2>
      {!list ? <p className="text-sm text-slate-500">…</p> : list.length === 0 ? <p className="text-sm text-slate-500">{t('لا توجد فترات كهذه في هذه المدة.')}</p> : (
        <>
          <p className={cx('rounded-xl px-3 py-2 text-[15px] font-medium', flag ? 'bg-near-soft/60' : 'bg-slate-50')}>
            {sum!.rate === null ? t('{n} ليالٍ', { n: sum!.nights }) : fell
              ? t('نزل السكر حوالي {r} كل ساعة', { r: g(Math.abs(sum!.rate)) })
              : t('تغيّر السكر حوالي {r} كل ساعة', { r: perH(sum!.rate) })}
            {' · '}{t('وصل تحت النطاق في {k} من {n} ليالٍ', { k: sum!.low, n: sum!.n })}
            {flag && <span className="mt-1 block text-xs font-bold text-near">{t('للمراجعة مع فريق الرعاية')}</span>}
          </p>
          <NightChart list={list} series={series!} unit={unit} range={{ low, high: range.high ?? 180 }} />
          <details className="text-sm">
            <summary className="min-h-[40px] cursor-pointer py-2 font-bold text-brand">{t('تفاصيل كل ليلة ({n})', { n: list.length })}</summary>
            <p className="text-xs text-slate-500">{t('أوقات الليل ({a}–{b}) بلا إنسولين سريع لـ {h} ساعات وبلا أكل لـ {f} ساعات. ما يفعله السكر فيها يعود إلى الإنسولين الطويل وحده.', { a: night.start, b: night.end, h: rules.rapid_gap_min / 60, f: rules.food_gap_min / 60 })}</p>
            <ul className="divide-y divide-slate-100">
              {list.map((x) => (
                <li key={x.from} className="space-y-0.5 py-2">
                  <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{relDay(new Date(x.from))} · <bdi className="num">{fmtTime(new Date(x.from))}</bdi> – <bdi className="num">{fmtTime(new Date(x.to))}</bdi></span><b className="whitespace-nowrap"><bdi dir="ltr" className="num">{perH(x.rate)}</bdi> {t('في الساعة')}</b></div>
                  <div className="text-xs text-slate-600"><span className="num">{g(x.start)} {isEn() ? '→' : '←'} {g(x.end)}</span> · {t('أدنى {g}', { g: g(x.min) })}{x.low && <b className="text-over"> · {t('تحت النطاق')}</b>}{ended(x) && <> · {ended(x)}</>}</div>
                  <div className="text-[11px] text-slate-500">{x.long ? t('آخر جرعة طويلة: {u} و الساعة {time}', { u: x.long.units === null ? '—' : fmt(x.long.units), time: fmtTime(new Date(x.long.t)) }) : ''}{x.sinceRapidMin !== null && <> · {t('آخر جرعة سريعة قبلها بـ {d}', { d: dur(x.sinceRapidMin) })}</>}</div>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-500">{t('القراءات المنخفضة أثناء النوم قد تأتي من الضغط على الحسّاس؛ فحص الإصبع يؤكدها.')}</p>
          </details>
        </>
      )}
    </Card>
  );
}


/** Each stretch on one clock axis (18:00 → 10:00), so nights can be compared. */
function NightChart({ list, series, unit, range }: { list: Stretch[]; series: Series; unit: 'mmol' | 'mgdl'; range: { low: number; high: number } }) {
  const W = 340, PL = 4, PR = 28, PT = 8, PH = 150, HH = PT + PH + 18;
  const pos = (ms: number) => { const m = clockMin(ms); return (m >= 18 * 60 ? m - 18 * 60 : m + 6 * 60) / (16 * 60); };
  const x = (ms: number) => PL + pos(ms) * (W - PL - PR);
  const top = 250, bottom = 40;
  const y = (v: number) => PT + PH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * PH;
  const ticks = unit === 'mmol' ? [4, 10].map((m) => m * 18.016) : [70, 180];
  const paths = list.map((st) => {
    let d = '';
    // only 18:00–10:00, and a new segment wherever the clock wraps
    let prev = -1;
    for (let i = 0; i < series.t.length; i++) {
      const tt = series.t[i];
      if (tt < st.from || tt > st.to) continue;
      const m = clockMin(tt);
      if (m >= 10 * 60 && m < 18 * 60) { prev = -1; continue; }
      const p = pos(tt);
      d += `${prev < 0 || p < prev ? 'M' : 'L'}${x(tt).toFixed(1)},${y(series.v[i]).toFixed(1)}`;
      prev = p;
    }
    return { d, low: st.low, k: st.from };
  });
  return (
    <svg viewBox={`0 0 ${W} ${HH}`} className="w-full" role="img" aria-label={t('الليل: السكر بالإنسولين الطويل وحده')} direction="ltr">
      <rect x={PL} y={PT} width={W - PL - PR} height={PH} rx="8" fill="rgb(var(--surface-2))" />
      <rect x={PL} y={y(range.high)} width={W - PL - PR} height={y(range.low) - y(range.high)} fill="rgb(var(--st-in))" opacity="0.13" />
      {ticks.map((v) => <text key={v} x={W - 2} y={y(v) + 4} textAnchor="end" fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{formatGlucose(v, unit).replace(/\.0$/, '')}</text>)}
      {[18, 22, 2, 6, 10].map((h, k) => <text key={h} x={PL + (k / 4) * (W - PL - PR)} y={HH - 4} textAnchor={k === 0 ? 'start' : k === 4 ? 'end' : 'middle'} fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{hourWord(h)}</text>)}
      {paths.map((p) => <path key={p.k} d={p.d} fill="none" stroke={p.low ? 'rgb(var(--st-low))' : 'rgb(var(--primary-strong))'} strokeWidth="1.8" strokeOpacity="0.8" strokeLinejoin="round" />)}
    </svg>
  );
}
