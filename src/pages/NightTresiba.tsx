// Analysis → Night: her nights on each Tresiba dose. Graphs first, words on request. Read only: it never proposes a dose,
// never says the long-acting dose is too much or too little, never corrects a sensor reading or assumes a low is false,
// and never draws where glucose "would have gone" without a juice. A fall during the night has more than one possible
// cause (Tresiba, NovoRapid still working after the 6-hour screen, the day's food and activity, the sensor), so this
// page shows what happened and how sure each number is; the care team interprets it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useNightReport, NIGHT_DAYS } from '../lib/nightTresiba';
import { CLASSES, NT, clockOf, type DoseGroup, type Night as NightRow, type NightClass, type NightReport, type Doubt, type Prick } from '../engine/nightTresiba';
import { BASAL_DEFAULTS } from '../engine/basal';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { fmtTime } from '../lib/constants';
import { fmt } from '../lib/carbs';
import type { Series } from '../engine/series';
import { Card, Sheet, cx } from '../components/ui';
import { CONF_NAME, fmtDiff } from './DoctorCheck';
import { isEn, t } from '../i18n';

const H = 3600000, MIN = 60000;
export const CLASS: Record<NightClass, { icon: string; name: string; short: string }> = { // i18n-ok: names shown through t()
  clean: { icon: '✅', name: 'ليلة نظيفة: ٦ ساعات بعد النوفورابيد وما في أكل ولا عصير', short: 'نظيفة' }, // i18n-ok
  insulin_food: { icon: '💉', name: 'نوفورابيد أو أكل قريب من الليل', short: 'نوفورابيد/أكل' }, // i18n-ok
  juice: { icon: '🧃', name: 'انعالجت بعصير قبل ٦ الصبح', short: 'عصير' }, // i18n-ok
  sensor: { icon: '📡', name: 'قراءات حساس مشكوك فيها', short: 'الحساس' }, // i18n-ok
};
export const DOUBT: Record<Doubt, string> = { fast_fall: 'نزول أسرع من المعتاد لتحت', v_shape: 'نزلة ورجعة سريعة بدون أكل', prick: 'الوخز يختلف عن الحساس', gaps: 'نقص في القراءات' }; // i18n-ok: shown through t()
const SHAPE: Record<NightClass, 'circle' | 'square' | 'triangle' | 'cross'> = { clean: 'circle', insulin_food: 'square', juice: 'triangle', sensor: 'cross' };

