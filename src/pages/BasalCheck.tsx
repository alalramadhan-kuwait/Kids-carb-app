// Analysis → Basal Check: how her glucose behaves while she is fasting, on each Tresiba dose. It replaces the Night page
// (and the care-team Overnight card). Graphs first, few words. Read only: it never proposes a dose, never calls a dose
// right or wrong, never sets a "safe" rate of fall, never corrects a sensor reading or calls a low false. A juice is a
// safety action: it ends the fasting period, and nothing after it is used.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useBasalCheck, BASAL_DAYS } from '../lib/nightTresiba';
import { BC, STATUSES, doseStats, inFilter, summary, type BasalReport, type Filter, type Period, type Phase, type Reason, type Status } from '../engine/basalCheck';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { fmtTime } from '../lib/constants';
import { fmt } from '../lib/carbs';
import type { Series } from '../engine/series';
import { Card, Sheet, cx, toast } from '../components/ui';
import { fmtDiff } from './DoctorCheck';
import { isEn, t } from '../i18n';

const H = 3600000, MIN = 60000;
const FILTERS: { id: Filter; label: string }[] = [{ id: 'night', label: 'الليل' }, { id: 'day', label: 'النهار' }, { id: 'all', label: 'الكل' }]; // i18n-ok: shown through t()
export const STATUS: Record<Status, { icon: string; name: string; cls: string }> = { // i18n-ok: names shown through t()
  clean: { icon: '✓', name: 'نظيفة', cls: 'bg-brand-soft text-brand' }, // i18n-ok
  affected: { icon: '◐', name: 'متأثرة', cls: 'bg-slate-100 text-slate-700' }, // i18n-ok
  uncertain: { icon: '?', name: 'غير أكيدة', cls: 'bg-near-soft text-near' }, // i18n-ok
  excluded: { icon: '–', name: 'مستبعدة', cls: 'bg-slate-50 text-slate-400' }, // i18n-ok
};
export const REASON: Record<Reason, string> = { // i18n-ok: shown through t()
  short: 'أقل من ساعة', no_readings: 'ما في قراءات', rapid_recent: 'نوفورابيد قبل أقل من ٦ ساعات', exercise: 'نشاط خلال ١٢ ساعة', // i18n-ok
  coverage: 'نقص في القراءات', artifact: 'نزلة مشكوك فيها (ممكن ضغط على الحساس)', prick_disagrees: 'الوخز يختلف عن الحساس', no_dose: 'ما في تريسيبا مسجلة خلال ٣٠ ساعة', // i18n-ok
};
export const PHASE: Record<Phase, string> = { stable: 'ثابتة', transition: 'أول ٣ أيام', unknown: 'بداية السجل' }; // i18n-ok: shown through t()
const EVID: Record<NonNullable<Period['treatment']>['evidence'], string> = { // i18n-ok: shown through t()
  confirmed: 'انخفاض مؤكد بالوخز', finger_not_low: 'الوخز ما كان منخفض', cgm_low: 'الحساس تحت 3.9، بدون وخز', preventive: 'وقائي: الحساس فوق 3.9', // i18n-ok
};
const day = (ms: number) => new Date(ms).toLocaleDateString(isEn() ? 'en-GB' : 'ar-KW', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const shortDay = (ms: number) => { const d = new Date(ms + 3 * H); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
export const durText = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? t('{h}س {m}د', { h, m }) : t('{h}س', { h })) : t('{m}د', { m }); };

