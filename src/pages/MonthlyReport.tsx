// The Monthly Summary: each month of the period as a calendar, every day with its glucose curve, average and lows;
// tap a day to open it full screen. One Export PDF / Share button. Everything comes from the clinical report engine
// (engine/report/monthly.ts); nothing live is used or changed.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backTo } from '../lib/nav';
import { fmt1, fmtPct } from '../engine/report/agpReport';
import { glucoseEvents } from '../engine/report/events';
import { useMonthly, usePatient } from '../lib/useReport';
import { monthlyPdf } from '../lib/monthlyPdf';
import { MiniDay } from '../components/reports/charts';
import { SharePdf } from '../components/SharePdf';
import { useChartViewer } from '../components/reports/ChartViewer';
import { Page, cx } from '../components/ui';
import { Note, daysFrom } from './DoctorReports';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function MonthlyPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const days = daysFrom(sp);
  const { monthly: s, data, loading, error, now } = useMonthly(days);
  const patient = usePatient();
  const { open, viewer } = useChartViewer();
  const all = useMemo(() => (s ? s.months.flatMap((m) => m.days) : []), [s]);
  const lows = useMemo(() => (data && s ? glucoseEvents(data.readings, s.from, Math.min(s.to, now)).hypo1 : []), [data, s, now]);
  return (
    <div dir="ltr" lang="en">
      <Page ltr title="Monthly Summary" back={() => backTo(nav, `/reports?days=${days}`)}>
        {error && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm text-near">Could not load the report: {error}</p>}
        {loading && <p className="py-6 text-center text-slate-500">Loading {days} days…</p>}
        {s && (
          <div className="space-y-3">
            <SharePdf className="w-full" filename={`Monthly-summary-${s.label.replace(/[^0-9A-Za-z]+/g, '-')}.pdf`} title={`Monthly Summary ${s.label}`}
              make={() => monthlyPdf(s, patient, now, __APP_VERSION__)} labels={{ idle: 'Export PDF / Share', making: 'Preparing the PDF…', ready: 'PDF ready · tap to share' }} />
            {s.months.map((mo) => (
              <section key={mo.label} className="space-y-2 rounded-2xl bg-white p-3 shadow-sm">
                <h2 className="text-lg font-bold">{mo.label}</h2>
                <p className="text-xs text-slate-600">In this report: average <b className="num">{mo.avg === null ? '–' : fmt1(mo.avg)}</b> · in range <b className="num">{mo.tir === null ? '–' : fmtPct(mo.tir)}</b> · <b className="num">{mo.lows}</b> lows · {mo.daysWithData} days with data</p>
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-500">{DOW.map((d, i) => <span key={i}>{d}</span>)}</div>
                {mo.weeks.map((wk, r) => (
                  <div key={r} className="grid grid-cols-7 gap-1">
                    {wk.map((c, i) => !c ? <div key={i} /> : (
                      <button key={i} disabled={!c.d || !data} onClick={() => c.d && data && open({ kind: 'day', days: all, index: all.indexOf(c.d), readings: data.readings, lows })}
                        aria-label={c.d ? `${c.d.weekday} ${c.d.date}: open full screen` : undefined}
                        className={cx('min-h-[64px] min-w-0 rounded-lg border p-0.5 text-start', c.inPeriod ? 'border-slate-200 bg-white' : 'border-transparent bg-slate-50')}>
                        <div className={cx('px-0.5 text-[10px] font-bold', !c.inPeriod && 'text-slate-300')}>{c.day}</div>
                        {c.d && <MiniDay d={c.d} />}
                        {c.d && <div className="flex justify-between px-0.5 text-[9px] leading-tight"><b className="num">{c.d.avgMmol === null ? '–' : fmt1(c.d.avgMmol)}</b>{c.d.row.lows > 0 && <b className="text-over">{c.d.row.lows}↓</b>}</div>}
                      </button>
                    ))}
                  </div>
                ))}
              </section>
            ))}
            <p className="text-xs leading-relaxed text-slate-500">Each day: glucose midnight to midnight on the same 0–22 mmol/L scale; the number is the day's average, ↓ its low events (below 3.9 for 15 minutes or more). Tap a day to open it full screen. Days outside the report period are empty; missing sensor data is never filled in.</p>
            <Note />
          </div>
        )}
      </Page>
      {viewer}
    </div>
  );
}
