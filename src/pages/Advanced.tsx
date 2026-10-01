import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { formatGlucose, unitLabel } from '../lib/glucose';
import { gmi, hoursOfDay, kuwaitDayStart } from '../lib/now';
import { Badge, Card, Chip } from '../components/ui';
import { fetchSeries } from '../engine/useSeries';
import { MIN_DAYS, adrrBand, hbgiBand, lbgiBand, variability, type Variability } from '../engine/variability';

const PERIODS = [
  { id: 'today', label: 'اليوم', days: 0 },
  { id: '3', label: '3 أيام', days: 3 },
  { id: '7', label: '7 أيام', days: 7 },
  { id: '14', label: '14 يوم', days: 14 },
  { id: '30', label: '30 يوم', days: 30 },
  { id: '90', label: '90 يوم', days: 90 },
] as const;

const BANDS = [
  { key: 'pct_vlow', label: 'منخفض جدًا', range: '< 3.0', cls: 'bg-over' },
  { key: 'pct_low', label: 'منخفض', range: '3.0–3.8', cls: 'bg-over-fill' },
  { key: 'pct_in', label: 'ضمن النطاق', range: '3.9–10.0', cls: 'bg-ok-fill' },
  { key: 'pct_high', label: 'مرتفع', range: '10.1–13.9', cls: 'bg-near-fill' },
  { key: 'pct_vhigh', label: 'مرتفع جدًا', range: '> 13.9', cls: 'bg-near' },
] as const;