export function BasalCheck() {
  const { settings } = useData();
  const { report, series, error } = useBasalCheck();
  const [f, setF] = useState<Filter>('night');
  const [dose, setDose] = useState<number | null>(null);
  const [open, setOpen] = useState<Period | null>(null);
  const [info, setInfo] = useState(false);
  const unit = settings.glucose_unit;
  const last = report?.doses[report.doses.length - 1];
  const change = report ? [...report.doses].reverse().find((d) => d.nth === 1) : undefined;
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 px-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold leading-tight">{t('فحص القاعدي')}</h2>
          <p className="text-[12.5px] text-slate-500">
            {last ? t('تريسيبا {u} وحدة · من {d}', { u: fmt(last.units), d: change ? day(change.t) : '–' }) : t('ما في جرعة تريسيبا مسجلة')}
            {report && <> · {t('{n} فترة صيام', { n: report.periods.filter((p) => p.status !== 'excluded').length })}</>}
          </p>
        </div>
        <button onClick={() => setInfo(true)} aria-label={t('شرح')} className="grid h-11 w-11 shrink-0 place-items-center"><span className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">i</span></button>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-50 p-1" role="tablist">
        {FILTERS.map((x) => (
          <button key={x.id} role="tab" aria-selected={f === x.id} onClick={() => setF(x.id)}
            className={cx('min-h-[44px] rounded-full text-sm font-bold', f === x.id ? 'bg-brand text-white' : 'text-slate-600')}>{t(x.label)}</button>
        ))}
      </div>
      {error && <p className="px-1 text-sm text-over">{t('تعذّر تحميل البيانات: {e}', { e: error })}</p>}
      {!report && !error && <p className="px-1 py-6 text-center text-slate-500">{t('جاري التحميل…')}</p>}
      {report && <>
        <Headline report={report} f={f} unit={unit} />
        <DoseCompare report={report} f={f} unit={unit} selected={dose} onPick={(u) => setDose(dose === u ? null : u)} />
        <PeriodList report={report} f={f} unit={unit} dose={dose} onOpen={setOpen} onClear={() => setDose(null)} />
        <DoctorSummary report={report} f={f} unit={unit} />
      </>}
      <p className="px-2 pb-4 text-center text-xs text-slate-500">{t('للقراءة فقط · للنقاش مع الدكتور · ما يقترح جرعة')}</p>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? day(open.from) : ''}>
        {open && series && <PeriodDetail p={open} series={series} report={report!} unit={unit} />}
      </Sheet>
      <Sheet open={info} onClose={() => setInfo(false)} title={t('كيف يشتغل فحص القاعدي')}><BasalInfo /></Sheet>
    </div>
  );
}

/** Three numbers: fasting periods, the typical change, the lows. */
function Headline({ report, f, unit }: { report: BasalReport; f: Filter; unit: GlucoseUnit }) {
  const s = summary(report, f);
  return (
    <Card className="!p-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><div className="num text-[24px] font-extrabold leading-tight">{s.eligible}</div><div className="text-[11.5px] text-slate-500">{t('صالحة للتحليل')}</div></div>
        <div><div dir="ltr" className="num text-[24px] font-extrabold leading-tight">{s.change === null ? '–' : fmtDiff(s.change, unit)}</div>
          <div className="text-[11.5px] text-slate-500">{t('التغيّر المعتاد')}</div></div>
        <div><div className="num text-[24px] font-extrabold leading-tight">{s.lows.all}</div><div className="text-[11.5px] text-slate-500">{t('انخفاض تحت {v}', { v: formatGlucose(BC.lowMg, unit) })}</div></div>
      </div>
      <p className={cx('mt-2 rounded-xl px-2 py-1 text-center text-[12px]', s.insufficient ? 'bg-near-soft text-near' : 'bg-slate-50 text-slate-600')}>
        {s.insufficient ? t('بيانات غير كافية: أقل من ٣ فترات نظيفة؛ الرقم من النظيفة والمتأثرة') : t('من {n} فترة نظيفة', { n: s.clean })}
        {s.perHour !== null && <> · <span dir="ltr" className="num">{fmtDiff(s.perHour, unit)}</span>{t('/ساعة')}</>}
        {s.lows.all + s.lows.brief > 0 && <> · {t('مؤكد بالوخز {k}', { k: s.lows.finger })}</>}
      </p>
    </Card>
  );
}

