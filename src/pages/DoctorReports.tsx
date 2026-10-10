// Doctor reports: one page with the reports a clinic reads (LibreView's set), English and mmol/L. One period for
// all of them (14 days by default), a data check, then report cards; each report opens in a clean view with one
// "Export PDF / Share" button. Every number comes from the clinical report engine (src/engine/report); nothing on
// the live screens, the alerts or the dose calculator is used or changed here.
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { backTo } from '../lib/nav';
import { REPORT_PERIODS, VALIDATION_NOTE, fmt1, fmtPct, type AgpReport, type ReportDays } from '../engine/report/agpReport';
import { WEEKLY_MAX_DAYS, savePatient, useAgpReport, usePatient, useWeeklySummary } from '../lib/useReport';
import { WEEKLY_NOTE, weeklyPdf } from '../lib/weeklyPdf';
import { agpPdf, ageText } from '../lib/reportPdf';
import { AgpChart, DayProfile, RANGE_COLOR, TirBar, WeekDayChart, WeeklyLegend } from '../components/reports/charts';
import { SharePdf } from '../components/SharePdf';
import { useData } from '../lib/data';
import { Btn, Page, Sheet, cx, inputCls, toast } from '../components/ui';

const daysFrom = (sp: URLSearchParams): ReportDays => { const n = Number(sp.get('days')); return (REPORT_PERIODS as readonly number[]).includes(n) ? (n as ReportDays) : 14; };

