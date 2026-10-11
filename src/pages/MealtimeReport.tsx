// Mealtime Patterns: glucose around breakfast, lunch, dinner and snacks for the period: a curve per meal period
// (median and middle half) and its numbers. One Export PDF / Share button. Everything comes from the clinical report
// engine (engine/report/mealtime.ts); nothing live is used or changed.
import { useNavigate, useSearchParams } from 'react-router-dom';
import { backTo } from '../lib/nav';
import { fmt1, periodLabel } from '../engine/report/agpReport';
import { MEALTIME_NOTE, SLOT_LABEL } from '../engine/report/mealtime';
import { useMealtime, usePatient } from '../lib/useReport';
import { mealtimePdf } from '../lib/mealtimePdf';
import { MealCurve } from '../components/reports/charts';
import { SharePdf } from '../components/SharePdf';
import { Page, cx } from '../components/ui';
import { Note, daysFrom } from './DoctorReports';

const n1 = (x: number | null, unit = '') => (x === null ? '–' : `${fmt1(x)}${unit}`);

export function MealtimePage() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const days = daysFrom(sp);
  const { mt, loading, error, now } = useMealtime(days);
  const patient = usePatient();
  return (
    <div dir="ltr" lang="en">
      <Page ltr title="Mealtime Patterns" back={() => backTo(nav, `/reports?days=${days}`)}>
        {error && <p className="rounded-xl bg-near-soft px-3 py-2 text-sm text-near">Could not load the report: {error}</p>}
        {loading && <p className="py-6 text-center text-slate-500">Loading {days} days…</p>}
        {mt && (
          <div className="space-y-3">
            <p className="rounded-xl bg-white px-3 py-2 text-sm font-semibold shadow-sm">{periodLabel(mt.from, mt.to)} · {mt.sittings.length} sittings{mt.treatmentsLeftOut ? <span className="font-normal text-slate-500"> · {mt.treatmentsLeftOut} low treatments left out</span> : null}</p>
            <SharePdf className="w-full" filename={`Mealtime-patterns-${periodLabel(mt.from, mt.to).replace(/[^0-9A-Za-z]+/g, '-')}.pdf`} title={`Mealtime Patterns ${periodLabel(mt.from, mt.to)}`}
              make={() => mealtimePdf(mt, patient, now, __APP_VERSION__)} labels={{ idle: 'Export PDF / Share', making: 'Preparing the PDF…', ready: 'PDF ready · tap to share' }} />
            {mt.slots.map((s) => (
              <section key={s.slot} className="space-y-2 rounded-2xl bg-white p-3 shadow-sm">
                <div className="flex items-baseline justify-between"><h2 className="font-bold">{SLOT_LABEL[s.slot]}</h2><span className="text-xs text-slate-500">{s.sittings} sitting{s.sittings === 1 ? '' : 's'}</span></div>
                <MealCurve c={s.curve} />
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  {([['Before', n1(s.pre), 'mmol/L'], ['Rise', n1(s.rise), s.peakMin === null ? 'to the peak' : `peak at ${Math.round(s.peakMin)} min`], ['2 h after', n1(s.at2h), 'mmol/L'],
                    ['Carbs', s.carbs === null ? '–' : `${Math.round(s.carbs)} g`, s.unknownCarbs ? `${s.unknownCarbs} not known` : 'median'], ['Insulin', s.insulin === null ? '–' : `${fmt1(s.insulin)} U`, `${s.withInsulin} of ${s.sittings} dosed`],
                    ['Lows after', `${s.lowsAfter}`, 'within 4 h']] as const).map(([l, v, sub]) => (
                    <div key={l} className="rounded-xl bg-slate-50 px-1 py-1.5"><div className={cx('num text-base font-bold', l === 'Lows after' && s.lowsAfter > 0 && 'text-over')}>{v}</div><div className="text-[11px] font-semibold">{l}</div><div className="text-[10px] text-slate-500">{sub}</div></div>
                  ))}
                </div>
              </section>
            ))}
            <p className="text-xs leading-relaxed text-slate-500">{MEALTIME_NOTE}</p>
            <Note />
          </div>
        )}
      </Page>
    </div>
  );
}