export const perHour = (mg: number, unit: GlucoseUnit) => fmtDiff(mg, unit);
export const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(isEn() ? 'en-GB' : 'ar-KW', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const shortDay = (ms: number) => { const d = new Date(ms + 3 * H); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; }; // the chart reads left to right in both languages
export const hourLabel = (clock: number) => new Date(Date.UTC(2026, 0, 1, Math.round(clock / 60) % 24)).toLocaleTimeString(isEn() ? 'en-GB' : 'ar-KW', { hour: 'numeric', hour12: true, timeZone: 'UTC', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const lowCol = (mg: number | null) => (mg === null ? 'rgb(var(--st-in))' : mg < NT.veryLowMg ? 'rgb(var(--st-low-text))' : mg < NT.lowMg ? 'rgb(var(--st-low))' : 'rgb(var(--st-in))');
const groupKey = (gr: DoseGroup) => `${gr.units}${gr.settling ? 's' : ''}`;
const inGroup = (n: NightRow, gr: DoseGroup) => n.dose?.units === gr.units && n.settling === gr.settling;

/** A night's mark: the shape says its class (never colour alone); the colour says how low it went. */
export function NightMark({ x, y, cls, col, s = 4.6 }: { x: number; y: number; cls: NightClass; col: string; s?: number }) {
  const sh = SHAPE[cls], line = { fill: 'rgb(var(--surface))', stroke: col, strokeWidth: 2 };
  return sh === 'circle' ? <circle cx={x} cy={y} r={s} fill={col} stroke="rgb(var(--surface))" strokeWidth={1.2} />
    : sh === 'square' ? <rect x={x - s + 0.6} y={y - s + 0.6} width={2 * s - 1.2} height={2 * s - 1.2} {...line} />
      : sh === 'triangle' ? <path d={`M${x} ${y - s - 0.6} L${x + s + 0.6} ${y + s - 0.4} L${x - s - 0.6} ${y + s - 0.4}Z`} {...line} />
        : <path d={`M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}`} stroke={col} strokeWidth={2.4} strokeLinecap="round" />;
}

export function NightTresiba() {
  const { settings } = useData();
  const { report, series, error } = useNightReport();
  const [open, setOpen] = useState<NightRow | null>(null);
  const [info, setInfo] = useState(false);
  const unit = settings.glucose_unit;
  return (
    <div className="space-y-3">
      <DoseStrip report={report} onInfo={() => setInfo(true)} />
      {error && <p className="px-1 text-sm text-over">{t('تعذّر تحميل البيانات: {e}', { e: error })}</p>}
      {!report && !error && <p className="px-1 py-6 text-center text-slate-500">{t('جاري التحميل…')}</p>}
      {report && <>
        <NightsChart report={report} unit={unit} onNight={setOpen} />
        <RatesChart report={report} unit={unit} onInfo={() => setInfo(true)} />
        <PerDose report={report} unit={unit} />
        <Pricks report={report} unit={unit} onNight={setOpen} />
        <DailyInsulin report={report} />
      </>}
      <p className="px-2 pb-4 text-center text-xs text-slate-500">{t('للقراءة فقط · للنقاش مع فريق الرعاية · ما يقترح جرعة')}</p>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? dayLabel(open.start) : ''}>
        {open && series && <NightDetail n={open} series={series} unit={unit} />}
      </Sheet>
      <Sheet open={info} onClose={() => setInfo(false)} title={t('كيف تنقرأ صفحة الليل')}>
        <NightInfo />
      </Sheet>
    </div>
  );
}

/** The dose now, how many days on it, and when it is given. */
function DoseStrip({ report, onInfo }: { report: NightReport | null; onInfo: () => void }) {
  const d = report?.doses[report.doses.length - 1];
  return (
    <button onClick={onInfo} className="block w-full rounded-2xl border border-slate-100 bg-white px-3 py-2 text-start active:bg-slate-50">
      <span className="flex items-center gap-2">
        <span aria-hidden>🌙</span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">
          {d ? t('تريسيبا {u} وحدة · الساعة {time} · يوم {k}', { u: fmt(d.units), time: hourLabel(clockOf(d.t)), k: d.nth }) : t('ما في جرعة تريسيبا مسجلة')}
        </span>
        {d && d.prev !== null && d.nth <= NT.settle && <span className="shrink-0 rounded-full bg-near-soft px-2 py-0.5 text-xs font-bold text-near">{t('لسه يستقر')}</span>}
        <span aria-label={t('شرح')} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">i</span>
      </span>
    </button>
  );
}

const W = 340, PL = 28, PR = 6;
/** Every night, oldest on the left: the dose bands on top (with the injection times and the settling nights), and each
 *  night's lowest reading below, shaped by what kind of night it was. */
export function NightsChart({ report, unit, onNight, print }: { report: NightReport; unit: GlucoseUnit; onNight?: (n: NightRow) => void; print?: boolean }) {
  const ns = [...report.nights].reverse();
  if (!ns.length) return <Card><p className="text-sm text-slate-500">{t('ما في ليالي فيها قراءات بعد.')}</p></Card>;
  const cw = (W - PL - PR) / ns.length, mid = (i: number) => PL + cw * (i + 0.5);
  const top = 26, h = 120, lo = 40, hi = 200;
  const Y = (mg: number) => top + h * (1 - (Math.max(lo, Math.min(hi, mg)) - lo) / (hi - lo));
  // dose bands: runs of nights on the same units, with the injection times seen in each run
  const bands: { units: number; a: number; b: number; clocks: number[] }[] = [];
  ns.forEach((n, i) => {
    const u = n.dose?.units ?? 0, last = bands[bands.length - 1];
    if (last && last.units === u) last.b = i; else bands.push({ units: u, a: i, b: i, clocks: [] });
    if (n.dose) bands[bands.length - 1].clocks.push(Math.round(clockOf(n.dose.t) / 60) * 60);
  });
  const times = (cs: number[]) => (Math.abs(cs[cs.length - 1] - cs[0]) >= 90 ? `${hourLabel(cs[0])}→${hourLabel(cs[cs.length - 1])}` : hourLabel(cs[cs.length - 1]));
  const counts = CLASSES.map((c) => [c, ns.filter((n) => n.cls === c).length] as const);
  const g = (mg: number) => formatGlucose(mg, unit);
  return (
    <Card className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2"><h2 className="font-bold">{t('كل ليلة ({n})', { n: ns.length })}</h2><span className="text-[11.5px] text-slate-500">{t('أدنى قراءة ٩ م – ٧ ص')}</span></div>
      <svg viewBox={`0 0 ${W} ${top + h + 18}`} width="100%" direction="ltr" className="block text-slate-500" role="img" aria-label={t('كل ليلة وأدنى قراءة فيها')}>
        <defs><pattern id="settle" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="rgb(var(--st-high))" strokeWidth="2" strokeOpacity="0.55" /></pattern></defs>
        {bands.map((b, k) => {
          const x = PL + cw * b.a, w = cw * (b.b - b.a + 1);
          return (
            <g key={k}>
              <rect x={x + 0.5} y={2} width={w - 1} height={18} rx={4} className="text-brand" fill="currentColor" fillOpacity={0.14 + 0.12 * (k % 3)} />
              <text x={x + w / 2} y={14.5} textAnchor="middle" fontSize={10.5} fontWeight={700} className="text-brand" fill="currentColor">{b.units ? `${fmt(b.units)}U${w > 64 && b.clocks.length ? ' · ' + times(b.clocks) : ''}` : ''}</text>
            </g>
          );
        })}
        {ns.map((n, i) => n.settling && <rect key={'s' + i} x={PL + cw * i} y={top} width={cw} height={h} fill="url(#settle)" fillOpacity={0.5} />)}
        {[180, 70, 54].map((v) => <g key={v}>
          <line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} stroke={v === 180 ? 'currentColor' : 'rgb(var(--st-low))'} strokeOpacity={v === 180 ? 0.15 : 0.6} strokeDasharray={v === 54 ? '2 3' : '4 3'} />
          <text x={PL - 3} y={Y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor">{g(v)}</text>
        </g>)}
        {ns.map((n, i) => n.min !== null && (
          <g key={n.start} onClick={onNight ? () => onNight(n) : undefined} style={onNight ? { cursor: 'pointer' } : undefined} role={onNight ? 'button' : undefined}
            aria-label={onNight ? `${dayLabel(n.start)} · ${t(CLASS[n.cls].short)} · ${g(n.min)}` : undefined}>{/* i18n-ok: table values */}
            <rect x={PL + cw * i} y={top} width={cw} height={h} fill="transparent" />
            <line x1={mid(i)} x2={mid(i)} y1={top} y2={Y(n.min)} stroke="currentColor" strokeOpacity={0.12} />
            <NightMark x={mid(i)} y={Y(n.min)} cls={n.cls} col={lowCol(n.min)} s={Math.min(4.6, cw / 2.6)} />
            {n.minQuestioned && <text x={mid(i)} y={Y(n.min) + 14} textAnchor="middle" fontSize={10} fontWeight={700} fill="currentColor">?</text>}
          </g>
        ))}
        {ns.map((n, i) => (i % Math.ceil(ns.length / 6) === 0 || (i === ns.length - 1 && i % Math.ceil(ns.length / 6) > 2)) && <text key={'d' + i} x={mid(i)} y={top + h + 13} textAnchor="middle" fontSize={9} fill="currentColor">{shortDay(n.start)}</text>)}
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-600">
        {counts.map(([c, k]) => (
          <span key={c} className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="overflow-visible"><NightMark x={7} y={7} cls={c} col="rgb(var(--st-in))" /></svg>
            {t(CLASS[c].short)} <b className="num">{k}</b>{/* i18n-ok: table values */}
          </span>
        ))}
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg, rgb(var(--st-high) / .5) 0 2px, transparent 2px 4px)' }} />{t('أول ٣ ليالي بعد تغيير الجرعة')}</span>
        <span>? {t('القراءة مشكوك فيها، مو محذوفة')}</span>
      </div>
      {!print && <p className="text-[11.5px] text-slate-500">{t('اضغطي على أي ليلة لتفاصيلها.')}</p>}
    </Card>
  );
}

const RX = (mg: number, w: number) => 70 + ((Math.max(-60, Math.min(20, mg)) + 60) / 80) * (w - 78);
/** How fast glucose fell from 00:00 to 06:00 on each dose. Filled = a clean night; hollow = a fasting stretch from another
 *  night (for example the fall before a juice), which leans towards falls and is shown, never pooled with the clean. */
export function RatesChart({ report, unit, onInfo, print }: { report: NightReport; unit: GlucoseUnit; onInfo?: () => void; print?: boolean }) {
  const groups = report.groups;
  const rowH = 30, w = W, hgt = groups.length * rowH + 22;
  const u = unitLabel(unit);
  return (
    <Card className="space-y-1.5">
      <div className="flex items-center gap-2"><h2 className="min-w-0 flex-1 font-bold">{t('سرعة النزول ١٢–٦ الفجر')}</h2>
        {onInfo && <button onClick={onInfo} aria-label={t('شرح')} className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 font-bold text-slate-500">i</button>}</div>
      <p className="text-[11.5px] text-slate-500">{t('{u} بالساعة، في الفترات اللي ما فيها نوفورابيد لـ {h} ساعات ولا أكل ولا عصير لـ {f} ساعات.', { u, h: BASAL_DEFAULTS.rapid_gap_min / 60, f: BASAL_DEFAULTS.food_gap_min / 60 })}</p>
      <svg viewBox={`0 0 ${w} ${hgt}`} width="100%" direction="ltr" className="block text-slate-500" role="img" aria-label={t('سرعة النزول لكل جرعة')}>
        <line x1={RX(0, w)} x2={RX(0, w)} y1={0} y2={hgt - 18} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2 3" />
        {[-60, -40, -20, 0, 20].map((v) => <text key={v} x={RX(v, w)} y={hgt - 5} textAnchor="middle" fontSize={9} fill="currentColor">{v ? perHour(v, unit) : '0'}</text>)}
        {groups.map((gr, k) => {
          const y = k * rowH + rowH / 2, mine = report.nights.filter((n) => inGroup(n, gr) && n.cls !== 'sensor' && n.rate !== null);
          return (
            <g key={groupKey(gr)}>
              <line x1={70} x2={w - 8} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.1} />
              <text x={4} y={y - 1} fontSize={11} fontWeight={700} fill="currentColor">{fmt(gr.units)}U</text>
              <text x={4} y={y + 10} fontSize={8.5} fill="currentColor">{gr.settling ? t('يستقر') : t('ثابتة')}</text>
              {gr.clean >= NT.fewN && gr.rates.median !== null && <rect x={RX(gr.rates.median, w) - 1.5} y={y - 11} width={3} height={22} rx={1.5} fill="currentColor" fillOpacity={0.7} />}
              {mine.map((n, i) => n.cls === 'clean'
                ? <circle key={n.start} cx={RX(n.rate!, w)} cy={y + (i % 2 ? 4 : -4)} r={4.6} fill="rgb(var(--st-in))" stroke="rgb(var(--surface))" strokeWidth={1.2} />
                : <circle key={n.start} cx={RX(n.rate!, w)} cy={y + (i % 2 ? 4 : -4)} r={4} fill="rgb(var(--surface))" stroke="currentColor" strokeWidth={1.6} />)}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-slate-600">
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full bg-[rgb(var(--st-in))]" />{t('ليلة نظيفة')}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full border-[1.6px] border-slate-500" />{t('فترة صيام من ليلة ثانية (قبل عصير مثلًا)')}</span>
        <span dir="ltr">◀ {t('نزول أسرع')}</span>
      </div>
      <ul className="space-y-0.5 text-[12.5px]">
        {groups.map((gr) => <GroupLine key={groupKey(gr)} gr={gr} unit={unit} />)}
      </ul>
      <p className={cx('rounded-xl px-3 py-2 text-[12.5px]', print ? 'bg-slate-50' : 'bg-near-soft/60')}>{t('عدد الليالي قليل: هذي الأرقام ما تكفي للمقارنة بين الجرعات، والنزول بالليل له أكثر من سبب محتمل.')}</p>
    </Card>
  );
}
function GroupLine({ gr, unit }: { gr: DoseGroup; unit: GlucoseUnit }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <b className="num">{fmt(gr.units)}U</b><span className="text-slate-500">{gr.settling ? t('يستقر') : t('ثابتة')}</span>
      <span>{t('نظيفة {n} من {m} ليالي', { n: gr.clean, m: gr.nights })}{gr.range ? <> · <bdi dir="ltr" className="num">{gr.range[0] === gr.range[1] ? perHour(gr.range[0], unit) : `${perHour(gr.range[1], unit)} … ${perHour(gr.range[0], unit)}`}</bdi></> : null}</span>
      <span className="text-slate-500">· {t('فترات صيام {n}', { n: gr.periods.n })}</span>
      <span className="ms-auto rounded-full bg-slate-100 px-2 text-[11px] text-slate-600">{t(CONF_NAME[gr.conf])}</span>
    </li>
  );
}

/** Per dose: nights, nights that went under 3.9 and 3.0, nights treated with juice, and juices that came during a fall. */
export function PerDose({ report, unit }: { report: NightReport; unit: GlucoseUnit }) {
  const cell = 'px-1 py-1.5 text-center';
  return (
    <Card className="space-y-1.5">
      <h2 className="font-bold">{t('الانخفاض والعصير لكل جرعة')}</h2>
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-[11px] text-slate-500"><th className="px-1 text-start font-normal">{t('الجرعة')}</th><th className={cell + ' font-normal'}>{t('ليالي')}</th><th className={cell + ' font-normal'}>{t('تحت {v}', { v: '3.9' })}</th><th className={cell + ' font-normal'}>{t('تحت {v}', { v: '3.0' })}</th><th className={cell + ' font-normal'}>{t('بعصير')}</th><th className={cell + ' font-normal'}>{t('عصير وقت نزول')}</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {report.groups.map((gr) => {
            const ns = report.nights.filter((n) => inGroup(n, gr));
            const vlow = ns.filter((n) => n.min !== null && n.min < NT.veryLowMg).length;
            const tr = ns.flatMap((n) => n.treatments), falling = tr.filter((x) => x.interrupted).length;
            return (
              <tr key={groupKey(gr)}>
                <td className="px-1 py-1.5"><b className="num">{fmt(gr.units)}U</b> <span className="text-[11px] text-slate-500">{gr.settling ? t('يستقر') : t('ثابتة')}</span></td>
                {[gr.nights, gr.low, vlow, gr.juice].map((v, i) => <td key={i} className={cell}><span className="num">{v}</span></td>)}
                <td className={cell}>{tr.length ? t('{k} من {n}', { k: falling, n: tr.length }) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-[11.5px] text-slate-500">{t('«عصير وقت نزول» = السكر كان نازل {v} أو أكثر في الـ {m} دقيقة قبله. العصير يوقف النزول، فما نعرف وين كان بيوصل، والتطبيق ما يخمّن.', { v: `${formatGlucose(NT.juiceFall, unit)} ${unitLabel(unit)}`, m: NT.juiceLookMin })}</p>
    </Card>
  );
}

/** Night finger-pricks beside the sensor reading of the same minutes, exactly as recorded. */
export function Pricks({ report, unit, onNight, print }: { report: NightReport; unit: GlucoseUnit; onNight?: (n: NightRow) => void; print?: boolean }) {
  const [all, setAll] = useState(false);
  const rows = report.nights.flatMap((n) => [...n.pricks].reverse().map((p) => ({ n, p })));
  const shown = all || print ? rows : rows.slice(0, 6);
  const g = (mg: number) => formatGlucose(mg, unit);
  return (
    <Card className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2"><h2 className="font-bold">{t('الوخز والحساس بالليل')}</h2><span className="text-[11.5px] text-slate-500">{unitLabel(unit)}</span></div>
      {!rows.length ? <p className="text-sm text-slate-500">{t('ما في وخز مسجل بالليل.')}</p> : (
        <ul className="divide-y divide-slate-100">
          {shown.map(({ n, p }) => (
            <li key={p.t}>
              <button disabled={!onNight} onClick={() => onNight?.(n)} className="flex min-h-[44px] w-full items-center gap-2 py-1 text-start">
                <span className="min-w-0 flex-1 text-[13px]">{dayLabel(p.t)} · <bdi className="num">{fmtTime(new Date(p.t))}</bdi></span>
                <span className="w-11 text-center"><span className="block text-[10.5px] text-slate-500">{t('الوخز')}</span><b className="num">{g(p.bg)}</b></span>
                <span className="w-11 text-center"><span className="block text-[10.5px] text-slate-500">{t('الحساس')}</span><b className="num">{p.libre === null ? '–' : g(p.libre)}</b></span>
                <PrickChip p={p} unit={unit} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && <button onClick={() => setAll(true)} className="min-h-[40px] w-full text-sm font-bold text-brand">{t('عرض الكل ({n})', { n: rows.length })}</button>}
      <p className="text-[11.5px] text-slate-500">{t('كما انسجلت. التطبيق ما يصحح قراءة الحساس، وما يعتبر أي انخفاض غلط.')}</p>
    </Card>
  );
}
function PrickChip({ p, unit }: { p: Prick; unit: GlucoseUnit }) {
  const base = 'w-[92px] shrink-0 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold';
  if (p.diff === null) return <span className={cx(base, 'bg-slate-100 font-normal text-slate-600')}>{t('ما في قراءة')}</span>;
  if (p.agrees) return <span className={cx(base, 'bg-ok-soft text-ok')}>✓ {t('متقاربة')}</span>;
  return <span className={cx(base, 'bg-near-soft text-near')}>{p.diff < 0 ? t('الحساس أقل {v}', { v: formatGlucose(-p.diff, unit) }) : t('الحساس أعلى {v}', { v: formatGlucose(p.diff, unit) })}</span>;
}

/** Each day's insulin and carbs, averaged by the Tresiba dose in force. */
export function DailyInsulin({ report }: { report: NightReport }) {
  const max = Math.max(1, ...report.dayGroups.map((x) => x.total));
  return (
    <Card className="space-y-2">
      <h2 className="font-bold">{t('إنسولين اليوم كامل')}</h2>
      <ul className="space-y-2.5">
        {report.dayGroups.map((x) => (
          <li key={x.units} className="space-y-1">
            <div className="flex items-baseline gap-2 text-[13px]"><b className="num">{fmt(x.units)}U</b><span className="text-slate-500">{t('{n} أيام', { n: x.days })}</span>
              <span className="num ms-auto" dir="ltr">{fmt(x.long)} + {fmt(x.rapid)} = <b>{fmt(x.total)}</b> U</span></div>
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-100" dir="ltr">
              <span className="bg-brand" style={{ width: `${(x.long / max) * 100}%` }} /><span className="bg-brand/40" style={{ width: `${(x.rapid / max) * 100}%` }} />
            </div>
            <div className="text-[11.5px] text-slate-500">{t('كارب {g} غ باليوم · عصير {j} باليوم · تريسيبا {p}٪ من المجموع', { g: Math.round(x.carbs), j: fmt(x.juices), p: Math.round((x.long / x.total) * 100) })}</div>
          </li>
        ))}
      </ul>
      <div className="flex gap-3 text-[11.5px] text-slate-600"><span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm bg-brand" />{t('تريسيبا')}</span><span className="flex items-center gap-1"><i className="inline-block h-2.5 w-4 rounded-sm bg-brand/40" />{t('نوفورابيد')}</span></div>
      <p className="text-[11.5px] text-slate-500">{t('معدل باليوم من السجل. اليوم الحالي ما ينحسب لين يخلص.')}</p>
    </Card>
  );
}

/** One night: its curve from 9 pm to 7 am with the fasting stretches, juices, finger-pricks and questioned readings. */
function NightDetail({ n, series, unit }: { n: NightRow; series: Series; unit: GlucoseUnit }) {
  const g = (mg: number) => formatGlucose(mg, unit);
  const w = 330, h = 150, lo = 30;
  let hi = 220;
  for (let i = 0; i < series.t.length; i++) if (series.t[i] >= n.start && series.t[i] < n.end) hi = Math.max(hi, series.v[i] + 10);
  for (const p of n.pricks) hi = Math.max(hi, p.bg + 10);
  const X = (ms: number) => 26 + ((ms - n.start) / (n.end - n.start)) * (w - 32), Y = (mg: number) => 6 + (h - 24) * (1 - (Math.max(lo, Math.min(hi, mg)) - lo) / (hi - lo));
  const pts: [number, number, boolean][] = [];
  for (let i = 0; i < series.t.length; i++) if (series.t[i] >= n.start && series.t[i] < n.end) pts.push([series.t[i], series.v[i], n.questioned.some((q) => series.t[i] >= q.from && series.t[i] <= q.to)]);
  // the sensor line, split where readings are questioned (drawn dashed) or missing for 20 minutes
  const path = (want: boolean) => { let d = '', pen = false, prev = 0; for (const [x, v, q] of pts) { const on = q === want; d += on ? `${pen && x - prev < 20 * MIN ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(v).toFixed(1)}` : ''; pen = on; prev = x; } return d; };
  return (
    <div className="space-y-2.5 pb-4">
      <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
        <span className="rounded-full bg-brand-soft px-2 py-0.5 font-bold text-brand">{CLASS[n.cls].icon} {t(CLASS[n.cls].short)}</span>
        {n.dose && <span className="num rounded-full bg-slate-100 px-2 py-0.5">{t('تريسيبا {u} وحدة الساعة {time}', { u: fmt(n.dose.units), time: fmtTime(new Date(n.dose.t)) })}</span>}
        {n.dose && <span className="rounded-full bg-slate-100 px-2 py-0.5">{t('ليلة {k} على هالجرعة', { k: n.dose.nth })}</span>}
        {n.settling && <span className="rounded-full bg-near-soft px-2 py-0.5 font-bold text-near">{t('لسه يستقر')}</span>}
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" direction="ltr" className="block text-slate-500" role="img" aria-label={t('منحنى الليلة')}>
        <rect x={X(n.coreFrom)} y={0} width={X(n.coreTo) - X(n.coreFrom)} height={h - 18} fill="currentColor" fillOpacity={0.05} />
        {[70, 54].map((v) => <g key={v}><line x1={26} x2={w - 6} y1={Y(v)} y2={Y(v)} stroke="rgb(var(--st-low))" strokeOpacity={0.6} strokeDasharray={v === 54 ? '2 3' : '4 3'} /><text x={23} y={Y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor">{g(v)}</text></g>)}
        <text x={23} y={Y(180) + 3} textAnchor="end" fontSize={9} fill="currentColor">{g(180)}</text>
        {n.stretches.map((s) => <rect key={s.from} x={X(s.from)} y={h - 22} width={Math.max(2, X(s.to) - X(s.from))} height={4} rx={2} fill="rgb(var(--st-in))" />)}
        <path d={path(false)} fill="none" className="text-brand" stroke="currentColor" strokeWidth={2} />
        <path d={path(true)} fill="none" stroke="currentColor" strokeOpacity={0.7} strokeWidth={1.6} strokeDasharray="3 3" />
        {n.treatments.map((x) => <g key={x.t}><line x1={X(x.t)} x2={X(x.t)} y1={12} y2={h - 18} stroke="rgb(var(--st-high))" strokeWidth={1.5} /><text x={X(x.t)} y={10} textAnchor="middle" fontSize={11}>🧃</text></g>)}
        {n.pricks.map((p) => <path key={p.t} d={`M${X(p.t)} ${Y(p.bg) - 5.5} L${X(p.t) + 5.5} ${Y(p.bg)} L${X(p.t)} ${Y(p.bg) + 5.5} L${X(p.t) - 5.5} ${Y(p.bg)}Z`} fill="rgb(var(--surface))" stroke="currentColor" strokeWidth={2} className="text-slate-800" />)}
        {[21, 24, 27, 30].map((hh) => <text key={hh} x={X(n.start + (hh - 21) * H)} y={h - 4} textAnchor="middle" fontSize={9} fill="currentColor">{hourLabel((hh % 24) * 60)}</text>)}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span className="flex items-center gap-1"><i className="inline-block h-0.5 w-4 bg-brand" />{t('الحساس')}</span>
        <span className="flex items-center gap-1"><i className="inline-block w-4 border-t-2 border-dashed border-slate-500" />{t('مشكوك فيها')}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rotate-45 border-2 border-slate-800" />{t('الوخز')}</span>
        <span className="flex items-center gap-1"><i className="inline-block h-1 w-4 rounded bg-[rgb(var(--st-in))]" />{t('فترة صيام')}</span>
        <span>🧃 {t('عصير')}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 py-1.5"><div className="text-[11px] text-slate-500">{t('أدنى')}</div><b className="num">{n.min === null ? '–' : g(n.min)}{n.minQuestioned ? ' ?' : ''}</b></div>
        <div className="rounded-xl bg-slate-50 py-1.5"><div className="text-[11px] text-slate-500">{t('تحت {v}', { v: '3.9' })}</div><b className="num">{t('{m} د', { m: n.below70 })}</b></div>
        <div className="rounded-xl bg-slate-50 py-1.5"><div className="text-[11px] text-slate-500">{t('نزول بالساعة')}</div><b className="num" dir="ltr">{n.rate === null ? '–' : perHour(n.rate, unit)}</b></div>
      </div>
      <ul className="space-y-1 text-[13px]">
        {n.rate !== null && <li>⏱ {t('فترة صيام {m} دقيقة، بدأت {v}، بعد آخر نوفورابيد بـ {h} ساعات', { m: n.rateMin, v: g(n.rateStart!), h: n.sinceRapidMin === null ? '–' : fmt(Math.round(n.sinceRapidMin / 6) / 10) })}</li>}
        {n.tags.rapid !== null && <li>💉 {t('نوفورابيد الساعة {time}', { time: fmtTime(new Date(n.tags.rapid)) })}</li>}
        {n.tags.food !== null && <li>🍽️ {t('أكل الساعة {time}', { time: fmtTime(new Date(n.tags.food)) })}</li>}
        {n.treatments.map((x) => <li key={x.t}>🧃 <bdi className="num">{fmtTime(new Date(x.t))}</bdi> · {t('{g} غ', { g: fmt(x.grams) })}{x.at !== null && <> · {t('الحساس {v}', { v: g(x.at) })}</>}{x.fallBefore !== null && <> · {x.interrupted ? t('كان نازل {v} في {m} دقيقة', { v: g(x.fallBefore), m: NT.juiceLookMin }) : t('ما كان نازل بوضوح')}</>}</li>)}
        {n.pricks.map((p) => <li key={p.t}>🩸 <bdi className="num">{fmtTime(new Date(p.t))}</bdi> · {t('الوخز {a} · الحساس {b}', { a: g(p.bg), b: p.libre === null ? '–' : g(p.libre) })}</li>)}
        {n.tags.sensor.map((d) => <li key={d}>📡 {t(DOUBT[d])}</li>)}
      </ul>
      <p className="text-[11.5px] text-slate-500">{t('القراءات المشكوك فيها تنترك برا حساب سرعة النزول بس؛ الانخفاض نفسه ينحسب ويظهر. ما نعرف وين كان السكر بيوصل بدون العصير.')}</p>
      <Link to={`/analysis?mode=day&day=${n.day}`} className="flex min-h-[44px] items-center justify-center rounded-2xl bg-brand-soft font-bold text-brand">{t('افتحي هذا اليوم')}</Link>
    </div>
  );
}

function NightInfo() {
  return (
    <div className="space-y-3 pb-4 text-[14px]">
      <ul className="space-y-1.5">
        {CLASSES.map((c) => <li key={c} className="flex gap-2"><span aria-hidden>{CLASS[c].icon}</span><span>{t(CLASS[c].name)}</span></li>)}
      </ul>
      <p>{t('الليل من ٩ مساءً لين ٧ الصبح. سرعة النزول تنقاس من ١٢ لين ٦ الفجر، في الفترات اللي ما فيها نوفورابيد لـ {h} ساعات ولا أكل أو عصير لـ {f} ساعات. الليلة النظيفة فيها ٣ ساعات أو أكثر من هالفترات.', { h: BASAL_DEFAULTS.rapid_gap_min / 60, f: BASAL_DEFAULTS.food_gap_min / 60 })}</p>
      <p>{t('{h} ساعات بعد النوفورابيد شرط للفرز، مو دليل إن مفعوله والأسباب الثانية (الأكل، النشاط، الحساس) راحت كلها.', { h: BASAL_DEFAULTS.rapid_gap_min / 60 })}</p>
      <p>{t('أول ٣ ليالي بعد تغيير جرعة التريسيبا تنعرض لحالها: التريسيبا ياخذ ٣–٤ أيام عشان يستقر.')}</p>
      <p>{t('النزول بالليل بروحه مو دليل إن جرعة التريسيبا زايدة. التطبيق يعرض اللي صار وعدد الليالي وقلة الثقة، وفريق الرعاية هو اللي يفسّر.')}</p>
      <p className="text-slate-500">{t('آخر {n} يوم، تنحسب من جديد كل ما تنفتح الصفحة.', { n: NIGHT_DAYS })}</p>
    </div>
  );
}
