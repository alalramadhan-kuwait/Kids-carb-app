import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { effectiveRange, formatGlucose } from '../lib/glucose';
import { Card, Chip, cx } from '../components/ui';
import { Timeline } from '../engine/Timeline';
import { useSeries } from '../engine/useSeries';
import { seriesStats, type PeriodStats } from '../engine/stats';
import { dayStartOf, dayTitle } from '../engine/day';
import { daysFor, type Bin } from '../engine/profile';
import type { View } from '../engine/series';
import { ProfileChart } from './Patterns';

const H = 3600000, DAY = 24 * H, KW = 3 * H;
type Preset = 'day' | 'week' | 'school' | 'custom';
const PRESETS: [Preset, string][] = [['day', 'اليوم وأمس'], ['week', 'هذا الأسبوع والماضي'], ['school', 'المدرسة والعطلة'], ['custom', 'يومان تختارهما']];
const isoDay = (t: number) => new Date(t + KW).toISOString().slice(0, 10);
const fromIso = (s: string) => Date.parse(s + 'T00:00:00Z') - KW;

/** مقارنة: two periods on the same axes, moving together, with their numbers side by side. No winner. */
export function Compare() {
  const { settings } = useData();
  const [preset, setPreset] = useState<Preset>('day');
  const today = dayStartOf(Date.now());
  const [ca, setCa] = useState(today), [cb, setCb] = useState(today - 7 * DAY);
  const unit = settings.glucose_unit;
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);

  const p = useMemo(() => {
    if (preset === 'week') return { a: today - 6 * DAY, b: today - 13 * DAY, len: 7 * DAY, la: 'هذا الأسبوع', lb: 'الأسبوع الماضي' };
    if (preset === 'custom') return { a: ca, b: cb, len: DAY, la: dayTitle(ca), lb: dayTitle(cb) };
    if (preset === 'school') return { a: today - 27 * DAY, b: today - 27 * DAY, len: 28 * DAY, la: 'أيام المدرسة', lb: 'العطلة' };
    return { a: today, b: today - DAY, len: DAY, la: 'اليوم', lb: 'أمس' };
  }, [preset, today, ca, cb]);
  const [view, setView] = useState<View>({ end: p.a + p.len, span: p.len });
  useEffect(() => setView({ end: p.a + p.len, span: p.len }), [p.a, p.len]);
  const clamp = (v: View): View => { const span = Math.min(p.len, Math.max(30 * 60000, v.span)); return { span, end: Math.min(p.a + p.len, Math.max(p.a + span, v.end)) }; };
  const off = p.a - p.b;

  const A = useSeries(p.a, p.a + p.len, undefined).series;
  const B = useSeries(p.b, p.b + p.len, undefined).series;
  const school = preset === 'school';
  const dA = school ? daysFor('school', settings.school_days, []) : null, dB = school ? daysFor('weekend', settings.school_days, []) : null;
  const sA = seriesStats(A, p.a, p.a + p.len, Date.now(), dA), sB = seriesStats(B, p.b, p.b + p.len, Date.now(), dB);

  // school vs weekend: two 24-hour profiles instead of timelines
  const [bins, setBins] = useState<{ a: Bin[]; b: Bin[] } | null>(null);
  useEffect(() => {
    if (!school) return;
    const args = (dows: number[] | null) => ({ p_from: new Date(p.a).toISOString(), p_to: new Date(p.a + p.len).toISOString(), p_dows: dows, p_bin_min: 15 });
    Promise.all([supabase.rpc('glucose_profile', args(dA)), supabase.rpc('glucose_profile', args(dB))])
      .then(([a, b]) => setBins({ a: (a.data ?? []) as Bin[], b: (b.data ?? []) as Bin[] }));
  }, [school, p.a]);

  const height = 200;
  return (
    <div className="space-y-3 pb-4">
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
        {PRESETS.map(([k, l]) => <Chip key={k} active={preset === k} onClick={() => setPreset(k)}>{l}</Chip>)}
      </div>
      {preset === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <input type="date" dir="ltr" className="min-h-[44px] rounded-2xl border border-slate-200 bg-white px-3" value={isoDay(ca)} max={isoDay(today)} onChange={(e) => e.target.value && setCa(fromIso(e.target.value))} />
          <input type="date" dir="ltr" className="min-h-[44px] rounded-2xl border border-slate-200 bg-white px-3" value={isoDay(cb)} max={isoDay(today)} onChange={(e) => e.target.value && setCb(fromIso(e.target.value))} />
        </div>
      )}
      {[['A', p.la, A, 0] as const, ['B', p.lb, B, off] as const].map(([k, label, ser, shift]) => (
        <div key={k}>
          <div className="mb-1 px-1 text-sm font-bold">{label}</div>
          {school ? (
            <Card className="!px-2 !py-2">{bins ? <ProfileChart bins={(k === 'A' ? bins.a : bins.b).map((b) => ({ ...b, p10: +b.p10, p25: +b.p25, p50: +b.p50, p75: +b.p75, p90: +b.p90 }))} unit={unit} range={rng} /> : <p className="text-slate-500">…</p>}</Card>
          ) : (
            <div className="-mx-4 bg-white py-1 shadow-card">
              <Timeline series={ser} view={{ span: view.span, end: view.end - shift }} now={Date.now()} unit={unit} height={height} range={rng}
                onView={(v) => setView(clamp({ span: v.span, end: v.end + shift }))} dayParts={p.len === DAY} />
            </div>
          )}
        </div>
      ))}
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-xs text-slate-500"><th className="p-2 text-start font-medium" /><th className="p-2 font-medium">{p.la}</th><th className="p-2 font-medium">{p.lb}</th><th className="p-2 font-medium">الفرق</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            <Row label="ضمن النطاق" a={sA.n ? sA.pct_in : null} b={sB.n ? sB.pct_in : null} f={(x) => `${Math.round(x)}%`} />
            <Row label="منخفض" a={sA.n ? sA.pct_vlow + sA.pct_low : null} b={sB.n ? sB.pct_vlow + sB.pct_low : null} f={(x) => `${Math.round(x)}%`} />
            <Row label="مرتفع" a={sA.n ? sA.pct_high + sA.pct_vhigh : null} b={sB.n ? sB.pct_high + sB.pct_vhigh : null} f={(x) => `${Math.round(x)}%`} />
            <Row label="المتوسط" a={sA.mean} b={sB.mean} f={(x) => formatGlucose(x, unit)} />
            <Row label="التذبذب CV" a={sA.cv} b={sB.cv} f={(x) => `${Math.round(x)}%`} />
            <Row label="التغطية" a={sA.n ? sA.coverage : null} b={sB.n ? sB.coverage : null} f={(x) => `${Math.round(x)}%`} />
          </tbody>
        </table>
      </Card>
      <p className="px-1 text-xs text-slate-400">فروق فقط، بدون حكم على أيهما أفضل.{school ? ' أيام المدرسة من إعدادات وضع المدرسة، آخر 28 يومًا.' : ''}</p>
    </div>
  );
}

function Row({ label, a, b, f }: { label: string; a: number | null; b: number | null; f: (x: number) => string }) {
  const d = a !== null && b !== null ? a - b : null;
  return (
    <tr>
      <td className="p-2 text-slate-600">{label}</td>
      <td className="num p-2 text-center font-bold">{a !== null ? f(a) : '—'}</td>
      <td className="num p-2 text-center font-bold">{b !== null ? f(b) : '—'}</td>
      <td className={cx('num p-2 text-center text-slate-500')} dir="ltr">{d === null ? '—' : Math.abs(d) < 0.05 ? '=' : `${d > 0 ? '+' : '−'}${f(Math.abs(d))}`}</td>
    </tr>
  );
}
export type { PeriodStats };
