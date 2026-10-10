import { useData } from '../lib/data';
import { kwClock } from '../lib/constants';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { describeEvent, unitsWord } from '../lib/events';
import { mealResponse, OFFSETS, type Group, type Mark } from '../engine/events';
import { nearest, type Series } from '../engine/series';
import { Sheet } from './ui';
import { dir, t, tr } from '../i18n';

const KW = 3 * 3600000;
const clock = kwClock;
const TITLE: Record<Mark['kind'], string> = tr({ meal: 'وجبة', carbs: 'كارب', insulin: 'إنسولين سريع', basal: 'إنسولين طويل', treatment: 'علاج انخفاض', exercise: 'رياضة', note: 'ملاحظة', sleep: 'نوم' }); // i18n-ok

/** What was logged at this point of the graph, and — for a meal — what glucose did afterwards. Facts only. */
export function EventSheet({ group, series, onClose }: { group: Group | null; series: Series; onClose: () => void }) {
  const { settings, events, nameOf } = useData();
  const unit = settings.glucose_unit;
  return (
    <Sheet open={!!group} onClose={onClose} title={group ? (group.marks.length > 1 ? t('{n} تسجيلات · {t}', { n: group.marks.length, t: clock(group.t) }) : TITLE[group.marks[0].kind]) : ''}>
      {group && (
        <div className="space-y-4">
          {group.marks.map((m) => <Item key={m.key} m={m} series={series} unit={unit} events={events} who={nameOf} />)}
          <p className="text-xs text-slate-400">{t('ملاحظات مما سُجّل والقراءات المحفوظة، وليست توصية.')}</p>
        </div>
      )}
    </Sheet>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0"><span className="text-slate-600">{label}</span><b className="num" dir="ltr">{value}</b></div>;
}

function Item({ m, series, unit, events, who }: { m: Mark; series: Series; unit: GlucoseUnit; events: ReturnType<typeof useData>['events']; who: (id: string | null) => string }) {
  const g = (mg: number | null) => (mg === null ? '—' : formatGlucose(mg, unit));
  const at = (t: number) => { const i = nearest(series, t, 10 * 60000); return i === null ? null : series.v[i]; };
  const delta = (mg: number) => `${mg > 0 ? '+' : mg < 0 ? '−' : ''}${formatGlucose(Math.abs(mg), unit)}`;
  const head = (title: string, sub?: string) => (
    <div className="mb-1 flex items-baseline gap-2"><b className="text-lg">{title}</b><span className="num text-sm text-slate-500">{clock(m.t)}</span>{sub && <span className="ms-auto text-sm text-slate-500">{sub}</span>}</div>
  );

  if (m.kind === 'meal' && m.meal) {
    const r = mealResponse(series, m.t, events);
    return (
      <section>
        {head(m.meal.name)}
        <Row label={t('الكارب')} value={m.meal.total_carbs === null ? t('غير معروف') : t('{g} غ', { g: Math.round(m.meal.total_carbs) })} />
        <Row label={t('إنسولين الوجبة')} value={r.bolus ? `${r.bolus.insulin_units} ${unitsWord(r.bolus.insulin_units ?? 0)}` : '—'} />
        {r.prebolus !== null && <Row label={r.prebolus >= 0 ? t('قبل الأكل بـ') : t('بعد الأكل بـ')} value={t('{m} د', { m: Math.abs(r.prebolus) })} />}
        <Row label={t('السكر عند الأكل')} value={g(r.g0)} />
        <h3 className="mt-3 text-sm font-bold text-slate-600">{t('استجابة السكر')} <span className="font-normal">({unitLabel(unit)})</span></h3>
        <div className="mt-1 grid grid-cols-5 gap-1 text-center">
          {OFFSETS.map((o) => (
            <div key={o} className="flex flex-col items-center rounded-lg bg-slate-50 py-1.5"><span className="num block text-[11px] text-slate-500" dir="ltr">+{o}</span><span className="num block font-bold">{g(r.at[o])}</span></div>
          ))}
        </div>
        <Row label={t('أعلى قراءة')} value={r.peak !== null ? g(r.peak) + (r.ttp !== null ? ' · ' + t('بعد {m} د', { m: r.ttp }) : '') : '—'} />
        <Row label={t('الارتفاع')} value={r.rise !== null ? delta(r.rise) : '—'} />
        {!r.complete && <p className="mt-1 text-xs text-slate-500">{m.t + 4 * 3600000 > Date.now() ? t('لم تمر 4 ساعات بعد.') : t('البيانات ناقصة في هذه الفترة، فالأرقام جزئية.')}</p>}
      </section>
    );
  }

  const e = m.event!;
  const g0 = at(m.t);
  return (
    <section>
      {head(TITLE[m.kind], who(e.created_by))}
      {m.kind !== 'note' && <Row label={t('التسجيل')} value={<span dir={dir()}>{describeEvent(e)}</span>} />}
      {e.note && <Row label={t('ملاحظة')} value={<span dir="auto" className="font-normal">{e.note}</span>} />}
      {m.kind === 'insulin' && e.bolus_purpose && <Row label={t('الغرض')} value={<span dir={dir()}>{{ meal: t('لوجبة'), correction: t('تصحيح'), both: t('الاثنين') }[e.bolus_purpose]}</span>} />}
      <Row label={t('السكر وقتها')} value={g(g0)} />
      {m.kind === 'treatment' && [15, 30].map((o) => { const v = at(m.t + o * 60000); return <Row key={o} label={t('بعد {m} د', { m: o })} value={v !== null && g0 !== null ? `${g(v)} (${delta(v - g0)})` : g(v)} />; })}
      {m.kind === 'exercise' && m.end && <Row label={t('في نهايتها')} value={g(at(m.end))} />}
      {m.kind === 'sleep' && m.end && <Row label={t('عند الاستيقاظ')} value={g(at(m.end))} />}
    </section>
  );
}