/** Median change per dose (clean periods), from a zero line; neutral colours: no dose is shown as approved. */
export function DoseCompare({ report, f, unit, selected, onPick, print }: { report: BasalReport; f: Filter; unit: GlucoseUnit; selected?: number | null; onPick?: (u: number) => void; print?: boolean }) {
  const rows = doseStats(report, f);
  if (!rows.length) return null;
  const vals = rows.map((r) => r.change ?? 0), lim = Math.max(BC.stableMg * 2, ...vals.map(Math.abs)) * 1.1;
  const W = 340, mid = 200, half = 120, X = (mg: number) => mid + (mg / lim) * half, RH = 34;
  const ref = BC.stableMg;
  return (
    <Card className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2"><h2 className="font-bold">{t('حسب الجرعة')}</h2><span className="text-[11.5px] text-slate-500">{t('وسيط التغيّر في الفترات النظيفة')}</span></div>
      <svg viewBox={`0 0 ${W} ${rows.length * RH + 16}`} width="100%" direction="ltr" className="block text-slate-500" role="img" aria-label={t('التغيّر حسب جرعة التريسيبا')}>
        <rect x={X(-ref)} y={0} width={X(ref) - X(-ref)} height={rows.length * RH} fill="currentColor" fillOpacity={0.06} />
        <line x1={mid} x2={mid} y1={0} y2={rows.length * RH} stroke="currentColor" strokeOpacity={0.5} />
        {rows.map((r, i) => {
          const y = i * RH, on = selected === r.units, v = r.change;
          return (
            <g key={`${r.units}${r.phase}`} onClick={onPick ? () => onPick(r.units) : undefined} style={onPick ? { cursor: 'pointer' } : undefined} role={onPick ? 'button' : undefined}
              aria-label={`${fmt(r.units)}U ${t(PHASE[r.phase])}`}>{/* i18n-ok: label */}
              <rect x={0} y={y} width={W} height={RH} fill={on ? 'rgb(var(--primary-strong) / .08)' : 'transparent'} rx={6} />
              <text x={4} y={y + 15} fontSize={12.5} fontWeight={800} className="text-brand" fill="currentColor">{fmt(r.units)}U</text>
              <text x={4} y={y + 28} fontSize={9.5} fill="currentColor">{t(PHASE[r.phase])}</text>
              {v !== null && <rect x={Math.min(X(v), mid)} y={y + 9} width={Math.abs(X(v) - mid)} height={14} rx={4} className="text-brand" fill="currentColor"
                fillOpacity={r.insufficient ? 0 : r.phase === 'stable' ? 0.75 : 0.35} stroke="currentColor" strokeWidth={r.insufficient ? 1.5 : 0} strokeDasharray={r.insufficient ? '3 2' : undefined} />}
              <text x={v === null ? mid + 6 : v < 0 ? Math.min(X(v), mid) - 4 : X(v) + 4} y={y + 20} fontSize={11} fontWeight={700} textAnchor={v !== null && v < 0 ? 'end' : 'start'} fill="currentColor" className="text-slate-800">
                {v === null ? t('ما في نظيفة') : fmtDiff(v, unit)}
              </text>
              <text x={W - 2} y={y + 20} fontSize={10} textAnchor="end" fill="currentColor">n={r.clean}{r.other ? `+${r.other}` : ''}</text>
            </g>
          );
        })}
        <text x={mid} y={rows.length * RH + 12} fontSize={9.5} textAnchor="middle" fill="currentColor">0</text>
        <text x={X(-ref)} y={rows.length * RH + 12} fontSize={9.5} textAnchor="middle" fill="currentColor">−{formatGlucose(ref, unit)}</text>
        <text x={X(ref)} y={rows.length * RH + 12} fontSize={9.5} textAnchor="middle" fill="currentColor">+{formatGlucose(ref, unit)}</text>
      </svg>
      <p className="text-[11px] text-slate-500">
        {t('n = نظيفة + متأثرة/غير أكيدة. الخط المتقطع: أقل من ٣ نظيفة (بيانات غير كافية). المنطقة الرمادية ±{v}: مرجع غير رسمي فقط.', { v: formatGlucose(ref, unit) })}
        {!print && onPick && ' ' + t('اضغطي على جرعة لتصفية القائمة.')}
      </p>
    </Card>
  );
}

