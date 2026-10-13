// The visit report's "Doctor's numbers vs observed glucose": the same two levels as Analysis → Patterns (Clean, and
// Observed split by the numbers in force then), the same ledger of every prediction, and a few questions. Outcomes only:
// no new ratio, correction factor or dose is ever printed, and nothing says a number is right or wrong.
import { DC, GROUPS, stat, confidence, type DoctorCheck, type Flag, type LedgerRow } from '../../engine/doctorCheck';
import { CleanChart, DoctorNumbers, LedgerCard, ObservedChart, PeriodNotes, CONF_NAME, GROUP_NAME, REASON, direction, fmtDiff } from '../DoctorCheck';
import { formatGlucose, unitLabel, type GlucoseUnit } from '../../lib/glucose';
import { fmt } from '../../lib/carbs';
import { isEn, t } from '../../i18n';

const FACTORS: Flag[] = ['overlap', 'tresiba', 'fatty', 'sensor'];

export function DoctorCheckSection({ check, unit }: { check: DoctorCheck; unit: GlucoseUnit }) {
  const u = unitLabel(unit);
  const rows = check.ledger.filter((r) => r.t0 >= check.to - 30 * 86400000);
  const clean = (g: string, h: 'early' | 'late') => stat(rows.filter((r) => r.group === g && r.status === 'clean' && r[h]).map((r) => r[h]!.diff));
  const qs: string[] = [];
  for (const g of GROUPS) {
    const c = clean(g, 'early');
    if (c.n < DC.minN || Math.abs(c.median!) <= DC.near) continue;
    const name = t(GROUP_NAME[g]);
    qs.push(g === 'correction'
      ? t('{name}: {dir} بعد ساعتين ({k} من {n} نظيفة). هذا بروحه مو دليل إن رقم التصحيح غلط. شنو الأرجح: النشاط، إنسولين سابق، الحساس، أو الرقم نفسه؟', { name, dir: direction(c.median!, unit, true), k: c.median! < 0 ? c.lower : c.higher, n: c.n })
      : t('{name}: {dir} بعد ساعتين ({k} من {n} نظيفة). هل السبب الأرجح النسبة، حساب الكارب، أو وقت الجرعة؟', { name, dir: direction(c.median!, unit, false), k: c.median! > 0 ? c.higher : c.lower, n: c.n }));
  }
  // Observed, by the numbers in force then
  const observed: { g: string; isf: number; cr: number; list: LedgerRow[] }[] = [];
  for (const r of [...rows].filter((x) => x.status !== 'excluded' && x.early).sort((a, b) => a.t0 - b.t0)) {
    const o = observed.find((x) => x.g === r.group && x.isf === r.isf && (r.group === 'correction' || x.cr === r.cr));
    if (o) o.list.push(r); else observed.push({ g: r.group, isf: r.isf, cr: r.cr, list: [r] });
  }
  observed.sort((a, b) => GROUPS.indexOf(a.g as never) - GROUPS.indexOf(b.g as never));
  const cell = 'border-b border-slate-200 px-1.5 py-1 align-top';
  const med = (s: ReturnType<typeof stat>) => (s.n >= DC.minN ? <b dir="ltr">{fmtDiff(s.median!, unit)}</b> : <span className="text-slate-500">{t('قليلة')}</span>);
  return (
    <>
      <div className="space-y-3 pb-3">
      <h1 className="text-xl font-bold">{t('أرقام الطبيب والسكر الفعلي (آخر ٣٠ يوم)')}</h1>
      <p className="text-sm text-slate-600">{t('عند كل جرعة يحفظ التطبيق المنحنى اللي تتوقعه أرقام الطبيب المحفوظة، ويقارنه بالحساس. بعد ساعتين = نتيجة مبكرة (مو حكم على النسبة)؛ ٣–٥ ساعات تنعرض لحالها. «نظيفة» = ما في شي ثاني معروف يحرّك السكر؛ المتأثرة تنعد لحالها وما تدخل في الأرقام. الفرق = الفعلي ناقص المتوقع، بالوسيط، {u}.', { u })}</p>
      <DoctorNumbers print />
      <PeriodNotes check={check} unit={unit} />
      </div>
      <div className="grid grid-cols-2 items-start gap-3 pb-3">
        <CleanChart check={check} win={30} h="early" unit={unit} print />
        <ObservedChart check={check} win={30} unit={unit} print />
      </div>

      <div className="pb-3">
      <h2 className="font-bold">{t('نظيفة')}</h2>
      <table className="w-full border-collapse text-[12px]">
        <thead><tr className="bg-slate-50 text-start text-[11px] text-slate-600">
          <th className={cell}>{t('الوقت')}</th><th className={cell}>{t('بعد ساعتين (نظيفة)')}</th><th className={cell}>{t('قريب ±1.5')}</th><th className={cell}>{t('٣–٥ ساعات (نظيفة)')}</th><th className={cell}>{t('الثقة')}</th>
        </tr></thead>
        <tbody>{GROUPS.map((g) => { const e = clean(g, 'early'), l = clean(g, 'late'); return (
          <tr key={g}><td className={cell}><b>{t(GROUP_NAME[g])}</b></td><td className={cell}>{med(e)} <span className="text-slate-500">(n={e.n})</span></td>
            <td className={cell}>{e.n ? t('{k} من {n}', { k: e.near, n: e.n }) : '–'}</td><td className={cell}>{med(l)} <span className="text-slate-500">(n={l.n})</span></td><td className={cell}>{t(CONF_NAME[confidence(e)])}</td></tr>
        ); })}</tbody>
      </table>
      </div>

      <div className="pb-3">
      <h2 className="font-bold">{t('الملاحظ')} <span className="text-sm font-normal text-slate-500">· {t('وصف بس · فيه المتأثرة · ما ينحسب منه أي رقم')}</span></h2>
      <table className="w-full border-collapse text-[12px]">
        <thead><tr className="bg-slate-50 text-start text-[11px] text-slate-600">
          <th className={cell}>{t('الوقت')}</th><th className={cell}>{t('الأرقام وقتها')}</th><th className={cell}>{t('بعد ساعتين')}</th><th className={cell}>{t('منها')}</th>
        </tr></thead>
        <tbody>{observed.map((o) => { const s = stat(o.list.map((r) => r.early!.diff)); return (
          <tr key={o.g + o.isf + o.cr}><td className={cell}><b>{t(GROUP_NAME[o.g as never])}</b></td>
            <td className={cell} dir="ltr">ISF {formatGlucose(o.isf, unit)}{o.g === 'correction' ? '' : ` · 1:${fmt(o.cr)}`}</td>
            <td className={cell}>{med(s)} <span className="text-slate-500">(n={s.n})</span></td>
            <td className={cell}>{[`${REASON.clean.icon} ${o.list.filter((r) => r.status === 'clean').length}`, ...FACTORS.map((f) => [f, o.list.filter((r) => r.reasons.includes(f)).length] as const).filter(([, k]) => k).map(([f, k]) => `${REASON[f].icon} ${t(REASON[f].name)} ${k}`)].join(isEn() ? ', ' : '، ')}</td>{/* i18n-ok: list commas */}
          </tr>
        ); })}</tbody>
      </table>
      </div>

      <div className="pb-3"><LedgerCard rows={rows} print /></div>
      <div className="space-y-2">
        <h2 className="font-bold">{t('أسئلة لفريق الرعاية')}</h2>
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          <li>{t('أي أرقام هي الحالية: المحفوظة في التطبيق (فوق) أو اللي ذكرتها العائلة (1:15 وتصحيح 4.0 مليمول/ل)؟')}</li>
          {qs.map((q) => <li key={q}>{q}</li>)}
        </ol>
        {qs.length === 0 && <p className="mt-1 text-sm text-slate-600">{t('ما في وقت فيه ملاحظات نظيفة كافية (٥ أو أكثر) يختلف بوضوح عن المتوقع.')}</p>}
        <p className="text-xs text-slate-500">{t('من سجل العائلة والحساس، للنقاش فقط. التطبيق ما يقترح نسبة ولا جرعة. أقل من ٥ ملاحظات نظيفة = «قليلة».')} {t('«الملاحظ» وصف بس: ما يقول إن رقم معيّن صح أو غلط.')}</p>
      </div>
    </>
  );
}
