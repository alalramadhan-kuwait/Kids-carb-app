// The visit report's night summary: the same nights, rates and finger-pricks as Analysis → Night, then three separate
// blocks: what the log and the sensor show, what could explain it (none proven), and questions for the care team.
// It never says the Tresiba dose is too much or too little and never suggests a dose.
import { NT, changesOf, clockOf, type NightReport } from '../../engine/nightTresiba';
import { BASAL_DEFAULTS } from '../../engine/basal';
import { DailyInsulin, NightsChart, PerDose, Pricks, RatesChart, dayLabel, hourLabel } from '../NightTresiba';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../../lib/glucose';
import { fmtTime } from '../../lib/constants';
import { fmt } from '../../lib/carbs';
import { isEn, t } from '../../i18n';


export function NightSection({ report, unit }: { report: NightReport; unit: GlucoseUnit }) {
  const g = (mg: number) => formatGlucose(mg, unit), u = unitLabel(unit);
  const ns = report.nights, list = (xs: string[]) => xs.join(isEn() ? ', ' : '، '); // i18n-ok: list commas
  const count = (c: string) => ns.filter((n) => n.cls === c).length;
  const changes = changesOf(report.doses);
  const doses = report.doses, first = doses[0], last = doses[doses.length - 1];
  const moved = first && last && Math.abs(clockOf(last.t) - clockOf(first.t)) >= 90;
  // the lowest sensor reading of all the nights, with the finger-prick nearest to it
  const low = ns.filter((n) => n.min !== null).sort((a, b) => a.min! - b.min!)[0];
  const pricks = ns.flatMap((n) => n.pricks);
  const lowPrick = low?.lowAt ? [...low.pricks].sort((a, b) => Math.abs(a.t - low.lowAt!) - Math.abs(b.t - low.lowAt!))[0] : undefined;
  const lower = pricks.filter((p) => p.agrees === false && p.diff! < 0).length, higher = pricks.filter((p) => p.agrees === false && p.diff! > 0).length, same = pricks.filter((p) => p.agrees).length;
  const juices = ns.flatMap((n) => n.treatments), falling = juices.filter((x) => x.interrupted).length;
  const clean = count('clean');

  const seen: string[] = [];
  if (changes.length) seen.push(t('تريسيبا: {list}.', { list: list(changes.map((c) => t('{u} وحدة من {d}', { u: fmt(c.units), d: dayLabel(c.t) }))) })
    + (first && last ? ' ' + (moved ? t('وقت الإبرة تغيّر من حوالي {a} إلى حوالي {b}.', { a: hourLabel(clockOf(first.t)), b: hourLabel(clockOf(last.t)) }) : t('وقت الإبرة حوالي {a}.', { a: hourLabel(clockOf(last.t)) })) : ''));
  seen.push(t('{n} ليلة: نظيفة {a}، نوفورابيد أو أكل قريب {b}، عصير قبل ٦ الصبح {c}، قراءات حساس مشكوك فيها {d}.', { n: ns.length, a: clean, b: count('insulin_food'), c: count('juice'), d: count('sensor') }));
  if (low) seen.push(t('أدنى قراءة حساس بالليل {v} {u} ({d} {time}){q}.', { v: g(low.min!), u, d: dayLabel(low.lowAt ?? low.start), time: low.lowAt ? fmtTime(new Date(low.lowAt)) : '', q: low.minQuestioned ? t('؛ القراءة مشكوك فيها، مو محذوفة') : '' })
    + (lowPrick ? ' ' + t('أقرب وخز لها نفس الليلة: {v} الساعة {time}.', { v: g(lowPrick.bg), time: fmtTime(new Date(lowPrick.t)) }) : ' ' + t('ما في وخز نفس الليلة.')));
  if (pricks.length) seen.push(t('{n} وخز بالليل: متقارب مع الحساس {a}، الحساس أقل {b}، الحساس أعلى {c}.', { n: pricks.length, a: same, b: lower, c: higher }));
  if (juices.length) seen.push(t('{n} عصير بالليل؛ {k} منها والسكر نازل {v} {u} أو أكثر في الـ {m} دقيقة قبلها.', { n: juices.length, k: falling, v: g(NT.juiceFall), u, m: NT.juiceLookMin }));
  for (const x of report.dayGroups) seen.push(t('على {d} وحدة: إنسولين اليوم {total} وحدة (تريسيبا {p}٪)، كارب {c} غ، عصير {j} باليوم ({n} أيام).', { d: fmt(x.units), total: fmt(x.total), p: Math.round((x.long / x.total) * 100), c: Math.round(x.carbs), j: fmt(x.juices), n: x.days }));

  const maybe: string[] = [
    t('أثر التريسيبا نفسه خلال صيام الليل.'),
    t('أثر النوفورابيد أو أكل العشاء (الدهون والبروتين) بعد أكثر من {h} ساعات: هذي المدة شرط للفرز، مو دليل إن الأثر راح.', { h: BASAL_DEFAULTS.rapid_gap_min / 60 }),
    t('نشاط اليوم، والفرق بين يوم ويوم في الأكل والنوم.'),
  ];
  if (lower) maybe.push(t('الحساس قرأ أقل من الوخز في {k} من {n} وخزات ليلية (منها احتمال الضغط على الحساس). هذا ما يعني إن أي انخفاض بعينه غلط.', { k: lower, n: pricks.length }));
  maybe.push(t('قلة الليالي النظيفة ({n}) وفترة الاستقرار ٣–٤ أيام بعد كل تغيير تخلي المقارنة بين الجرعات غير أكيدة.', { n: clean }));

  const ask: string[] = [t('هل النزول في فترات الصيام بالليل يتوافق مع المتوقع من التريسيبا، أو يحتاج تقييم أكثر؟')];
  if (falling * 2 > juices.length) ask.push(t('العصير بالليل جا أغلبه والسكر نازل، فما نعرف وين كان النزول بيوقف. شنو الخطة المناسبة للليالي الجاية؟'));
  if (lower) ask.push(t('كيف نتعامل مع الفرق بين الحساس والوخز بالليل؟ ومتى يلزم وخز قبل العلاج؟'));
  ask.push(t('هل يفيد وخز إضافي في الليالي النظيفة بعد ما تستقر الجرعة (مثلًا ١٢ و٣ الفجر) عشان تكون المقارنة أوضح؟'));
  if (moved) ask.push(t('هل لتغيير وقت إبرة التريسيبا أثر على الليل؟'));
  ask.push(t('هل لوقت العشاء ونوعه وجرعته دور في النزول بعد منتصف الليل؟'));

  const block = (title: string, items: string[], tone: string) => (
    <div className={`rounded-xl border px-3 py-2 ${tone}`}>
      <h3 className="font-bold">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 ps-5 text-[13px]">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
  return (
    <>
      <div className="space-y-2 pb-3">
        <h1 className="text-xl font-bold">{t('الليل وجرعة التريسيبا (آخر ٣٠ يوم)')}</h1>
        <p className="text-sm text-slate-600">{t('من سجل العائلة والحساس. الليل ٩ م – ٧ ص؛ سرعة النزول من ١٢ لين ٦ الفجر في الفترات اللي ما فيها نوفورابيد لـ {h} ساعات ولا أكل أو عصير لـ {f} ساعات. أول ٣ ليالي بعد تغيير الجرعة تنعرض لحالها.', { h: BASAL_DEFAULTS.rapid_gap_min / 60, f: BASAL_DEFAULTS.food_gap_min / 60 })}</p>
      </div>
      <div className="grid grid-cols-2 items-start gap-3 pb-3">
        <NightsChart report={report} unit={unit} print />
        <RatesChart report={report} unit={unit} print />
      </div>
      {/* each block is its own piece, so the PDF flows them onto the page under the charts */}
      <div className="pb-3">{block(t('١. اللي يبيّنه السجل والحساس'), seen, 'border-slate-200')}</div>
      <div className="pb-3">{block(t('٢. تفسيرات محتملة (ما انثبت شي منها)'), maybe, 'border-slate-200 bg-slate-50')}</div>
      <div className="pb-3">{block(t('٣. أسئلة لفريق الرعاية'), ask, 'border-slate-300')}
        <p className="mt-2 text-xs text-slate-500">{t('النزول بالليل بروحه مو دليل إن جرعة التريسيبا زايدة. التطبيق ما يقترح جرعة، وما يصحح قراءات الحساس، وما يخمّن وين كان السكر بيوصل بدون العصير.')}</p>
      </div>
      <div className="grid grid-cols-2 items-start gap-3 pb-3">
        <PerDose report={report} unit={unit} />
        <DailyInsulin report={report} />
      </div>
      <div className="pb-3"><Pricks report={report} unit={unit} print /></div>
    </>
  );
}