function PeriodList({ report, f, unit, dose, onOpen, onClear }: { report: BasalReport; f: Filter; unit: GlucoseUnit; dose: number | null; onOpen: (p: Period) => void; onClear: () => void }) {
  const [showEx, setShowEx] = useState(false);
  const all = report.periods.filter((p) => inFilter(p.win, f) && (dose === null || p.dose?.units === dose)).reverse();
  const ex = all.filter((p) => p.status === 'excluded'), rows = showEx ? all : all.filter((p) => p.status !== 'excluded');
  const g = (mg: number | null) => (mg === null ? '–' : formatGlucose(mg, unit));
  return (
    <Card className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">{t('فترات الصيام ({n})', { n: all.length - ex.length })}</h2>
        {dose !== null ? <button onClick={onClear} className="min-h-[32px] rounded-full bg-brand-soft px-2.5 text-[12px] font-bold text-brand">{fmt(dose)}U ✕</button>
          : <span className="text-[11.5px] text-slate-500">{unitLabel(unit)}</span>}
      </div>
      {!rows.length && <p className="py-3 text-center text-sm text-slate-500">{t('ما في فترات صيام بهذا الفلتر.')}</p>}
      <ul className="divide-y divide-slate-100">
        {rows.map((p) => (
          <li key={p.id}>
            <button onClick={() => onOpen(p)} className="flex min-h-[48px] w-full items-center gap-2 py-1.5 text-start active:bg-slate-50">
              <span className="w-[46px] shrink-0 leading-tight"><span className="num block text-[13px] font-bold">{shortDay(p.from)}</span>
                <span className="num block text-[11px] text-slate-500">{fmtTime(new Date(p.from))}</span></span>
              <span className="num w-9 shrink-0 text-[12px] font-bold text-brand">{p.dose ? `${fmt(p.dose.units)}U` : '–'}</span>
              <span dir="ltr" className="num min-w-0 flex-1 text-[13px]">{g(p.start)} → {g(p.end)}</span>
              <span dir="ltr" className="num w-12 shrink-0 text-end text-[14px] font-extrabold">{p.change === null ? '–' : fmtDiff(p.change, unit)}</span>
              <span className="w-[52px] shrink-0 whitespace-nowrap text-end text-[11.5px] text-slate-500">{durText(p.minutes)}</span>
              <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold', STATUS[p.status].cls)} title={t(STATUS[p.status].name)}>{STATUS[p.status].icon}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-slate-500">
        {STATUSES.filter((s) => s !== 'excluded').map((s) => <span key={s} className="flex items-center gap-1"><span className={cx('grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold', STATUS[s].cls)}>{STATUS[s].icon}</span>{t(STATUS[s].name)}</span>)}
        {ex.length > 0 && <button onClick={() => setShowEx(!showEx)} className="min-h-[32px] font-bold text-brand">{showEx ? t('إخفاء المستبعدة') : t('عرض المستبعدة ({n})', { n: ex.length })}</button>}
      </div>
    </Card>
  );
}

/** One period on the real sensor curve, with every logged event around it. Zoom with − / +; tap to read a value. */
function PeriodDetail({ p, series, report, unit }: { p: Period; series: Series; report: BasalReport; unit: GlucoseUnit }) {
  const { events, history } = useData();
  const [zoom, setZoom] = useState(1);
  const [pick, setPick] = useState<{ t: number; v: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const g = (mg: number | null) => (mg === null ? '–' : formatGlucose(mg, unit));
  const a = p.from - 2 * H, b = Math.min(report.to, p.to + H);
  const pts: [number, number][] = [];
  for (let i = 0; i < series.t.length; i++) if (series.t[i] >= a && series.t[i] <= b) pts.push([series.t[i], series.v[i]]);
  let hi = 200; for (const [, v] of pts) hi = Math.max(hi, v + 10);
  const lo = 40, w = 330 * zoom, h = 170, top = 16, bot = 20;
  const X = (ms: number) => 8 + ((ms - a) / (b - a)) * (w - 16), Y = (mg: number) => top + (h - top - bot) * (1 - (Math.max(lo, Math.min(hi, mg)) - lo) / (hi - lo));
  const isQ = (x: number) => p.questioned.some((q) => x >= q.from && x <= q.to);
  const line = (want: boolean) => { let d = '', prev = 0, pen = false; for (const [x, v] of pts) { const on = isQ(x) === want; d += on ? `${pen && x - prev < BC.gapMin * MIN ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(v).toFixed(1)}` : ''; pen = on; prev = x; } return d; };
  const at = (e: { occurred_at: string }) => Date.parse(e.occurred_at);
  const ev = events.filter((e) => !e.deleted_at && at(e) >= a && at(e) <= b);
  const meals = history.filter((m) => Date.parse(m.eaten_at) >= a && Date.parse(m.eaten_at) <= b);
  const marks = [
    ...ev.filter((e) => e.kind === 'insulin').map((e) => ({ t: at(e), g: e.insulin_type === 'long' ? '🌙' : '💉', label: `${fmt(Number(e.insulin_units ?? 0))}U` })),
    ...ev.filter((e) => e.kind === 'treatment').map((e) => ({ t: at(e), g: '🧃', label: '' })),
    ...ev.filter((e) => e.kind === 'exercise').map((e) => ({ t: at(e), g: '🏃', label: '' })),
    ...meals.map((m) => ({ t: Date.parse(m.eaten_at), g: '🍽️', label: m.total_carbs ? `${Math.round(m.total_carbs)}g` : '' })),
  ];
  const pricks = report.pricks.filter((x) => x.t >= a && x.t <= b);
  const ticks: number[] = []; for (let x = Math.ceil(a / H) * H; x <= b; x += (zoom > 1.5 ? 1 : 2) * H) ticks.push(x);
  const onTap = (cx: number) => { let best: [number, number] | null = null; for (const q of pts) if (!best || Math.abs(X(q[0]) - cx) < Math.abs(X(best[0]) - cx)) best = q; if (best) setPick({ t: best[0], v: best[1] }); };
  return (
    <div className="space-y-2.5 pb-4">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className={cx('rounded-full px-2 py-0.5 font-bold', STATUS[p.status].cls)}>{STATUS[p.status].icon} {t(STATUS[p.status].name)}</span>
        {p.dose && <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('تريسيبا {u}U · {phase} · يوم {d}', { u: fmt(p.dose.units), phase: t(PHASE[p.dose.phase]), d: Math.floor(p.dose.daysOnDose) + 1 })}</span>}
        <span className="num rounded-full bg-slate-100 px-2 py-0.5">{fmtTime(new Date(p.from))} → {fmtTime(new Date(p.to))} · {durText(p.minutes)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span className="num text-[12.5px] text-slate-600">{pick ? `${fmtTime(new Date(pick.t))} · ${g(pick.v)}` : t('اضغطي على المنحنى لقراءة القيمة')}</span>
        <span className="flex gap-1">
          <button onClick={() => setZoom(Math.max(1, zoom / 2))} disabled={zoom <= 1} aria-label={t('تصغير')} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 font-bold disabled:opacity-40">−</button>
          <button onClick={() => setZoom(Math.min(8, zoom * 2))} disabled={zoom >= 8} aria-label={t('تكبير')} className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 font-bold disabled:opacity-40">+</button>
        </span>
      </div>
      <div ref={box} dir="ltr" className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} width={zoom === 1 ? '100%' : w * 1.05} height={zoom === 1 ? undefined : h * 1.05} className="block text-slate-500" role="img" aria-label={t('منحنى الحساس')}
          onClick={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); onTap(((e.clientX - r.left) / r.width) * w); }}>
          <rect x={X(p.from)} y={top} width={X(p.to) - X(p.from)} height={h - top - bot} fill="rgb(var(--primary-strong) / .07)" />
          {[70, 54, 180].map((v) => <g key={v}><line x1={8} x2={w - 8} y1={Y(v)} y2={Y(v)} stroke={v === 180 ? 'currentColor' : 'rgb(var(--st-low))'} strokeOpacity={v === 180 ? 0.2 : 0.6} strokeDasharray={v === 54 ? '2 3' : '4 3'} />
            <text x={10} y={Y(v) - 2} fontSize={9} fill="currentColor">{g(v)}</text></g>)}
          <path d={line(false)} fill="none" className="text-brand" stroke="currentColor" strokeWidth={2} />
          <path d={line(true)} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.6} strokeDasharray="3 3" />
          {p.start !== null && <circle cx={X(p.from)} cy={Y(p.start)} r={4} fill="rgb(var(--surface))" stroke="currentColor" strokeWidth={2} className="text-brand" />}
          {p.end !== null && <circle cx={X(p.to)} cy={Y(p.end)} r={4} className="text-brand" fill="currentColor" />}
          {p.low !== null && p.lowAt !== null && <g><circle cx={X(p.lowAt)} cy={Y(p.low)} r={3.5} fill="rgb(var(--st-low))" /><text x={X(p.lowAt)} y={Y(p.low) + 13} fontSize={9.5} textAnchor="middle" fill="currentColor" fontWeight={700}>{g(p.low)}</text></g>}
          {marks.map((m, i) => <g key={i}><line x1={X(m.t)} x2={X(m.t)} y1={top} y2={h - bot} stroke="currentColor" strokeOpacity={0.25} /><text x={X(m.t)} y={12} fontSize={11} textAnchor="middle">{m.g}</text>
            {m.label && zoom > 1 && <text x={X(m.t) + 8} y={12} fontSize={8.5} fill="currentColor">{m.label}</text>}</g>)}
          {pricks.map((x) => <path key={x.t} d={`M${X(x.t)} ${Y(x.bg) - 5} L${X(x.t) + 5} ${Y(x.bg)} L${X(x.t)} ${Y(x.bg) + 5} L${X(x.t) - 5} ${Y(x.bg)}Z`} fill="rgb(var(--surface))" stroke="currentColor" strokeWidth={2} className="text-slate-800" />)}
          {pick && <line x1={X(pick.t)} x2={X(pick.t)} y1={top} y2={h - bot} stroke="currentColor" strokeWidth={1} className="text-slate-800" />}
          {ticks.map((x) => <text key={x} x={X(x)} y={h - 5} fontSize={9} textAnchor="middle" fill="currentColor">{fmtTime(new Date(x))}</text>)}
        </svg>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm bg-brand-soft" />{t('فترة الصيام')}</span>
        <span className="flex items-center gap-1"><i className="inline-block w-4 border-t-2 border-dashed border-slate-500" />{t('مشكوك فيها')}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rotate-45 border-2 border-slate-800" />{t('الوخز')}</span>
        <span>💉 {t('نوفورابيد')}</span><span>🌙 {t('تريسيبا')}</span><span>🍽️ {t('أكل')}</span><span>🧃 {t('علاج')}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        {[[t('التغيّر'), p.change === null ? '–' : fmtDiff(p.change, unit)], [t('بالساعة'), p.perHour === null ? '–' : fmtDiff(p.perHour, unit)], [t('أدنى'), g(p.low)], [t('تحت {v}', { v: g(BC.lowMg) }), t('{m}د', { m: p.belowMin })]].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-slate-50 py-1.5"><div className="text-[10.5px] text-slate-500">{k}</div><b dir="ltr" className="num text-[14px]">{v}</b></div>
        ))}
      </div>
      <ul className="space-y-1 text-[13px]">
        <li>📈 {t('من {a} إلى {b}', { a: g(p.start), b: g(p.end) })} · {t('الاتجاه العام')} <bdi dir="ltr" className="num">{p.trend === null ? '–' : fmtDiff(p.trend, unit)}</bdi>{t('/ساعة')}</li>
        {p.sinceRapidMin !== null && <li>💉 {t('آخر نوفورابيد قبل البداية بـ {h} ساعة', { h: fmt(Math.round(p.sinceRapidMin / 6) / 10) })}{p.iobAtStart !== null && <> · {t('الباقي حسب النموذج {u} وحدة (تقدير)', { u: fmt(p.iobAtStart) })}</>}</li>}
        {p.sinceFoodMin !== null && <li>🍽️ {t('آخر أكل قبل البداية بـ {h} ساعة', { h: fmt(Math.round(p.sinceFoodMin / 6) / 10) })}</li>}
        {p.treatment && <li>🧃 {t('انتهت بعلاج الساعة {time}: {why}', { time: fmtTime(new Date(p.treatment.t)), why: t(EVID[p.treatment.evidence]) })}</li>}
        {p.endedBy === 'food' && <li>🍽️ {t('انتهت بأكل')}</li>}
        {p.endedBy === 'rapid' && <li>💉 {t('انتهت بنوفورابيد')}</li>}
        {p.pricks.map((x) => <li key={x.t}>🩸 <bdi className="num">{fmtTime(new Date(x.t))}</bdi> · {t('الوخز {a} · الحساس {b}', { a: g(x.bg), b: g(x.libre) })}</li>)}
        {p.gaps.n > 0 && <li>📡 {t('{n} انقطاع بالقراءات ({m} د)', { n: p.gaps.n, m: p.gaps.minutes })}</li>}
        {p.reasons.map((r) => <li key={r}>• {t(REASON[r])}</li>)}
      </ul>
      <p className="text-[11.5px] text-slate-500">{t('القراءات كما سجلها الحساس، بدون تصحيح. اللي بعد العلاج ما ينحسب. ما نعرف وين كان السكر بيوصل بدون العصير.')}</p>
      <Link to={`/analysis?mode=day&day=${p.from}`} className="flex min-h-[44px] items-center justify-center rounded-2xl bg-brand-soft font-bold text-brand">{t('افتحي هذا اليوم')}</Link>
    </div>
  );
}

