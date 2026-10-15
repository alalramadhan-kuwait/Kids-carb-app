// The visit report's night charts (Analysis → Night became Basal Check): her nights on each Tresiba dose. Read only: it never proposes a dose,
// never says the long-acting dose is too much or too little, never corrects a sensor reading or assumes a low is false,
// and never draws where glucose "would have gone" without a juice. A fall during the night has more than one possible
// cause (Tresiba, NovoRapid still working after the 6-hour screen, the day's food and activity, the sensor), so this
// page shows what happened and how sure each number is; the care team interprets it. A juice at night is a safety action
// (she is woken when glucose is low or about to be): it is never read as Tresiba failing, and what is studied is the fall
// before it.
import { useState } from 'react';
import { CLASSES, EVIDENCE, NT, clockOf, fastingBefore, type Episode, type Evidence, type Night as NightRow, type NightClass, type NightReport, type Doubt, type Prick } from '../../engine/nightTresiba';
import { BASAL_DEFAULTS } from '../../engine/basal';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../../lib/glucose';
import { fmtTime } from '../../lib/constants';
import { fmt } from '../../lib/carbs';
import { Card, cx } from '../../components/ui';
import { fmtDiff } from '../DoctorCheck';
import { isEn, t } from '../../i18n';

const H = 3600000;
export const CLASS: Record<NightClass, { icon: string; name: string; short: string }> = { // i18n-ok: names shown through t()
  clean: { icon: '✅', name: 'ليلة نظيفة: ٦ ساعات بعد النوفورابيد وما في أكل ولا عصير', short: 'نظيفة' }, // i18n-ok
  insulin_food: { icon: '💉', name: 'نوفورابيد أو أكل قريب من الليل', short: 'نوفورابيد/أكل' }, // i18n-ok
  treated: { icon: '🧃', name: 'انعالجت بعصير قبل ٦ الصبح (صحّيناها لأن السكر نازل أو قريب من الانخفاض)', short: 'انعالجت' }, // i18n-ok
  sensor: { icon: '📡', name: 'قراءات حساس مشكوك فيها', short: 'الحساس' }, // i18n-ok
};
export const DOUBT: Record<Doubt, string> = { fast_fall: 'نزول أسرع من المعتاد لتحت', v_shape: 'نزلة ورجعة سريعة بدون أكل', prick: 'الوخز يختلف عن الحساس', gaps: 'نقص في القراءات' }; // i18n-ok: shown through t()
const SHAPE: Record<NightClass, 'circle' | 'square' | 'triangle' | 'cross'> = { clean: 'circle', insulin_food: 'square', treated: 'triangle', sensor: 'cross' };
/** Why a juice was given, from what was measured then. {v} is the low line (3.9). */
export const EVIDENCE_NAME: Record<Evidence, { icon: string; name: string }> = { // i18n-ok: names shown through t()
  confirmed_low: { icon: '🩸', name: 'انخفاض مؤكد بالوخز (تحت {v})' }, sensor_low: { icon: '📡', name: 'الحساس تحت {v}، بدون وخز' }, // i18n-ok
  sensor_low_finger_higher: { icon: '📡', name: 'الحساس تحت {v}، والوخز {v} أو أكثر' }, preventive_finger: { icon: '🛡️', name: 'وقائي: الوخز {v} أو أكثر' }, // i18n-ok
  preventive: { icon: '🛡️', name: 'وقائي: الحساس {v} أو أكثر، بدون وخز' }, // i18n-ok
};
const arrow = (tr: number | null) => (tr === null ? '' : tr <= -1 ? '↓' : tr <= -0.3 ? '↘' : tr < 0.3 ? '→' : tr < 1 ? '↗' : '↑');