function PeriodPicker({ days, onChange }: { days: ReportDays; onChange: (d: ReportDays) => void }) {
  return (
    <div className="grid grid-cols-4 gap-1 rounded-full bg-slate-100 p-1 text-sm" role="radiogroup" aria-label="Report period">
      {REPORT_PERIODS.map((d) => (
        <button key={d} role="radio" aria-checked={days === d} onClick={() => onChange(d)} className={cx('min-h-[40px] rounded-full', days === d ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{d} days</button>
      ))}
    </div>
  );
}

function DataCheck({ r }: { r: AgpReport }) {
  return r.sufficiency.ok
    ? <p className="rounded-xl bg-ok-soft px-3 py-2 text-sm font-semibold text-ok">✓ {r.label} · sensor data {fmtPct(r.metrics.pctActive)} of the time</p>
    : <p className="rounded-xl bg-near-soft px-3 py-2 text-sm font-semibold text-near">⚠ {r.label} · not enough for a standard AGP: {r.sufficiency.reason}. Numbers are shown, marked incomplete.</p>;
}

const Note = () => <p className="text-xs leading-relaxed text-slate-500">{VALIDATION_NOTE}</p>;

/** Doctor reports: the list. */
export function DoctorReports() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const days = daysFrom(sp);
  const { report: r, loading, error } = useAgpReport(days);
  const patient = usePatient();
  const [edit, setEdit] = useState(false);
  const soon = (title: string, sub: string) => (
    <li className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-2 text-slate-400"><span><span className="block font-semibold">{title}</span><span className="block text-sm">{sub}</span></span><span className="text-xs">Coming later</span></li>
  );
  return (
    <div dir="ltr" lang="en">
      <Page ltr title="Doctor reports" back={() => backTo(nav, '/more')}>
        <div className="space-y-3">
          <PeriodPicker days={days} onChange={(d) => setSp({ days: String(d) }, { replace: true })} />
          <button onClick={() => setEdit(true)} className="flex min-h-[48px] w-full items-center justify-between rounded-2xl bg-white px-4 text-start shadow-sm">
            <span className="min-w-0 truncate"><b>{patient.name || 'Add patient name'}</b>{patient.birthDate && <span className="text-slate-500"> · {ageText(patient.birthDate, Date.now())}{patient.birthApprox ? ' (approx.)' : ''}</span>}{patient.clinic && <span className="text-slate-500"> · {patient.clinic}</span>}</span>
            <span className="shrink-0 text-sm font-bold text-brand">Edit</span>
          </button>
          {error && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm text-near">Could not load the report: {error}</p>}
          {loading && <p className="py-6 text-center text-slate-500">Loading {days} days…</p>}
          {r && <DataCheck r={r} />}

          {r && (
            <Link to={`/reports/agp?days=${days}`} className="block space-y-2 rounded-2xl bg-white p-4 shadow-sm active:bg-slate-50">
              <div className="flex items-baseline justify-between"><h2 className="text-lg font-bold">AGP Report</h2><span className="text-slate-300">›</span></div>
              <p className="text-sm text-slate-500">Time in ranges, average, GMI, variability and the daily pattern</p>
              <TirBar r={r} />
              <div className="flex flex-wrap gap-x-4 text-sm"><span><b className="num">{fmtPct(r.ranges[2].pct)}</b> in range</span><span>avg <b className="num">{r.metrics.mean === null ? '–' : fmt1(r.metrics.mean / 18.016)}</b></span><span>GMI <b className="num">{r.metrics.gmi === null ? '–' : `${fmt1(r.metrics.gmi)}%`}</b></span></div>
              <AgpChart r={r} compact />
            </Link>
          )}
          <Link to={`/reports/weekly?days=${days}`} className="block space-y-1 rounded-2xl bg-white p-4 shadow-sm active:bg-slate-50">
            <div className="flex items-baseline justify-between"><h2 className="text-lg font-bold">Weekly Summary</h2><span className="text-slate-300">›</span></div>
            <p className="text-sm text-slate-500">Each day's glucose with carbs, insulin given, low treatments and low events{days > 14 ? ' (last 14 days)' : ''}</p>
          </Link>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">
            {soon('Daily Log', 'Glucose, meals, insulin and treatments by time')}
            {soon('Snapshot', 'One page of key numbers')}
            {soon('Mealtime Patterns', 'Glucose before and after meals')}
            {soon('Monthly Summary', 'Month by month')}
          </ul>
          <Note />
        </div>
      </Page>
      <PatientSheet open={edit} onClose={() => setEdit(false)} />
    </div>
  );
}

function PatientSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePatient();
  const { reload } = useData();
  const [f, setF] = useState(p);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(!p.birthApprox && !!p.birthDate);
  const field = (label: string, key: 'name' | 'birthDate' | 'diagnosisDate' | 'clinic', type = 'text', hint?: string) => (
    <label className="block space-y-1"><span className="text-sm font-medium text-slate-600">{label}</span>
      <input id={`patient-${key}`} className={inputCls} type={type} dir="ltr" value={f[key] ?? ''} onChange={(e) => setF({ ...f, [key]: e.target.value || null })} />
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}</label>
  );
  const save = async () => {
    setBusy(true);
    try { await savePatient(f, verified && !!f.birthDate); await reload(); toast('Saved ✓'); onClose(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Patient details on the reports">
      <div dir="ltr" lang="en" className="space-y-3">
        {field('Name (English letters, as on the report)', 'name')}
        {field('Date of birth', 'birthDate', 'date', p.birthApprox ? 'Saved as approximate; also used for growth charts' : 'Also used for growth charts')}
        <label className="flex min-h-[44px] items-center gap-3 text-sm"><input id="patient-dob-verified" type="checkbox" className="h-5 w-5" checked={verified} disabled={!f.birthDate} onChange={(e) => setVerified(e.target.checked)} />
          <span>Date of birth verified (from an official document). Until then the reports say "approx.".</span></label>
        {field('Date of diagnosis', 'diagnosisDate', 'date')}
        {field('Clinic (optional)', 'clinic')}
        <Btn kind="primary" block disabled={busy} onClick={save}>Save</Btn>
      </div>
    </Sheet>
  );
}

const Section = ({ title, children, className }: { title: string; children: ReactNode; className?: string }) => (
  <section className={cx('space-y-2 rounded-2xl bg-white p-4 shadow-sm', className)}><h2 className="font-bold">{title}</h2>{children}</section>
);

/** The AGP report: summary first, the chart, targets and events; details folded away; one export button. */
export function AgpReportPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const days = daysFrom(sp);
  const { report: r, loading, error } = useAgpReport(days);
  const patient = usePatient();
  const m = r?.metrics;
  return (
    <div dir="ltr" lang="en">
      <Page ltr title="AGP Report" back={() => backTo(nav, `/reports?days=${days}`)}>
        {error && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm text-near">Could not load the report: {error}</p>}
        {loading && <p className="py-6 text-center text-slate-500">Loading {days} days…</p>}
        {r && m && (
          <div className="space-y-3">
            <DataCheck r={r} />
            <SharePdf className="w-full" filename={`AGP-report-${r.label.replace(/[^0-9A-Za-z]+/g, '-')}.pdf`} title={`AGP Report ${r.label}`}
              make={() => agpPdf(r, patient, __APP_VERSION__)} labels={{ idle: 'Export PDF / Share', making: 'Preparing the PDF…', ready: 'PDF ready · tap to share' }} />
            <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-baseline gap-2"><b className="num text-4xl">{fmtPct(r.ranges[2].pct)}</b><span className="text-slate-600">in target range 3.9–10.0</span></div>
              <p className={cx('text-sm font-semibold', r.targets[0]?.met ? 'text-ok' : 'text-over')}>{r.targets[0]?.met ? '✓' : '✗'} Goal: more than 70%</p>
              <TirBar r={r} height={18} />
              <ul className="space-y-1 pt-1 text-sm">
                {r.ranges.map((x) => (
                  <li key={x.key} className="flex items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: RANGE_COLOR[x.key] }} />
                    <span className="flex-1">{x.name} <span className="text-slate-500">{x.range.replace(' mmol/L', '')}</span></span><b className="num">{fmtPct(x.pct)}</b></li>
                ))}
              </ul>
            </section>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[['Average', m.mean === null ? '–' : fmt1(m.mean / 18.016), 'mmol/L'], ['GMI', m.gmi === null ? '–' : `${fmt1(m.gmi)}%`, m.gmi === null ? 'needs 14 days' : 'estimated A1c'], ['CV', m.cv === null ? '–' : `${fmt1(m.cv)}%`, r.cvStable ? 'stable (≤36%)' : 'above 36%']].map(([l, v, s]) => (
                <div key={l} className="rounded-2xl bg-white px-2 py-3 shadow-sm"><div className="num text-xl font-bold">{v}</div><div className="text-xs font-semibold">{l}</div><div className="text-[11px] text-slate-500">{s}</div></div>
              ))}
            </div>
            <Section title="Daily pattern (AGP)">
              <AgpChart r={r} />
              <p className="text-xs text-slate-500">Line: median. Dark band: 25–75%. Light band: 5–95%. Green: target 3.9–10.0. Tap the chart for values.</p>
            </Section>
            <Section title="Targets for children (ISPAD 2024)">
              <ul className="space-y-1 text-sm">
                {r.targets.map((t) => (
                  <li key={t.label} className="flex items-center gap-2"><span className={cx('w-4 font-bold', t.met ? 'text-ok' : 'text-over')}>{t.met ? '✓' : '✗'}</span><span className="flex-1">{t.label}<span className="block text-xs text-slate-500">{t.goal}</span></span><b className="num">{fmtPct(t.value)}</b></li>
                ))}
              </ul>
            </Section>
            <Section title="Low and high events">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><b className="num text-xl">{r.events.lows}</b> lows<span className="block text-xs text-slate-500">below 3.9 for 15 min or more · {fmt1(r.events.lowsPerWeek)} a week</span></div>
                <div><b className="num text-xl">{r.events.veryLows}</b> very low<span className="block text-xs text-slate-500">below 3.0 for 15 min or more</span></div>
              </div>
              <p className="text-xs text-slate-500">For this report only; the live alerts on the phones have their own rules and are not changed.</p>
            </Section>
            <details className="rounded-2xl bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-bold">More details</summary>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                <dt>% time sensor active</dt><dd className="num font-semibold">{fmtPct(m.pctActive)}</dd>
                <dt>Standard deviation</dt><dd className="num font-semibold">{m.sd === null ? '–' : `${fmt1(m.sd / 18.016)} mmol/L`}</dd>
                <dt>Time in tight range 3.9–7.8</dt><dd className="num font-semibold">{m.pct ? fmtPct(m.pct.tight) : '–'}</dd>
                <dt>High events (above 10.0, 15 min)</dt><dd className="num font-semibold">{r.events.highs}</dd>
                <dt>Very high events (above 13.9, 15 min)</dt><dd className="num font-semibold">{r.events.veryHighs}</dd>
                <dt>Lows lasting over 2 hours</dt><dd className="num font-semibold">{r.events.extendedLows}</dd>
                <dt>LibreView-style lows (longer than 15 min)</dt><dd className="num font-semibold">{r.events.libreViewLows}</dd>
                <dt>Finger-pricks (not in these numbers)</dt><dd className="num font-semibold">{r.fingerPricks}</dd>
              </dl>
              <p className="mt-2 text-xs text-slate-500">An event starts after 15 minutes beyond the limit and ends after 15 minutes back; no data for over 16 minutes ends it. Missing data is never filled in.</p>
            </details>
            <details className="rounded-2xl bg-white p-4 shadow-sm">
              <summary className="cursor-pointer font-bold">Daily profiles ({r.daily.length} days)</summary>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">{r.daily.slice(-14).map((d) => <DayProfile key={d.key} d={d} />)}</div>
              {r.daily.length > 14 && <p className="mt-1 text-xs text-slate-500">The last 14 days are shown here; the PDF has every day.</p>}
            </details>
            <Note />
          </div>
        )}
      </Page>
    </div>
  );
}

/** The Weekly Summary: a row per day (glucose with food, low treatments and insulin given marked at their times) and
 *  the day's average, carbs, insulin and low events; one Export PDF / Share button. */
export function WeeklySummaryPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const days = daysFrom(sp);
  const { summary: s, loading, error, now, shown, cut } = useWeeklySummary(days);
  const patient = usePatient();
  return (
    <div dir="ltr" lang="en">
      <Page ltr title="Weekly Summary" back={() => backTo(nav, `/reports?days=${days}`)}>
        {error && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm text-near">Could not load the report: {error}</p>}
        {loading && <p className="py-6 text-center text-slate-500">Loading {shown} days…</p>}
        {s && (
          <div className="space-y-3">
            <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold shadow-sm">{s.label}{cut && <span className="block text-xs font-normal text-slate-500">The Weekly Summary shows up to {WEEKLY_MAX_DAYS} days: the last {WEEKLY_MAX_DAYS} of the {days} chosen.</span>}</p>
            <SharePdf className="w-full" filename={`Weekly-summary-${s.label.replace(/[^0-9A-Za-z]+/g, '-')}.pdf`} title={`Weekly Summary ${s.label}`}
              make={() => weeklyPdf(s, patient, now, __APP_VERSION__)} labels={{ idle: 'Export PDF / Share', making: 'Preparing the PDF…', ready: 'PDF ready · tap to share' }} />
            <WeeklyLegend />
            {s.weeks.map((w) => (
              <section key={w.label} className="space-y-2">
                <h2 className="px-1 text-sm font-bold text-slate-500">{w.label}</h2>
                {w.days.map((d) => (
                  <div key={d.key} className="space-y-1.5 rounded-2xl bg-white p-3 shadow-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <b>{d.weekday} {d.date}</b>
                      {d.row.cgm.pctActive > 0 && d.row.cgm.pctActive < 70 && <span className="text-xs text-red-700">sensor data {Math.round(d.row.cgm.pctActive)}%</span>}
                    </div>
                    <WeekDayChart d={d} />
                    <div className="grid grid-cols-4 gap-1 text-center">
                      {[['Average', d.avgMmol === null ? '–' : fmt1(d.avgMmol), 'mmol/L'],
                        ['Carbs', d.row.meals ? String(Math.round(d.row.carbs)) : '–', d.row.mealsUnknownCarbs ? `g + ${d.row.mealsUnknownCarbs} unknown` : 'g'],
                        ['Insulin', d.row.total === null ? '–' : String(d.row.total), d.row.total === null ? 'none logged' : `U · R ${d.row.rapid} L ${d.row.long}`],
                        ['Lows', String(d.row.lows), d.row.treatments ? `${d.row.treatments} treated` : '']].map(([l, v, sub]) => (
                        <div key={l}><div className={cx('num text-lg font-bold', l === 'Lows' && d.row.lows > 0 && 'text-over')}>{v}</div><div className="text-[11px] font-semibold">{l}</div><div className="text-[10px] text-slate-500">{sub}</div></div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))}
            <p className="text-xs leading-relaxed text-slate-500">{WEEKLY_NOTE}</p>
            <Note />
          </div>
        )}
      </Page>
    </div>
  );
}
