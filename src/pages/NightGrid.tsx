// Analysis → Night, the hours she sleeps (00:00–07:00): every night as one strip of colour, and when the first reading
// under the low line came. Graphs first; read only; the sensor as it read (nothing corrected or called false); a juice
// is a safety action, never read as Tresiba failing; no dose is ever proposed.
import { useMemo } from 'react';
import { NT, type Night as NightRow, type NightReport } from '../engine/nightTresiba';
import { NG, nightGrid } from '../engine/nightGrid';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import type { Series } from '../engine/series';
import { Card } from '../components/ui';
import { hourLabel } from './NightTresiba';
import { t } from '../i18n';

const H = 3600000;
const shortDay = (ms: number) => { const d = new Date(ms + 3 * H); return `${d.getUTCDate()}/${d.getUTCMonth() + 1}`; };
const fill = (mg: number | null) => mg === null ? { fill: 'transparent' }
  : mg < NT.veryLowMg ? { fill: 'rgb(var(--st-low-text))' } : mg < NT.lowMg ? { fill: 'rgb(var(--st-low))' }
    : mg > 180 ? { fill: 'rgb(var(--st-high))' } : { fill: 'rgb(var(--st-in))', fillOpacity: mg < 100 ? 0.6 : 0.25 };

const W = 340, LW = 58, RH = 15;
/** One strip per night, 00:00 on the left to 07:00 on the right; 🧃 a treatment, a red dot a finger-prick. */
export function NightGrid({ report, series, unit, onNight, print, last = 14 }: { report: NightReport; series: Series; unit: GlucoseUnit; onNight?: (n: NightRow) => void; print?: boolean; last?: number }) {
  const grid = useMemo(() => nightGrid(report, series, print ? Infinity : last), [report, series, print, last]);
  const ns = grid.nights;
  if (!ns.length) return null;
  const byDay = new Map(report.nights.map((n) => [n.day, n]));
  const span = (NG.toH - NG.fromH) * H, x = (tm: number, n: { from: number }) => LW + ((tm - n.from) / span) * (W - LW - 4);
  const bw = (W - LW - 4) / ns[0].bins.length, top = 2, h = top + ns.length * RH + 16;
  const g = (mg: number) => formatGlucose(mg, unit);
  return (
    <Card className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2"><h2 className="font-bold">{t('من ١٢ لين ٧ الصبح')}</h2><span className="text-[11.5px] text-slate-500">{t('آخر {n} ليلة', { n: ns.length })}</span></div>
      <svg viewBox={`0 0 ${W} ${h}`} width="100%" direction="ltr" className="block text-slate-500" role="img" aria-label={t('كل ليلة من ١٢ لين ٧ الصبح')}>
        {ns.map((n, r) => {
          const y = top + r * RH, row = byDay.get(n.day);
          return (
            <g key={n.day} onClick={onNight && row ? () => onNight(row) : undefined} style={onNight ? { cursor: 'pointer' } : undefined}>
              <text x={2} y={y + 10.5} fontSize={9} fill="currentColor">{shortDay(n.from)}</text>
              {n.units !== null && <><rect x={26} y={y + 1.5} width={28} height={RH - 4} rx={3} className="text-brand" fill="currentColor" fillOpacity={n.settling ? 0.1 : 0.2} />
                <text x={40} y={y + 10.5} textAnchor="middle" fontSize={8.5} fontWeight={700} className="text-brand" fill="currentColor">{fmt(n.units)}U</text></>}
              {n.bins.map((v, i) => <rect key={i} x={LW + i * bw + 0.3} y={y + 1.5} width={bw - 0.6} height={RH - 4} rx={1.5} {...fill(v)} />)}
              {n.juices.map((j) => <text key={'j' + j} x={x(j, n)} y={y + 10} textAnchor="middle" fontSize={9}>🧃</text>)}
              {n.pricks.map((p) => <circle key={'p' + p.t} cx={x(p.t, n)} cy={y + RH - 3} r={2.6} fill="rgb(var(--st-low-text))" stroke="rgb(var(--surface))" strokeWidth={1} />)}
            </g>
          );
        })}
        {Array.from({ length: NG.toH - NG.fromH + 1 }, (_, k) => (
          <text key={k} x={LW + (k / (NG.toH - NG.fromH)) * (W - LW - 4)} y={h - 3} textAnchor={k === 0 ? 'start' : k === NG.toH - NG.fromH ? 'end' : 'middle'} fontSize={9} fill="currentColor">{hourLabel(k * 60)}</text>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-600">
        {([[40, '< ' + g(NT.veryLowMg)], [60, '< ' + g(NT.lowMg)], [90, g(NT.lowMg) + '–' + g(100)], [150, g(100) + '–' + g(180)], [200, '> ' + g(180)]] as const).map(([mg, label]) => (
          <span key={mg} className="flex items-center gap-1"><svg width="12" height="12" aria-hidden><rect width="12" height="12" rx="3" {...fill(mg)} /></svg><span className="num">{label}</span></span>
        ))}
        <span>🧃 {t('علاج')}</span>
        <span className="flex items-center gap-1"><svg width="8" height="8" aria-hidden><circle cx="4" cy="4" r="3.2" fill="rgb(var(--st-low-text))" /></svg>{t('وخز')}</span>
      </div>
      {!print && <p className="text-[11.5px] text-slate-500">{t('اضغطي على أي ليلة لتفاصيلها.')}</p>}
    </Card>
  );
}

/** When the first reading under the low line came, by hour; how many nights went under it on each dose; and how many
 *  treatments had a finger-prick before them. Counts only: nothing here says the dose is too much or too little. */
export function NightOnset({ report, series, unit, last = Infinity }: { report: NightReport; series: Series; unit: GlucoseUnit; last?: number }) {
  const grid = useMemo(() => nightGrid(report, series, last), [report, series, last]);
  const mx = Math.max(1, ...grid.onset);
  const treated = grid.nights.filter((n) => n.prickBefore !== null), pricked = treated.filter((n) => n.prickBefore).length;
  return (
    <Card className="space-y-3">
      <div>
        <div className="flex items-baseline justify-between gap-2"><h2 className="font-bold">{t('متى يبدأ النزول؟')}</h2><span className="text-[11.5px] text-slate-500">{t('أول قراءة تحت {v}', { v: formatGlucose(NT.lowMg, unit) })} · {t('آخر {n} ليلة', { n: grid.nights.length })}</span></div>
        <div dir="ltr" className="mt-5 flex h-20 items-end gap-1.5">
          {grid.onset.map((k, i) => (
            <div key={i} className="relative flex-1 rounded-t" style={{ height: `${k ? (k / mx) * 100 : 3}%`, background: k ? 'rgb(var(--st-low))' : 'rgb(var(--st-in) / .25)' }}>
              {k > 0 && <span className="num absolute -top-4 w-full text-center text-[12px] font-bold">{k}</span>}
            </div>
          ))}
        </div>
        <div dir="ltr" className="mt-1 flex gap-1.5 text-[10.5px] text-slate-500">{grid.onset.map((_, i) => <span key={i} className="flex-1 text-center">{hourLabel(i * 60)}</span>)}</div>
      </div>
      {grid.byDose.length > 0 && (
        <div className="flex flex-wrap justify-around gap-2 border-t border-slate-100 pt-2 text-center">
          {grid.byDose.map((d, i) => (
            <div key={i}><div className="num text-[22px] font-extrabold">{d.low}/{d.nights}</div><span className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-bold text-brand">{fmt(d.units)}U</span></div>
          ))}
        </div>
      )}
      {grid.byDose.length > 0 && <p className="text-center text-[11.5px] text-slate-500">{t('ليالي نزل فيها الحساس تحت {v} / كل الليالي، على كل جرعة', { v: formatGlucose(NT.lowMg, unit) })}</p>}
      {treated.length > 0 && (
        <div className="flex items-center justify-center gap-2 border-t border-slate-100 pt-2 text-[14px]">
          <span>🩸</span><b className="num">{pricked}/{treated.length}</b><span className="text-slate-600">{t('ليالي العلاج فيها وخز قبل العصير')}</span>
        </div>
      )}
    </Card>
  );
}
