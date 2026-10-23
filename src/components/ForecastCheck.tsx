import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { Card, cx } from './ui';
import { locale, t } from '../i18n';

const MG = 18.016;
const H = [30, 60, 120, 240] as const;
const COLS = [['persist', 'يبقى كما هو'], ['trend', 'الاتجاه'], ['v2', 'الكارب والإنسولين']] as const; // i18n-ok: translated when shown
type Score = { n: number; mae: number; lowN: number };
type Result = { testFrom: number; to: number; test: Record<string, Score>; verdict: Record<string, 'better' | 'no_different' | 'worse'> };
const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);

/**
 * Forecast vs what happened, from the daily benchmark (carb-benchmark, engine/benchmark.ts) on the week it never saw:
 * the average miss of «stays where it is», the trend and the carb-and-insulin curves, 30 minutes to 4 hours ahead.
 * A forecast is shown elsewhere in the app only when it beats «stays where it is»; this card says whether any does.
 */
export function ForecastCheck({ unit }: { unit: GlucoseUnit }) {
  const [r, setR] = useState<Result | null | undefined>(undefined);
  useEffect(() => {
    supabase.from('benchmark_runs').select('result').order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setR(((data?.[0] as { result: Result } | undefined)?.result) ?? null));
  }, []);
  if (r === undefined) return null;
  if (r === null) return <Card><h2 className="font-bold">{t('التوقع مقابل الواقع')}</h2><p className="text-sm text-slate-500">{t('لا يوجد قياس بعد.')}</p></Card>;
  const miss = (k: string) => { const s = r.test[k]; return s && s.n ? formatGlucose(s.mae * MG, unit) : '—'; };
  const better = Object.entries(r.verdict).some(([, v]) => v === 'better');
  const lows = r.test['persist:30']?.lowN ?? 0;
  return (
    <Card className="space-y-2">
      <div>
        <h2 className="font-bold">{t('التوقع مقابل الواقع')}</h2>
        <p className="text-xs text-slate-500">{t('متوسط الخطأ بـ {unit} · أسبوع لم يُستخدم في الضبط ({a}–{b}) · {n} توقع لكل خانة', { unit: unitLabel(unit), a: day(r.testFrom), b: day(r.to), n: r.test['persist:30']?.n ?? 0 })}</p>
      </div>
      <table className="w-full text-center text-[13.5px]">
        <thead><tr className="text-[12px] text-slate-500"><th className="text-start font-medium">{t('بعد')}</th>{COLS.map(([k, l]) => <th key={k} className="font-medium">{t(l)}</th>)}</tr></thead>
        <tbody>
          {H.map((h) => (
            <tr key={h} className="border-t border-slate-100">
              <td className="py-1 text-start text-slate-600">{h < 60 ? t('{n} د', { n: h }) : t('{n}س', { n: h / 60 })}</td>
              {COLS.map(([k]) => {
                const v = k === 'persist' ? null : r.verdict[`${k}:${h}`];
                return <td key={k} className={cx('py-1', v === 'better' ? 'font-bold text-ok' : v === 'worse' ? 'text-over' : 'text-slate-800')}><span className="num" dir="ltr">{miss(`${k}:${h}`)}{v === 'worse' ? ' ▲' : v === 'better' ? ' ▼' : ''}</span></td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[12.5px] text-slate-600">{better ? t('▼ أفضل من «يبقى كما هو» بثقة 95 %.') : t('لا توقع أفضل من «يبقى كما هو» بعد، فالتوقعات مخفية في الرسم. ▲ أسوأ بثقة 95 %.')}</p>
      {lows < 20 && <p className="text-[12.5px] text-slate-500">{t('القراءات المنخفضة في هذا الأسبوع: {n}، قليلة للحكم على التوقع وقت الانخفاض.', { n: lows })}</p>}
    </Card>
  );
}
