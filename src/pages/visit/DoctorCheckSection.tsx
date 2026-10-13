// The visit report's "Doctor's numbers vs observed glucose": the same findings as Analysis → Patterns, as a table and a
// few questions. Outcomes only: no new ratio, correction factor or dose is ever printed.
import { DC, FLAGS, type DoctorCheck } from '../../engine/doctorCheck';
import { DoctorNumbers, OutcomeChart, PeriodNotes, CONF_NAME, FLAG_NAME, GROUP_NAME, direction, fmtDiff } from '../DoctorCheck';
import { unitLabel, type GlucoseUnit } from '../../lib/glucose';
import { isEn, t } from '../../i18n';

export function DoctorCheckSection({ check, unit }: { check: DoctorCheck; unit: GlucoseUnit }) {
  const u = unitLabel(unit);
  const qs: string[] = [];
  for (const g of check.groups) {
    const c = g.win[30].early.clean;
    if (c.n < DC.minN || Math.abs(c.median!) <= DC.near) continue;
    const name = t(GROUP_NAME[g.group]);
    qs.push(g.group === 'correction'
      ? t('{name}: {dir} بعد ساعتين ({k} من {n} نظيفة). هذا بروحه مو دليل إن رقم التصحيح غلط. شنو الأرجح: النشاط، إنسولين سابق، الحساس، أو الرقم نفسه؟', { name, dir: direction(c.median!, unit, true), k: c.median! < 0 ? c.lower : c.higher, n: c.n })
      : t('{name}: {dir} بعد ساعتين ({k} من {n} نظيفة). هل السبب الأرجح النسبة، حساب الكارب، أو وقت الجرعة؟', { name, dir: direction(c.median!, unit, false), k: c.median! > 0 ? c.higher : c.lower, n: c.n }));
  }
  const cell = 'border-b border-slate-200 px-1.5 py-1 align-top';
  return (
    <section className="space-y-3">
      <h1 className="text-xl font-bold">{t('أرقام الطبيب والسكر الفعلي (آخر ٣٠ يوم)')}</h1>
      <p className="text-sm text-slate-600">{t('عند كل جرعة يحفظ التطبيق المنحنى اللي تتوقعه أرقام الطبيب المحفوظة، ويقارنه بالحساس. بعد ساعتين = نتيجة مبكرة (مو حكم على النسبة)؛ ٣–٥ ساعات تنعرض لحالها. «نظيفة» = ما في شي ثاني معروف يحرّك السكر؛ المتأثرة تنعد لحالها وما تدخل في الأرقام. الفرق = الفعلي ناقص المتوقع، بالوسيط، {u}.', { u })}</p>
      <OutcomeChart check={check} win={30} h="early" unit={unit} print />
      <DoctorNumbers print />
      <PeriodNotes check={check} unit={unit} />
      <table className="w-full border-collapse text-[12px]">
        <thead><tr className="bg-slate-50 text-start text-[11px] text-slate-600">
          <th className={cell}>{t('الوقت')}</th><th className={cell}>{t('بعد ساعتين (نظيفة)')}</th><th className={cell}>{t('قريب ±1.5')}</th>
          <th className={cell}>{t('١٤ / ٧ يوم')}</th><th className={cell}>{t('٣–٥ ساعات (نظيفة)')}</th><th className={cell}>{t('الثقة')}</th><th className={cell}>{t('متأثرة: الأسباب')}</th>
        </tr></thead>
        <tbody>
          {check.groups.map((g) => {
            const e = g.win[30].early, l = g.win[30].late, ok = (n: number) => n >= DC.minN;
            const w = (x: 7 | 14) => { const c = g.win[x].early.clean; return ok(c.n) ? fmtDiff(c.median!, unit) : t('قليلة'); };
            return (
              <tr key={g.group}>
                <td className={cell}><b>{t(GROUP_NAME[g.group])}</b></td>
                <td className={cell}>{ok(e.clean.n) ? <b dir="ltr">{fmtDiff(e.clean.median!, unit)}</b> : t('قليلة')} <span className="text-slate-500">(n={e.clean.n})</span></td>
                <td className={cell}>{e.clean.n ? t('{k} من {n}', { k: e.clean.near, n: e.clean.n }) : '–'}</td>
                <td className={cell} dir="ltr">{w(14)} / {w(7)}</td>
                <td className={cell}>{ok(l.clean.n) ? <b dir="ltr">{fmtDiff(l.clean.median!, unit)}</b> : t('قليلة')} <span className="text-slate-500">(n={l.clean.n})</span></td>
                <td className={cell}>{t(CONF_NAME[e.conf])}</td>
                <td className={cell}>{e.affected.n ? <>{e.affected.n}: {FLAGS.filter((f) => g.flags[f]).map((f) => `${t(FLAG_NAME[f])} (${g.flags[f]})`).join(isEn() ? ', ' : '، ')}</> : '–'}</td>{/* i18n-ok: list comma */}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div>
        <h2 className="font-bold">{t('أسئلة لفريق الرعاية')}</h2>
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          <li>{t('أي أرقام هي الحالية: المحفوظة في التطبيق (فوق) أو اللي ذكرتها العائلة (1:15 وتصحيح 4.0 مليمول/ل)؟')}</li>
          {qs.map((q) => <li key={q}>{q}</li>)}
        </ol>
        {qs.length === 0 && <p className="mt-1 text-sm text-slate-600">{t('ما في وقت فيه ملاحظات نظيفة كافية (٥ أو أكثر) يختلف بوضوح عن المتوقع.')}</p>}
      </div>
      <p className="text-xs text-slate-500">{t('من سجل العائلة والحساس، للنقاش فقط. التطبيق ما يقترح نسبة ولا جرعة. أقل من ٥ ملاحظات نظيفة = «قليلة».')}</p>
    </section>
  );
}