/** The numbers behind the day (Analysis → الأرقام). Published formulas only, each with its data coverage. */
export default function StatsPanel() {
  const { settings } = useData();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['id']>('today');
  const [s, setS] = useState<GlucoseStats | null>(null);
  const [err, setErr] = useState('');
  const [vr, setVr] = useState<Variability | null>(null);
  const days = PERIODS.find((p) => p.id === period)!.days;

  useEffect(() => {
    const to = new Date();
    const from = days === 0 ? kuwaitDayStart(to) : new Date(kuwaitDayStart(to).getTime() - (days - 1) * 86400000);
    setS(null); setErr('');
    glucoseStats(from, to, settings.glucose_low_mgdl, settings.glucose_high_mgdl).then(setS).catch((e) => setErr(e.message));
    setVr(null);
    fetchSeries(from.getTime(), to.getTime()).then((sr) => setVr(variability(sr, from.getTime(), to.getTime()))).catch(() => setVr(null));
  }, [days, settings.glucose_low_mgdl, settings.glucose_high_mgdl]);

  const unit = settings.glucose_unit;
  const enough = s && s.coverage >= 70;
  const cv = s?.mean && s.sd !== null ? (s.sd / s.mean) * 100 : null;

  return (
    <>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        {PERIODS.map((p) => <Chip key={p.id} active={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</Chip>)}
      </div>
      {err && <Card><p className="text-sm text-over">{err}</p></Card>}
      {!s && !err && <Card><p className="text-slate-500">…</p></Card>}
      {s && s.n === 0 && <Card><p className="text-slate-500">لا توجد قراءات في هذه الفترة.</p></Card>}
      {s && s.n > 0 && (
        <div className="space-y-3">
          {!enough && <Card className="!py-3"><p className="text-sm text-near">البيانات تغطي <b className="num">{Math.round(s.coverage)}%</b> فقط من الفترة. الأرقام أدناه تقريبية حتى تصل إلى 70%.</p></Card>}

          <Card className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold">الوقت ضمن النطاق</h2><Badge>منشور</Badge></div>
            <div className="flex h-4 overflow-hidden rounded-full" aria-hidden>
              {BANDS.map((b) => <i key={b.key} className={b.cls} style={{ width: `${s[b.key]}%` }} />)}
            </div>
            <ul className="space-y-1.5">
              {BANDS.slice().reverse().map((b) => (
                <li key={b.key} className="flex items-center gap-2 text-sm">
                  <span className={`h-3 w-3 rounded-sm ${b.cls}`} />
                  <span className="flex-1">{b.label} <span className="num text-xs text-slate-400">{b.range}</span></span>
                  <b className="num">{fmtPct(s[b.key])}</b>
                </li>
              ))}
            </ul>
            <p className="text-sm text-slate-600">ضمن النطاق = <b>{hoursOfDay(s.pct_in)}</b> في اليوم</p>
            {s.pct_target !== null && <p className="text-sm text-slate-600">ضمن نطاقها الذي حدّدتموه: <b className="num">{fmtPct(s.pct_target)}</b></p>}
            <p className="text-xs text-slate-400">الأهداف المرجعية العامة: ضمن النطاق أكثر من 70%، وتحت 3.9 أقل من 4%، وتحت 3.0 أقل من 1%. أهداف طبيبها أولًا.</p>
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between"><h2 className="font-bold">التحكم والاستقرار</h2><Badge>منشور</Badge></div>
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="المتوسط" value={s.mean !== null ? formatGlucose(s.mean, unit) : '—'} unit={unitLabel(unit)} />
              <Kpi label="الانحراف المعياري" value={s.sd !== null ? formatGlucose(s.sd, unit) : '—'} unit={unitLabel(unit)} />
              <Kpi label="معامل التذبذب CV" value={cv !== null ? cv.toFixed(1) : '—'} unit="%" note={cv !== null ? (cv <= 36 ? 'ضمن المرجع ≤ 36%' : 'أعلى من المرجع 36%') : ''} />
              <Kpi label="GMI" value={days >= 14 && enough && s.mean !== null ? gmi(s.mean).toFixed(1) : '—'} unit="%" note={days >= 14 && enough ? 'تقدير، ليس HbA1c' : 'يحتاج 14 يومًا و70% بيانات'} />
              <Kpi label="أقل قراءة" value={s.min !== null ? formatGlucose(s.min, unit) : '—'} unit={unitLabel(unit)} note={s.max !== null ? `أعلى قراءة ${formatGlucose(s.max, unit)}` : ''} />
              <Kpi label="تغطية البيانات" value={String(Math.round(s.coverage))} unit="%" note={`${s.n} قراءة`} />
            </div>
          </Card>
          {vr && <Analytical v={vr} unit={unit} />}
        </div>
      )}
    </>
  );
}

/** GLUCOSE_PLAN 10.10: published variability and risk indices, behind an expandable section, never a target. */
function Analytical({ v, unit }: { v: Variability; unit: 'mmol' | 'mgdl' }) {
  const g = (x: number | null) => (x === null ? '—' : formatGlucose(x, unit));
  const need = (d: number) => `يحتاج ${d} ${d === 1 ? 'يومًا' : d === 2 ? 'يومين' : 'أيام'} من البيانات`;
  const days = (d: number) => (d >= 3 && d <= 10 ? 'أيام' : 'يومًا');
  return (
    <Card>
      <details>
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between">
          <h2 className="font-bold">تحليلي: التقلّب والمخاطر</h2><Badge>ليس هدفًا علاجيًا</Badge>
        </summary>
        <p className="mb-2 text-xs text-slate-500">مقاييس منشورة في الأبحاث، محسوبة على شبكة كل 15 دقيقة دون وصل الانقطاعات. البيانات: <b className="num">{v.days}</b> {days(Math.round(v.days))}.</p>
        <div className="grid grid-cols-2 gap-2">
          <Kpi label="MAGE" value={g(v.mage)} unit={unitLabel(unit)} note={v.mage === null ? need(MIN_DAYS.mage) : 'متوسط التقلبات الأكبر من انحراف معياري'} />
          <Kpi label="MODD" value={g(v.modd)} unit={unitLabel(unit)} note={v.modd === null ? `${need(MIN_DAYS.modd)} متتالية` : 'الفرق عن نفس الوقت أمس'} />
          <Kpi label="CONGA 1 س" value={g(v.conga1)} unit={unitLabel(unit)} note={v.conga1 === null ? need(MIN_DAYS.conga) : `2 س ${g(v.conga2)} · 4 س ${g(v.conga4)}`} />
          <Kpi label="LBGI" value={v.lbgi === null ? '—' : v.lbgi.toFixed(1)} unit="" note={v.lbgi === null ? need(MIN_DAYS.risk) : `خطر الانخفاض: ${lbgiBand(v.lbgi)}`} />
          <Kpi label="HBGI" value={v.hbgi === null ? '—' : v.hbgi.toFixed(1)} unit="" note={v.hbgi === null ? need(MIN_DAYS.risk) : `خطر الارتفاع: ${hbgiBand(v.hbgi)}`} />
          <Kpi label="ADRR" value={v.adrr === null ? '—' : v.adrr.toFixed(0)} unit="" note={v.adrr === null ? need(MIN_DAYS.adrr) : `مدى الخطر اليومي: ${adrrBand(v.adrr)}`} />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
          MAGE: Service 1970 (متوسط الاتجاهين). MODD: Molnar 1972. CONGA: McDonnell 2005. LBGI و HBGI و ADRR: Kovatchev، والتصنيف حسب الحدود المنشورة. للنقاش مع الفريق الطبي.
        </p>
      </details>
    </Card>
  );
}

const fmtPct = (v: number | null) => (v === null ? '—' : `${v < 1 && v > 0 ? v.toFixed(1) : Math.round(v)}%`);

function Kpi({ label, value, unit, note }: { label: string; value: string; unit: string; note?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5"><span className="num text-2xl font-bold">{value}</span> <span className="text-xs text-slate-500">{unit}</span></div>
      {note && <div className="mt-0.5 text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}
