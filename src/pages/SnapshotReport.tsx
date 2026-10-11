// The Snapshot: one page of key numbers for the period (glucose, low events and when they started, the daily
// pattern, insulin given, carbs), one Export PDF / Share button. Everything comes from the clinical report engine
// (engine/report/snapshot.ts), which reuses the AGP report and the shared day rows; nothing live is used or changed.
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backTo } from '../lib/nav';
import { fmt1, fmtPct } from '../engine/report/agpReport';
import { LOW_BLOCKS } from '../engine/report/snapshot';
import { usePatient, useSnapshot } from '../lib/useReport';
import { SNAPSHOT_NOTE, snapshotPdf } from '../lib/snapshotPdf';
import { AgpChart, RANGE_COLOR, TirBar } from '../components/reports/charts';
import { SharePdf } from '../components/SharePdf';
import { Expandable, useChartViewer } from '../components/reports/ChartViewer';
import { cx, Page } from '../components/ui';
import { DataCheck, Note, Section, daysFrom } from './DoctorReports';

const n1 = (x: number | null, unit = '') => (x === null ? '–' : `${fmt1(x)}${unit}`);
const Row = ({ k, v, bad }: { k: string; v: string; bad?: boolean }) => <div className="flex justify-between gap-2 text-sm"><span>{k}</span><b className={cx('num', bad && 'text-over')}>{v}</b></div>;

export function SnapshotPage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const days = daysFrom(sp);
  const { snap: s, loading, error } = useSnapshot(days);
  const patient = usePatient();
  const { open, viewer } = useChartViewer();
  const r = s?.report, m = r?.metrics;
  const max = s ? Math.max(1, ...s.lows.byBlock) : 1;
  return (
    <div dir="ltr" lang="en">
      <Page ltr title="Snapshot" back={() => backTo(nav, `/reports?days=${days}`)}>
        {error && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm text-near">Could not load the report: {error}</p>}
        {loading && <p className="py-6 text-center text-slate-500">Loading {days} days…</p>}
        {s && r && m && (
          <div className="space-y-3">
            <DataCheck r={r} />
            <SharePdf className="w-full" filename={`Snapshot-${r.label.replace(/[^0-9A-Za-z]+/g, '-')}.pdf`} title={`Snapshot ${r.label}`}
              make={() => snapshotPdf(s, patient, __APP_VERSION__)} labels={{ idle: 'Export PDF / Share', making: 'Preparing the PDF…', ready: 'PDF ready · tap to share' }} />
            <Section title="Glucose">
              <div className="flex items-baseline gap-2"><b className="num text-4xl" style={{ color: RANGE_COLOR.inRange }}>{fmtPct(r.ranges[2].pct)}</b><span className="text-slate-600">in target range 3.9–10.0</span></div>
              <TirBar r={r} height={16} />
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                {[['Average', m.mean === null ? '–' : fmt1(m.mean / 18.016), 'mmol/L'], ['GMI', m.gmi === null ? '–' : `${fmt1(m.gmi)}%`, m.gmi === null ? 'needs 14 days' : 'estimated A1c'], ['CV', m.cv === null ? '–' : `${fmt1(m.cv)}%`, r.cvStable ? 'stable (≤36%)' : 'above 36%']].map(([l, v, sub]) => (
                  <div key={l}><div className="num text-xl font-bold">{v}</div><div className="text-xs font-semibold">{l}</div><div className="text-[11px] text-slate-500">{sub}</div></div>
                ))}
              </div>
            </Section>
            <Section title="Low glucose events">
              <div className="flex items-baseline gap-2"><b className={cx('num text-4xl', s.lows.count > 0 && 'text-over')}>{s.lows.count}</b><span className="text-slate-600">below 3.9 · {fmt1(s.lows.perWeek)} a week</span></div>
              <p className="text-xs text-slate-500">Average {s.lows.avgMinutes === null ? '–' : `${Math.round(s.lows.avgMinutes)} min`} · {s.lows.veryLows} below 3.0 · {s.lows.treatments} treatments logged</p>
              <p className="pt-1 text-xs font-bold text-slate-500">When the lows started</p>
              <div className="grid grid-cols-6 items-end gap-1.5" style={{ height: 96 }}>
                {s.lows.byBlock.map((c, i) => (
                  <div key={i} className="flex h-full flex-col items-center justify-end gap-0.5">
                    <b className="num text-xs">{c}</b>
                    <div className="w-full rounded-t" style={{ height: `${Math.max(3, (c / max) * 62)}px`, background: c ? RANGE_COLOR.low : '#e2e8f0' }} />
                    <span className="text-center text-[9px] leading-tight text-slate-500">{LOW_BLOCKS[i].replace('–', '–​')}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500">Report definition: 15 minutes or more below 3.9; separate from the live alerts.</p>
            </Section>
            <Section title="Daily pattern (AGP)">
              <Expandable label="Daily pattern (AGP)" onOpen={() => open({ kind: 'agp', report: r })}><AgpChart r={r} still /></Expandable>
            </Section>
            <div className="grid gap-3 sm:grid-cols-2">
              <Section title="Insulin given">
                <div><b className="num text-3xl">{n1(s.insulin.total, ' U')}</b> <span className="text-slate-600">a day</span></div>
                <p className={cx('text-xs', s.insulin.daysWith < s.insulin.days ? 'text-red-700' : 'text-slate-500')}>over {s.insulin.daysWith} of {s.insulin.days} days with insulin logged</p>
                <Row k="Rapid a day" v={n1(s.insulin.rapid, ' U')} /><Row k="Long-acting a day" v={n1(s.insulin.long, ' U')} />
                <Row k="Long-acting share" v={s.insulin.basalPct === null ? '–' : fmtPct(s.insulin.basalPct)} /><Row k="Rapid doses a day" v={n1(s.insulin.rapidDosesPerDay)} />
              </Section>
              <Section title="Carbohydrates">
                <div><b className="num text-3xl">{s.carbs.perDay === null ? '–' : `${Math.round(s.carbs.perDay)} g`}</b> <span className="text-slate-600">a day</span></div>
                <p className={cx('text-xs', s.carbs.daysWith < s.carbs.days ? 'text-red-700' : 'text-slate-500')}>over {s.carbs.daysWith} of {s.carbs.days} days with meals logged</p>
                <Row k="Meals a day" v={n1(s.carbs.mealsPerDay)} /><Row k="Meals with carbs not known" v={String(s.carbs.unknownMeals)} bad={s.carbs.unknownMeals > 0} />
                <Row k="Low treatments (apart)" v={String(s.lows.treatments)} /><Row k="Finger-pricks" v={`${s.fingerPricks.total} (${fmt1(s.fingerPricks.perDay)} a day)`} />
              </Section>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">{SNAPSHOT_NOTE}</p>
            <Note />
          </div>
        )}
      </Page>
      {viewer}
    </div>
  );
}
