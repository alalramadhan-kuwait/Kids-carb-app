import { useData } from '../lib/data';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { describeEvent, unitsWord } from '../lib/events';
import { mealResponse, OFFSETS, type Group, type Mark } from '../engine/events';
import { nearest, type Series } from '../engine/series';
import { Sheet } from './ui';

const KW = 3 * 3600000;
const clock = (t: number) => { const d = new Date(t + KW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const TITLE: Record<Mark['kind'], string> = { meal: 'وجبة', carbs: 'كارب', insulin: 'إنسولين سريع', basal: 'إنسولين طويل', treatment: 'علاج انخفاض', exercise: 'رياضة', note: 'ملاحظة', sleep: 'نوم' };

/** What was logged at this point of the graph, and — for a meal — what glucose did afterwards. Facts only. */
export function EventSheet({ group, series, onClose }: { group: Group | null; series: Series; onClose: () => void }) {
  const { settings, events, nameOf } = useData();
  const unit = settings.glucose_unit;
  return (
    <Sheet open={!!group} onClose={onClose} title={group ? (group.marks.length > 1 ? `${group.marks.length} تسجيلات · ${clock(group.t)}` : TITLE[group.marks[0].kind]) : ''}>
      {group && (
        <div className="space-y-4">
          {group.marks.map((m) => <Item key={m.key} m={m} series={series} unit={unit} events={events} who={nameOf} />)}
          <p className="text-xs text-slate-400">ملاحظات مما سُجّل والقراءات المحفوظة، وليست توصية.</p>
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
        <Row label="الكارب" value={`${Math.round(m.meal.total_carbs)} g`} />
        <Row label="إنسولين الوجبة" value={r.bolus ? `${r.bolus.insulin_units} ${unitsWord(r.bolus.insulin_units ?? 0)}` : '—'} />
        {r.prebolus !== null && <Row label={r.prebolus >= 0 ? 'قبل الأكل بـ' : 'بعد الأكل بـ'} value={`${Math.abs(r.prebolus)} min`} />}
        <Row label="السكر عند الأكل" value={g(r.g0)} />
        <h3 className="mt-3 text-sm font-bold text-slate-600">استجابة السكر <span className="font-normal">({unitLabel(unit)})</span></h3>
        <div className="mt-1 grid grid-cols-5 gap-1 text-center">
          {OFFSETS.map((o) => (
            <div key={o} className="flex flex-col items-center rounded-lg bg-slate-50 py-1.5"><span className="num block text-[11px] text-slate-500" dir="ltr">+{o}</span><span className="num block font-bold">{g(r.at[o])}</span></div>
          ))}
        </div>
        <Row label="أعلى قراءة" value={r.peak !== null ? `${g(r.peak)}${r.ttp !== null ? ` · ${r.ttp} min` : ''}` : '—'} />
        <Row label="الارتفاع" value={r.rise !== null ? delta(r.rise) : '—'} />
        {!r.complete && <p className="mt-1 text-xs text-near">{m.t + 4 * 3600000 > Date.now() ? 'لم تمر 4 ساعات بعد.' : 'البيانات ناقصة في هذه الفترة، فالأرقام جزئية.'}</p>}
      </section>
    );
  }

  const e = m.event!;
  const g0 = at(m.t);
  return (
    <section>
      {head(TITLE[m.kind], who(e.created_by))}
      {m.kind !== 'note' && <Row label="التسجيل" value={<span dir="rtl">{describeEvent(e)}</span>} />}
      {e.note && <Row label="ملاحظة" value={<span dir="rtl" className="font-normal">{e.note}</span>} />}
      {m.kind === 'insulin' && e.bolus_purpose && <Row label="الغرض" value={<span dir="rtl">{{ meal: 'لوجبة', correction: 'تصحيح', both: 'الاثنين' }[e.bolus_purpose]}</span>} />}
      <Row label="السكر وقتها" value={g(g0)} />
      {m.kind === 'treatment' && [15, 30].map((o) => { const v = at(m.t + o * 60000); return <Row key={o} label={`بعد ${o} د`} value={v !== null && g0 !== null ? `${g(v)} (${delta(v - g0)})` : g(v)} />; })}
      {m.kind === 'exercise' && m.end && <Row label="في نهايتها" value={g(at(m.end))} />}
      {m.kind === 'sleep' && m.end && <Row label="عند الاستيقاظ" value={g(at(m.end))} />}
    </section>
  );
}