/** The facts for the doctor, as plain lines; copied as text. No dose advice. */
export function doctorLines(report: BasalReport, f: Filter, unit: GlucoseUnit): { facts: string[]; limits: string[]; ask: string[] } {
  const g = (mg: number | null) => (mg === null ? '–' : formatGlucose(mg, unit)), d = (mg: number | null) => (mg === null ? '–' : fmtDiff(mg, unit));
  const s = summary(report, f), rows = doseStats(report, f);
  const where = f === 'night' ? t('بالليل (١٢–٦ الصبح)') : f === 'day' ? t('بالنهار') : t('على مدار اليوم');
  const facts = [
    t('{days} يوم، {w}: {n} فترة صيام (نظيفة {c}، متأثرة {a}، غير أكيدة {u})، و{x} مستبعدة.', { days: BASAL_DAYS, w: where, n: s.eligible + s.uncertain, c: s.clean, a: s.affected, u: s.uncertain, x: s.excluded }),
    t('نزل السكر أكثر من {r} في {k} منها، وبقي ضمن ±{r2} في {st}، وارتفع في {up}.', { r: g(BC.stableMg), r2: g(BC.stableMg), k: s.falling, st: s.stable, up: s.rising }),
    s.change === null ? t('ما في فترات كافية للوسيط.') : t('الوسيط{q}: من {a} إلى {b}، تغيّر {c} ({h} بالساعة).', { q: s.usesClean ? '' : t(' (بيانات غير كافية، يشمل المتأثرة)'), a: g(s.start), b: g(s.end), c: d(s.change), h: d(s.perHour) }),
    t('حسب الجرعة (نظيفة + أخرى): {list}.', { list: rows.map((r) => `${fmt(r.units)}U ${t(PHASE[r.phase])} ${r.clean}+${r.other}${r.insufficient ? '' : ` ${d(r.change)}`}`).join(isEn() ? '; ' : '؛ ') }) // i18n-ok: list
      + (rows.some((r) => r.insufficient) ? ' ' + t('أقل من ٣ نظيفة = بيانات غير كافية.') : ''),
    t('انخفاض تحت {v} لـ١٥ دقيقة أو أكثر: {n} (بالوخز {f}، الوخز أعلى {h}، من الحساس فقط {o})؛ تحت {w}: {k}؛ ونزلات أقصر: {b}.', { v: g(BC.lowMg), w: g(BC.veryLowMg), n: s.lows.all, f: s.lows.finger, h: s.lows.fingerHigher, o: s.lows.cgmOnly, k: s.lows.below54, b: s.lows.brief }),
    t('{n} فترة انتهت بعلاج (عصير)؛ مؤكد بالوخز قبلها: {c}.', { n: s.treated, c: s.treatedConfirmed }),
  ];
  const pr = report.pricks.filter((p) => p.libre !== null && p.bg < 144);
  if (pr.length) facts.push(t('تحت 8: الحساس أقل من الوخز في {k} من {n} وخزات.', { k: pr.filter((p) => p.libre! < p.bg).length, n: pr.length }));
  const limits = [
    t('أغلب الأرقام من الحساس؛ ما انصححت، وما في انخفاض اعتبرناه غلط.'),
    t('الفترات اللي تنتهي بعصير تقف عند العصير، فالنزول بعدها غير معروف.'),
    t('أول ٣ أيام بعد تغيير الجرعة تنعرض لحالها (التريسيبا يستقر خلال ٣–٤ أيام).'),
    t('النشاط البدني ما ينسجل، فأثره غير محسوب.'),
  ];
  const ask = [t('هل النزول المتكرر وقت الصيام يستدعي مراجعة القاعدي، مع إن أغلب الانخفاضات ما انأكدت بالوخز؟'), t('هل الاحتياج بالليل يختلف عن النهار عندها؟'), t('متى نوخز قبل العلاج بالليل؟')];
  return { facts, limits, ask };
}

