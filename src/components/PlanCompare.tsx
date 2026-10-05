// Planned meals compared: the last similar times (plan sheet), a meal's pattern (Analysis → Meal response) and the
// care-team evidence (report). Words only for what the engine counted; never a proposed dose or setting.
import { Link } from 'react-router-dom';
import { fmt } from '../lib/carbs';
import { fmtTime, relDay } from '../lib/constants';
import { formatGlucose } from '../lib/glucose';
import type { Evidence, Group, Pattern, PlanFacts, SettingKey } from '../engine/planCompare';
import { OUTCOME, comparableText, dur } from '../pages/PlanReview';
import { Card, cx } from './ui';
import { t } from '../i18n';

export type G = (mg: number | null | undefined) => string;
export const gOf = (unit: 'mmol' | 'mgdl'): G => (mg) => (mg == null ? '—' : formatGlucose(mg, unit));

/** Why a past meal is not like this one, in words. */
export function whyText(code: string, g: G) {
  const [k, v] = code.split(':');
  if (k === 'carbs') return v === '?' ? t('الكارب غير معروف') : t('الكارب يختلف {n}%', { n: v });
  if (k === 'start') return t('السكر عند البدء يختلف {g}', { g: g(Number(v)) });
  if (k === 'direction') return t('اتجاه السكر عند الجرعة مختلف');
  if (k === 'iob') return t('الإنسولين النشط يختلف {u} و', { u: v });
  return comparableText(code);
}

export function OutcomePill({ o }: { o: PlanFacts['outcome'] }) {
  if (!o) return <span className="text-xs text-slate-400">—</span>;
  const x = OUTCOME[o];
  return <span className={cx('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold', x.tone)}>{x.icon} {x.label()}</span>;
}

const when = (ms: number) => `${relDay(new Date(ms))} ${fmtTime(new Date(ms))}`;
const units = (u: number | null) => (u === null ? '—' : t('{u} و', { u: fmt(u) }));

/** One past meal in a line or two: dose given · interval · start · peak · end · result, and its note. */
export function PastMeal({ p, g, why }: { p: PlanFacts; g: G; why?: string[] }) {
  return (
    <li className="space-y-1 py-2">
      <Link to={`/plans/${p.id}`} className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-xs text-slate-500">{when(p.at)}</span>
        <OutcomePill o={p.outcome} />
      </Link>
      <div className="grid grid-cols-3 gap-x-2 gap-y-0.5 text-xs">
        <span><span className="text-slate-500">{t('أُعطي')}</span> <b className="num">{units(p.given)}</b>{p.calc !== null && p.given !== p.calc && <span className="text-slate-500"> ({t('المحسوبة {u} و', { u: fmt(p.calc) })})</span>}</span>
        <span><span className="text-slate-500">{t('قبل الأكل')}</span> <b className="num">{p.interval === null ? '—' : dur(p.interval)}</b></span>
        <span><span className="text-slate-500">{t('البداية')}</span> <b className="num">{g(p.start)}</b></span>
        <span><span className="text-slate-500">{t('الذروة')}</span> <b className="num">{g(p.peak)}</b></span>
        <span><span className="text-slate-500">{t('النهاية')}</span> <b className="num">{g(p.last)}</b></span>
        <span><span className="text-slate-500">{t('الكارب')}</span> <b className="num">{p.carbs === null ? '—' : t('{v} غ', { v: fmt(p.carbs) })}</b></span>
      </div>
      {p.note && <p className="rounded-lg bg-near-soft px-2 py-1 text-xs"><bdi>{p.note}</bdi></p>}
      {why && why.length > 0 && <p className="text-[11px] text-slate-500">{t('ليست مشابهة:')} {why.map((w) => whyText(w, g)).join(' · ')}</p>}
    </li>
  );
}

/** "Last 3 similar" while planning: the same meal's last times, and how each differs. */
export function LastSimilar({ rows, g }: { rows: { p: PlanFacts; why: string[] }[]; g: G }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-sm font-bold">{t('آخر {n} مرات لهذه الوجبة', { n: rows.length })}</div>
      <ul className="divide-y divide-slate-200">{rows.map(({ p, why }) => <PastMeal key={p.id} p={p} g={g} why={why} />)}</ul>
    </div>
  );
}

const REPEAT: Record<string, string> = {
  went_high: 'ارتفع في {n} من {of}', // i18n-ok
  went_low: 'انخفض في {n} من {of}', // i18n-ok
  in_target: 'ضمن النطاق في {n} من {of}', // i18n-ok
  gave_less: 'أُعطي أقل من المحسوب في {n} من {of} (الوسيط {v} و)', // i18n-ok
  gave_more: 'أُعطي أكثر من المحسوب في {n} من {of} (الوسيط +{v} و)', // i18n-ok
  early_rise: 'ارتفاع مبكر في أول 30 د في {n} من {of}', // i18n-ok
  late_rise: 'ارتفاع متأخر بعد وجبة دسمة في {n} من {of}', // i18n-ok
  late_low: 'انخفاض بعد 3 ساعات أو أكثر في {n} من {of}', // i18n-ok
};
export const repeatText = (r: Pattern['repeats'][number]) => t(REPEAT[r.key], { n: r.n, of: r.of, v: r.v !== undefined ? fmt(Math.round(r.v * 10) / 10) : '' });

