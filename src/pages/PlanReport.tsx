// More → Reports → Meal plans for the care team: every finished plan in the period (calculated vs given dose, the
// ratios used, start, interval, outcome), the comparable patterns, repeated differences and the evidence worth a
// look together. It reports; it never proposes a dose or a setting.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { usePlanFacts } from '../lib/planFacts';
import { evidenceOf, groupsOf, patternOf, type PlanFacts } from '../engine/planCompare';
import { rulesOf } from '../engine/planReview';
import { EvidenceList, OutcomePill, PatternCard, gOf, whyText } from '../components/PlanCompare';
import { dur } from './PlanReview';
import { OvernightBasal } from '../components/Overnight';
import { fmt } from '../lib/carbs';
import { fmtTime, relDay } from '../lib/constants';
import { unitLabel } from '../lib/glucose';
import { Btn, Card, cx } from '../components/ui';
import { isEn, t } from '../i18n';

const DAY = 86400000;
const dateOf = (ms: number) => new Date(ms).toLocaleDateString(isEn() ? 'en-GB' : 'ar-KW-u-nu-latn', { day: 'numeric', month: 'short' });

export function PlanReport() {
  const nav = useNavigate();
  const { settings } = useData();
  const { facts, loaded } = usePlanFacts();
  const [days, setDays] = useState(30);
  const g = gOf(settings.glucose_unit);
  const rules = useMemo(() => rulesOf(settings.plan_review_rules as never), [settings.plan_review_rules]);
  const from = useMemo(() => Date.now() - days * DAY, [days]);
  const list = useMemo(() => facts.filter((p) => p.at >= from), [facts, from]);
  const groups = useMemo(() => groupsOf(list, rules), [list, rules]);
  const comparable = groups.flatMap((x) => x.comparable);
  const evidence = useMemo(() => {
    const target: [number, number] | null = settings.target_mgdl != null && settings.target_high_mgdl != null ? [settings.target_mgdl, settings.target_high_mgdl] : null;
    return evidenceOf(groups.flatMap((x) => x.comparable), rules, target);
  }, [groups, rules, settings.target_mgdl, settings.target_high_mgdl]);
  const differ = list.filter((p) => p.calc !== null && p.given !== null && p.given !== p.calc);
  const withDose = list.filter((p) => p.calc !== null && p.given !== null);
  const reasons = differ.map((p) => p.reason).filter((x): x is string => !!x);
  const corrections = list.filter((p) => p.endedBy === 'correction').length;

  return (
    <main className="mx-auto max-w-2xl space-y-3 px-4 pb-28 pt-3">
      <div className="flex items-center gap-2 print:hidden">
        <button aria-label={t('رجوع')} onClick={() => nav(-1)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm">{isEn() ? '←' : '→'}</button>
        <h1 className="flex-1 text-xl font-bold">{t('الوجبات المخططة لفريق الرعاية')}</h1>
      </div>
      <h1 className="hidden text-xl font-bold print:block">{t('الوجبات المخططة لفريق الرعاية')}</h1>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1 text-sm print:hidden">
        {[14, 30, 90].map((d) => <button key={d} onClick={() => setDays(d)} className={cx('min-h-[40px] rounded-full', days === d ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{t('{n} يومًا', { n: d })}</button>)}
      </div>
      <p className="text-xs text-slate-500">
        {t('من {a} إلى {b}', { a: dateOf(from), b: dateOf(Date.now()) })} · {unitLabel(settings.glucose_unit)} · {t('الإعدادات الحالية: مدة عمل الإنسولين {d} · الجرعة قبل الأكل بـ {m} د', { d: dur(settings.iob_dia_min ?? 360), m: settings.dose_to_meal_min ?? 0 })}
      </p>
      <OvernightBasal from={from} pattern={rules.pattern_min} />
      {!loaded ? <p className="text-slate-500">…</p> : list.length === 0 ? <Card><p className="text-sm text-slate-500">{t('لا توجد وجبات مخططة بمراجعة نهائية في هذه الفترة.')}</p></Card> : (
        <>
          <Card className="space-y-2">
            <h2 className="font-bold">{t('للمراجعة مع فريق الرعاية')}</h2>
            <EvidenceList list={evidence} facts={list} />
            <p className="text-[11px] text-slate-500">{t('من {n} وجبات قابلة للمقارنة، وتحتاج {k} على الأقل. أدلة للنقاش، وليست تغييرًا في الإعدادات.', { n: comparable.length, k: rules.pattern_min })}</p>
          </Card>

          <Card className="space-y-1.5 text-sm">
            <h2 className="font-bold">{t('الجرعة المحسوبة والمعطاة')}</h2>
            <p>{t('اختلفت الجرعة المعطاة عن المحسوبة في {n} من {of} وجبات.', { n: differ.length, of: withDose.length })}
              {differ.length > 0 && <> {t('أقل: {a} · أكثر: {b}', { a: differ.filter((p) => p.given! < p.calc!).length, b: differ.filter((p) => p.given! > p.calc!).length })}</>}</p>
            {reasons.length > 0 && <p className="text-xs text-slate-600">{t('الأسباب المكتوبة:')} {reasons.map((r, k) => <bdi key={k}>{k ? ' · ' : ''}{r}</bdi>)}</p>}
            <p>{t('جرعات تصحيح بعد الأكل: {n}', { n: corrections })}</p>
          </Card>

          <h2 className="px-1 pt-1 font-bold">{t('أنماط الوجبات القابلة للمقارنة')}</h2>
          {groups.map((gr) => <PatternCard key={gr.key} group={gr} pattern={patternOf(gr.comparable, rules)} need={rules.pattern_min} g={g} />)}

          <h2 className="px-1 pt-1 font-bold">{t('كل الوجبات ({n})', { n: list.length })}</h2>
          <Card className="!p-0 overflow-hidden">
            <ul className="divide-y divide-slate-100">{list.map((p) => <MealRow key={p.id} p={p} g={g} />)}</ul>
          </Card>
        </>
      )}
      <Btn block kind="ghost" className="print:hidden" onClick={() => window.print()}>{t('طباعة أو حفظ PDF')}</Btn>
      <p className="text-center text-[11px] text-slate-400">{t('ملاحظات من بياناتها، وليست توصية بجرعة.')}</p>
    </main>
  );
}

function MealRow({ p, g }: { p: PlanFacts; g: ReturnType<typeof gOf> }) {
  const nav = useNavigate();
  const kv = (k: string, v: string) => <span><span className="text-slate-500">{k}</span> <b className="num" dir="auto">{v}</b></span>;
  return (
    <li><button onClick={() => nav(`/plans/${p.id}`)} className="w-full space-y-1 px-4 py-2.5 text-start active:bg-slate-50">
      <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-bold"><bdi>{p.name}</bdi> <span className="font-normal text-slate-500">· {relDay(new Date(p.at))} {fmtTime(new Date(p.at))}</span></span><OutcomePill o={p.outcome} /></div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs sm:grid-cols-3">
        {kv(t('الكارب'), p.carbs === null ? '—' : t('{v} غ', { v: fmt(p.carbs) }))}
        {kv(t('البداية'), g(p.start))}
        {kv(t('المحسوبة ← المعطاة'), `${p.calc === null ? '—' : fmt(p.calc)} ${isEn() ? '→' : '←'} ${p.given === null ? '—' : t('{u} و', { u: fmt(p.given) })}`)}
        {kv(t('نسبة الكارب / الحساسية'), `${p.cr === null ? '—' : fmt(p.cr)} / ${p.isf === null ? '—' : g(p.isf)}`)}
        {kv(t('قبل الأكل'), p.interval === null ? '—' : dur(p.interval))}
        {kv(t('الذروة'), g(p.peak))}
        {kv(t('النهاية'), g(p.last))}
        {kv(t('انخفاض'), p.lowMin === null ? t('كلا') : g(p.lowMin))}
        {kv(t('فوق النطاق'), p.highMin === null ? t('كلا') : dur(p.highMin))}
      </div>
      {p.reason && <p className="text-xs text-slate-600">{t('السبب: {x}', { x: p.reason })}</p>}
      {!p.comparable && <p className="text-[11px] text-slate-500">{t('لا تصلح للمقارنة:')} {p.notComparable.map((w) => whyText(w, g)).join(' · ')}</p>}
      {p.note && <p className="rounded-lg bg-near-soft px-2 py-1 text-xs"><bdi>{p.note}</bdi></p>}
    </button></li>
  );
}
