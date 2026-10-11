// The Daily Log: one day at a time (‹ › to move), the day's numbers, its chart (tap for full screen), then every
// record of the day by time with the sensor glucose at that moment. One Export PDF / Share button for all the days.
// Everything comes from the clinical report engine (engine/report/dailyLog.ts); nothing live is used or changed.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backTo } from '../lib/nav';
import { fmt1, fmtPct, kwDate } from '../engine/report/agpReport';
import { WEEKLY_MAX_DAYS, useDailyLog, usePatient } from '../lib/useReport';
import { DAILY_NOTE_SCREEN, dailyLogPdf } from '../lib/dailyLogPdf';
import { TONE, entryText, kwClock } from '../lib/dailyLogText';
import { WeekDayChart, WeeklyLegend } from '../components/reports/charts';
import { SharePdf } from '../components/SharePdf';
import { Expandable, useChartViewer } from '../components/reports/ChartViewer';
import { Page, cx } from '../components/ui';
import { Note, daysFrom } from './DoctorReports';

const fmtU = (u: number) => String(Math.round(u * 10) / 10);

export function DailyLogPage() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const days = daysFrom(sp);
  const { log, data, loading, error, now, shown, cut } = useDailyLog(days);
  const patient = usePatient();
  const { open, viewer } = useChartViewer();
  const all = log?.days ?? [];
  const idx = Math.max(0, all.findIndex((d) => d.key === sp.get('day')));
  const i = sp.get('day') && all.some((d) => d.key === sp.get('day')) ? idx : all.length - 1;
  const d = all[i];
  const go = (k: number) => setSp({ days: String(days), day: all[k].key }, { replace: true });
  const lows = useMemo(() => all.flatMap((x) => x.lows), [all]);
  return (
    <div dir="ltr" lang="en">
      <Page ltr title="Daily Log" back={() => backTo(nav, `/reports?days=${days}`)}>
        {error && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm text-near">Could not load the report: {error}</p>}
        {loading && <p className="py-6 text-center text-slate-500">Loading {shown} days…</p>}
        {log && d && (
          <div className="space-y-3">
            <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold shadow-sm">{log.label}{cut && <span className="block text-xs font-normal text-slate-500">The Daily Log shows up to {WEEKLY_MAX_DAYS} days: the last {WEEKLY_MAX_DAYS} of the {days} chosen.</span>}</p>
            <SharePdf className="w-full" filename={`Daily-log-${log.label.replace(/[^0-9A-Za-z]+/g, '-')}.pdf`} title={`Daily Log ${log.label}`}
              make={() => dailyLogPdf(log, patient, now, __APP_VERSION__)} labels={{ idle: 'Export PDF / Share (all days)', making: 'Preparing the PDF…', ready: 'PDF ready · tap to share' }} />
            <div className="flex items-center gap-2 rounded-2xl bg-white p-2 shadow-sm">
              <button aria-label="Previous day" disabled={i === 0} onClick={() => go(i - 1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-xl disabled:opacity-30">‹</button>
              <div className="min-w-0 flex-1 text-center"><div className="font-bold">{d.weekday} {kwDate(d.start)}</div>
                <div className={cx('text-xs', d.row.cgm.pctActive < 70 ? 'text-red-700' : 'text-slate-500')}>Day {i + 1} of {all.length} · {d.row.cgm.pctActive === 0 ? 'no sensor data' : `sensor data ${Math.round(d.row.cgm.pctActive)}%`}</div></div>
              <button aria-label="Next day" disabled={i === all.length - 1} onClick={() => go(i + 1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-100 text-xl disabled:opacity-30">›</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {([['Average', d.avgMmol === null ? '–' : fmt1(d.avgMmol), 'mmol/L'],
                ['In range', d.row.cgm.pct ? fmtPct(d.row.cgm.pct.inRange) : '–', '3.9–10.0'],
                ['Below 3.9', d.row.cgm.pct ? fmtPct(d.row.cgm.pct.low + d.row.cgm.pct.veryLow) : '–', 'of sensor time'],
                ['Carbs', d.row.meals ? `${Math.round(d.row.carbs)} g` : '–', d.row.mealsUnknownCarbs ? `+ ${d.row.mealsUnknownCarbs} not known` : `${d.row.meals} meals`],
                ['Insulin given', d.row.total === null ? '–' : `${fmtU(d.row.total)} U`, d.row.total === null ? 'none logged' : `R ${fmtU(d.row.rapid)} · L ${fmtU(d.row.long)}`],
                ['Low events', String(d.row.lows), d.row.treatments ? `${d.row.treatments} treated` : 'no treatments']] as const).map(([l, v, s]) => (
                <div key={l} className="rounded-2xl bg-white px-1 py-2 shadow-sm"><div className={cx('num text-lg font-bold', l === 'Low events' && d.row.lows > 0 && 'text-over')}>{v}</div><div className="text-[11px] font-semibold">{l}</div><div className="text-[10px] text-slate-500">{s}</div></div>
              ))}
            </div>
            <section className="space-y-2 rounded-2xl bg-white p-3 shadow-sm">
              <WeeklyLegend />
              <Expandable label={`${d.weekday} ${d.date}`} onOpen={() => data && open({ kind: 'day', days: all, index: i, readings: data.readings, lows })}><WeekDayChart d={d} /></Expandable>
            </section>
            <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <div className="grid grid-cols-[4.2rem_1fr_auto_3rem] gap-x-2 border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-500"><span>Time</span><span>Record</span><span className="text-end">Amount</span><span className="text-end">Sensor</span></div>
              {d.entries.length === 0 && <p className="px-3 py-4 text-sm text-slate-500">Nothing was recorded on this day.</p>}
              <ul className="divide-y divide-slate-100">
                {d.entries.map((e, k) => {
                  const t = entryText(e);
                  return (
                    <li key={k} className="grid grid-cols-[4.2rem_1fr_auto_3rem] items-start gap-x-2 px-3 py-2 text-sm">
                      <span className="num text-slate-600">{kwClock(e.at)}</span>
                      <span className="min-w-0"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE[t.tone] }} /><span className={cx(e.kind === 'low' && 'font-bold text-over')}>{t.what}</span></span>
                        {t.detail && <span dir="auto" className="block truncate text-xs text-slate-500">{t.detail}</span>}</span>
                      <span className={cx('num text-end', e.kind === 'meal' && e.carbs === null && 'text-over')}>{t.amount}</span>
                      <span className={cx('num text-end font-semibold', e.sensor !== null && e.sensor < 3.9 && 'text-over')}>{e.kind === 'low' || e.kind === 'sensor' ? '' : e.sensor === null ? '–' : fmt1(e.sensor)}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
            <p className="text-xs leading-relaxed text-slate-500">{DAILY_NOTE_SCREEN}</p>
            <Note />
          </div>
        )}
      </Page>
      {viewer}
    </div>
  );
}