/** A meal's comparable pattern, or how far it is from one. */
export function PatternCard({ group, pattern, need, g, title }: { group: Group; pattern: Pattern | null; need: number; g: G; title?: string }) {
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold"><bdi>{title ?? group.name}</bdi></h2>
        <span className="text-xs text-slate-500">{t('{n} وجبات · {k} قابلة للمقارنة', { n: group.meals.length, k: group.comparable.length })}</span>
      </div>
      {!pattern ? <p className="text-sm text-slate-500">{t('النمط يحتاج {n} وجبات قابلة للمقارنة (الآن {k}).', { n: need, k: group.comparable.length })}</p> : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {(['in_target', 'high', 'low', 'unclear'] as const).filter((k) => pattern.outcomes[k]).map((k) => <span key={k} className={cx('rounded-full px-2 py-0.5 text-xs font-bold', OUTCOME[k].tone)}>{OUTCOME[k].icon} {OUTCOME[k].label()} · <span className="num">{pattern.outcomes[k]}</span></span>)}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label={t('الكارب')} v={pattern.carbs === null ? '—' : t('{v} غ', { v: fmt(Math.round(pattern.carbs)) })} />
            <Stat label={t('البداية')} v={g(pattern.start)} />
            <Stat label={t('أُعطي / المحسوبة')} v={`${pattern.given === null ? '—' : fmt(pattern.given)} / ${pattern.calc === null ? '—' : fmt(pattern.calc)}`} />
            <Stat label={t('قبل الأكل')} v={pattern.interval === null ? '—' : dur(pattern.interval)} />
            <Stat label={t('الذروة')} v={g(pattern.peak)} sub={pattern.ttp === null ? undefined : t('بعد {d}', { d: dur(pattern.ttp) })} />
            <Stat label={t('النهاية')} v={g(pattern.last)} />
          </div>
          {pattern.repeats.length > 0 && <ul className="list-disc space-y-0.5 ps-5 text-sm">{pattern.repeats.map((r) => <li key={r.key}>{repeatText(r)}</li>)}</ul>}
          <p className="text-[11px] text-slate-500">{t('الوسيط من {n} وجبات قابلة للمقارنة. ملاحظات من بياناتها، وليست توصية.', { n: pattern.n })}</p>
        </>
      )}
      {group.excluded.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-[36px] cursor-pointer text-slate-600">{t('غير مشمولة ({n}) ولماذا', { n: group.excluded.length })}</summary>
          <ul className="space-y-0.5 text-xs text-slate-600">{group.excluded.map(({ p, why }) => <li key={p.id}><Link to={`/plans/${p.id}`} className="underline">{when(p.at)}</Link>: {why.map((w) => whyText(w, g)).join(' · ')}</li>)}</ul>
        </details>
      )}
    </Card>
  );
}
const Stat = ({ label, v, sub }: { label: string; v: string; sub?: string }) => (
  <div><div className="num font-bold text-brand-num" dir="auto">{v}</div><div className="text-[11px] text-slate-500">{label}{sub && <> · {sub}</>}</div></div>
);

export const SETTING: Record<SettingKey, string> = {
  icr: 'نسبة الكارب (ICR)', isf: 'معامل الحساسية (ISF)', target: 'الهدف', dia: 'مدة عمل الإنسولين', timing: 'توقيت الجرعة قبل الأكل', // i18n-ok
};
export const FINDING: Record<string, string> = {
  high_after_calc: 'ارتفع بعد إعطاء الجرعة المحسوبة في {n} من {of} وجبات', // i18n-ok
  low_after_calc: 'انخفض بعد إعطاء الجرعة المحسوبة في {n} من {of} وجبات', // i18n-ok
  high_after_correction: 'مع جرعة تصحيح: لم ينزل أو ارتفع في {n} من {of} وجبات', // i18n-ok
  low_after_correction: 'مع جرعة تصحيح: انخفض في {n} من {of} وجبات', // i18n-ok
  end_above_target: 'ضمن النطاق لكن انتهى فوق الهدف في {n} من {of} وجبات', // i18n-ok
  end_below_target: 'ضمن النطاق لكن انتهى تحت الهدف في {n} من {of} وجبات', // i18n-ok
  late_low: 'انخفاض بعد 3 ساعات أو أكثر من الأكل في {n} من {of} وجبات', // i18n-ok
  early_rise: 'ارتفاع مبكر في أول 30 د من الأكل في {n} من {of} وجبات', // i18n-ok
};

/** Evidence for the care team: the setting, what repeated, and the meals. Never what to change. */
export function EvidenceList({ list, facts }: { list: Evidence[]; facts: PlanFacts[] }) {
  if (!list.length) return <p className="text-sm text-slate-500">{t('لا يوجد شيء متكرر يستحق المراجعة في هذه الفترة.')}</p>;
  const byId = new Map(facts.map((p) => [p.id, p]));
  return (
    <ul className="space-y-2">
      {list.map((e, k) => (
        <li key={k} className="rounded-xl border border-near/30 bg-near-soft/40 p-3">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-near-soft px-2 py-0.5 text-xs font-bold text-near">{t('مراجعة مع فريق الرعاية')}</span><b className="text-sm">{t(SETTING[e.setting])}</b></div>
          <p className="mt-1 text-sm">{t(FINDING[e.finding], { n: e.n, of: e.of })}</p>
          <p className="mt-0.5 text-xs text-slate-500">{e.ids.map((id) => byId.get(id)).filter(Boolean).map((p, k) => <span key={p!.id}>{k ? ' — ' : ''}{when(p!.at)} · <bdi>{p!.name}</bdi></span>)}</p>
        </li>
      ))}
    </ul>
  );
}