function DoctorSummary({ report, f, unit }: { report: BasalReport; f: Filter; unit: GlucoseUnit }) {
  const { facts, limits, ask } = useMemo(() => doctorLines(report, f, unit), [report, f, unit]);
  const copy = async () => {
    const text = [t('فحص القاعدي (تريسيبا والصيام)'), ...facts.map((x) => '• ' + x), '', t('حدود:'), ...limits.map((x) => '• ' + x), '', t('أسئلة:'), ...ask.map((x) => '• ' + x), '', t('ما يقترح جرعة.')].join('\n');
    try { await navigator.clipboard.writeText(text); toast(t('نُسخ ✓')); } catch { toast(text); }
  };
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2"><h2 className="font-bold">🩺 {t('للدكتور')}</h2>
        <button onClick={copy} className="min-h-[40px] rounded-full bg-brand-soft px-3 text-[13px] font-bold text-brand">{t('نسخ الملخص')}</button></div>
      <ul className="list-disc space-y-1 ps-5 text-[13px]">{facts.map((x) => <li key={x}>{x}</li>)}</ul>
      <details className="text-[12.5px] text-slate-600"><summary className="min-h-[36px] cursor-pointer font-bold">{t('الحدود والأسئلة')}</summary>
        <ul className="list-disc space-y-1 ps-5">{limits.map((x) => <li key={x}>{x}</li>)}</ul>
        <ul className="mt-1 list-disc space-y-1 ps-5 font-medium text-slate-700">{ask.map((x) => <li key={x}>{x}</li>)}</ul>
      </details>
    </Card>
  );
}