export const perHour = (mg: number, unit: GlucoseUnit) => fmtDiff(mg, unit);
export const dayLabel = (ms: number) => new Date(ms).toLocaleDateString(isEn() ? 'en-GB' : 'ar-KW', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kuwait', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const shortDay = (ms: number) => { const d = new Date(ms + 3 * H); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; }; // the chart reads left to right in both languages
export const hourLabel = (clock: number) => new Date(Date.UTC(2026, 0, 1, Math.round(clock / 60) % 24)).toLocaleTimeString(isEn() ? 'en-GB' : 'ar-KW', { hour: 'numeric', hour12: true, timeZone: 'UTC', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const lowCol = (mg: number | null) => (mg === null ? 'rgb(var(--st-in))' : mg < NT.veryLowMg ? 'rgb(var(--st-low-text))' : mg < NT.lowMg ? 'rgb(var(--st-low))' : 'rgb(var(--st-in))');

/** A night's mark: the shape says its class (never colour alone); the colour says how low it went. */
export function NightMark({ x, y, cls, col, s = 4.6 }: { x: number; y: number; cls: NightClass; col: string; s?: number }) {
  const sh = SHAPE[cls], line = { fill: 'rgb(var(--surface))', stroke: col, strokeWidth: 2 };
  return sh === 'circle' ? <circle cx={x} cy={y} r={s} fill={col} stroke="rgb(var(--surface))" strokeWidth={1.2} />
    : sh === 'square' ? <rect x={x - s + 0.6} y={y - s + 0.6} width={2 * s - 1.2} height={2 * s - 1.2} {...line} />
      : sh === 'triangle' ? <path d={`M${x} ${y - s - 0.6} L${x + s + 0.6} ${y + s - 0.4} L${x - s - 0.6} ${y + s - 0.4}Z`} {...line} />
        : <path d={`M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}`} stroke={col} strokeWidth={2.4} strokeLinecap="round" />;
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

/** Before each juice: why it was given (from what was measured), and what glucose did before the first juice. */
export function BeforeJuice({ report, unit, onNight, print }: { report: NightReport; unit: GlucoseUnit; onNight?: (n: NightRow) => void; print?: boolean }) {
  const [all, setAll] = useState(false);
  const rows = report.nights.flatMap((n) => [...n.episodes].reverse().map((e) => ({ n, e })));
  if (!rows.length) return null;
  const g = (mg: number) => formatGlucose(mg, unit), low = g(NT.lowMg);
  const count = (k: Evidence) => rows.filter((r) => r.e.evidence === k).length;
  const mid = (xs: number[]) => { const d = [...xs].sort((a, b) => a - b), m = d.length >> 1; return d.length ? (d.length % 2 ? d[m] : (d[m - 1] + d[m]) / 2) : null; };
  const falls = rows.map((r) => r.e.fall).filter((f): f is NonNullable<Episode['fall']> => !!f && f.rate !== null);
  const early = rows.filter((r) => r.e.fall && r.e.sinceRapidMin !== null && r.e.sinceRapidMin < BASAL_DEFAULTS.rapid_gap_min).length;
  const shown = all || print ? rows : rows.slice(0, 6);
  const follow = rows.reduce((a, r) => a + r.e.followUps.length, 0);
  const pre = report.nights.flatMap((n) => n.episodes.filter(fastingBefore).map((e) => ({ n, e })));
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2"><h2 className="font-bold">{t('قبل كل عصير ({n})', { n: rows.length })}{follow > 0 && <span className="text-[12px] font-normal text-slate-500"> · {t('+{k} متابعة', { k: follow })}</span>}</h2><span className="text-[11.5px] text-slate-500">{unitLabel(unit)}</span></div>
      <p className="text-[12px] text-slate-600">{t('العصير إجراء أمان: نصحّيها لما السكر نازل أو قريب من الانخفاض. هنا اللي صار قبل أول عصير؛ اللي بعده ما ينحسب.')}</p>
      <ul className="grid grid-cols-1 gap-1 text-[12.5px]">
        {EVIDENCE.map((k) => (
          <li key={k} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1"><span aria-hidden>{EVIDENCE_NAME[k].icon}</span><span className="min-w-0 flex-1">{t(EVIDENCE_NAME[k].name, { v: low })}</span><b className="num">{count(k)}</b></li>
        ))}
      </ul>
      {falls.length > 0 && <p className="text-[12.5px]">{t('النزول قبل العصير: بدأ عادةً من {a} واستمر حوالي {m} دقيقة. {k} من {n} بدأ خلال {h} ساعات من النوفورابيد.', { a: g(mid(falls.map((f) => f.start))!), m: Math.round(mid(falls.map((f) => f.minutes))!), k: early, n: rows.length, h: BASAL_DEFAULTS.rapid_gap_min / 60 })}</p>}
      {pre.length > 0 && (
        <div className="rounded-lg bg-ok-soft/50 px-2 py-1.5 text-[12.5px]">
          <b>{t('بدون نوفورابيد لـ {h} ساعات قبل العصير', { h: BASAL_DEFAULTS.rapid_gap_min / 60 })}</b> · {t('{n} مرات', { n: pre.length })}
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">{pre.map(({ n, e }) => <span key={e.t}><b className="num">{n.dose ? `${fmt(n.dose.units)}U` : ''}</b> <bdi dir="ltr" className="num">{perHour(e.fasting!.rate!, unit)}</bdi><span className="text-slate-500">{t('/س')} · {t('{m} د', { m: e.fasting!.minutes })}</span></span>)}</div>
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {shown.map(({ n, e }) => (
          <li key={e.t}>
            <button disabled={!onNight} onClick={() => onNight?.(n)} className="flex min-h-[48px] w-full items-center gap-2 py-1 text-start">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{dayLabel(e.t)} · <bdi className="num">{fmtTime(new Date(e.t))}</bdi>{e.juices.length > 1 && <span className="text-slate-500"> · {t('{n} عصير', { n: e.juices.length })}</span>}</span>
                <span className="block text-[11.5px] text-slate-500">{e.fall && e.fall.rate !== null ? t('نزل من {a} خلال {m} د', { a: g(e.fall.start), m: e.fall.minutes }) : e.gap ? t('نقص في القراءات قبله') : t('ما في نزول واضح قبله')}{e.prick && !e.prick.after ? <> · {t('الوخز {v}', { v: g(e.prick.bg) })}</> : null}</span>
              </span>
              <span className="w-14 text-center"><span className="block text-[10.5px] text-slate-500">{t('الحساس')}</span><b className="num">{e.libre === null ? '–' : g(e.libre)} {arrow(e.trend)}</b></span>
              <span className="w-7 text-center text-lg" title={t(EVIDENCE_NAME[e.evidence].name, { v: low })} aria-label={t(EVIDENCE_NAME[e.evidence].name, { v: low })}>{EVIDENCE_NAME[e.evidence].icon}</span>
            </button>
            {e.followUps.map((f) => (
              <button key={f.t} disabled={!onNight} onClick={() => onNight?.(n)} className="flex min-h-[40px] w-full items-center gap-2 pb-1 ps-4 text-start">
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px]">↳ <bdi className="num">{fmtTime(new Date(f.t))}</bdi> · {f.afterMin >= 10 ? t('علاج ثاني بعد {m} د (١٥-١٥)', { m: f.afterMin }) : t('علاج ثاني بعد {m} د', { m: f.afterMin })}</span>
                  <span className="block text-[11.5px] text-slate-500">{f.lowest !== null ? t('بينهم أقل حساس {v}', { v: g(f.lowest) }) : ''}{f.pricks.some((p) => p.t > e.t) ? '' : <> · {t('ما في وخز بينهم')}</>}</span>
                </span>
                <span className="w-14 text-center"><span className="block text-[10.5px] text-slate-500">{t('الحساس')}</span><b className="num">{f.libre === null ? '–' : g(f.libre)} {arrow(f.trend)}</b></span>
                <span className="w-7 text-center text-lg" aria-hidden>🔁</span>
              </button>
            ))}
          </li>
        ))}
      </ul>
      {rows.length > shown.length && <button onClick={() => setAll(true)} className="min-h-[40px] w-full text-sm font-bold text-brand">{t('عرض الكل ({n})', { n: rows.length })}</button>}
      {report.unsure.length > 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-[12.5px]">
          <b>{t('مشروبات مسجلة كأكل بالليل، ما انحسبت علاج ({n})', { n: report.unsure.length })}</b>
          <ul className="mt-0.5 space-y-0.5">{report.unsure.map((u) => <li key={u.t}>❓ {dayLabel(u.t)} · <bdi className="num">{fmtTime(new Date(u.t))}</bdi> · <bdi>{u.name}</bdi> · {t('الحساس {v}', { v: u.libre === null ? '–' : g(u.libre) })}</li>)}</ul>
          <p className="text-[11.5px] text-slate-500">{t('ما في قراءة أو وقت يبيّن إنها علاج، فتبقى أكل. أكدوها إذا كانت علاج. السجل الأصلي ما يتغيّر.')}</p>
        </div>
      )}
      <p className="text-[11.5px] text-slate-500">{t('الوخز وحده يؤكد الانخفاض. الحساس بالليل قرأ أقل من الوخز أكثر من مرة، فالتطبيق ما يحكم إن الانخفاض صح أو غلط.')}</p>
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