/** The care-team report and the visit report: the dose comparison and the facts, nothing to tap. */
export function BasalCompact({ report, unit, f = 'night' }: { report: BasalReport; unit: GlucoseUnit; f?: Filter }) {
  const { facts } = doctorLines(report, f, unit);
  return (
    <div className="space-y-2">
      <DoseCompare report={report} f={f} unit={unit} print />
      <Card><ul className="list-disc space-y-1 ps-5 text-[13px]">{facts.map((x) => <li key={x}>{x}</li>)}</ul></Card>
    </div>
  );
}

function BasalInfo() {
  return (
    <div className="space-y-2 pb-4 text-[13.5px] leading-relaxed">
      <p>{t('فترة الصيام: تبدأ بعد ٣ ساعات من آخر أكل أو عصير، وبعد ٦ ساعات من آخر نوفورابيد (إذا ما في وقت كافي، تبدأ بعد ٣ ساعات وتنعلّم «متأثرة»). تنتهي عند أول أكل أو عصير أو نوفورابيد.')}</p>
      <p>{t('نظيفة: ما في شي يأثر. متأثرة: نوفورابيد قبل أقل من ٦ ساعات أو نشاط. غير أكيدة: نقص قراءات، نزلة مشكوك فيها، وخز يختلف، أو ما في تريسيبا مسجلة. مستبعدة: أقل من ساعة.')}</p>
      <p>{t('الليل = الفترات اللي أغلبها بين ١٢ و٦ الصبح؛ كل فترة تنحسب مرة وحدة.')}</p>
      <p>{t('التغيّر = النهاية − البداية (بعد تنعيم بسيط). بالساعة = التغيّر ÷ المدة. الاتجاه العام = ميل مقاوم للقراءات الشاذة.')}</p>
      <p>{t('±1.7: مرجع غير رسمي لاختبار القاعدي، مو حد طبي. ما في حد معتمد لسرعة النزول عند الأطفال.')}</p>
      <p className="text-[12px] text-slate-600">{t('المراجع: ISPAD 2022 (الفصل 8 أهداف السكر؛ الفصل 11 الانخفاض: أقل من 3.9 تنبيه، أقل من 3.0 مهم سريريًا)؛ إجماع CGM الدولي (النوبة ١٥ دقيقة أو أكثر)؛ نشرة تريسيبا (الاستقرار خلال ٣–٤ أيام، نصف العمر ~٢٥ ساعة).')}</p>
    </div>
  );
}
