// Beside a dose logged later: her glucose at that time, what the doctor's settings gave then, and the difference from
// the units entered. Facts only: the decision was the parents'.
import { useData } from '../lib/data';
import { formatGlucose } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { blockTexts } from './DoseCalculator';
import { cx } from './ui';
import { t } from '../i18n';
import type { DoseAt } from '../engine/doseAt';

const clock = (ms: number) => fmtTime(new Date(ms));
export function DoseThenLine({ then, at, units }: { then: DoseAt; at: number; units: number | null }) {
  const { settings } = useData();
  const when = at;
  return (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-[13px] leading-snug">
      {then.glucose === null ? <span className="text-slate-500">{t('ما في قراءة للحساس الساعة {c}', { c: clock(when) })}</span>
        : <span>{t('السكر الساعة {c}', { c: clock(when) })}: <b className="num">{formatGlucose(then.glucose, settings.glucose_unit)}</b></span>}
      {then.r.block ? <span className="block text-slate-500">{t('ما في حسبة وقتها')}: {blockTexts(settings.dose_gap_min ?? 120, then.r.until ?? undefined)[then.r.block]}</span>
        : <span className="block">{t('إعدادات الطبيب وقتها')}: <b className="num text-kins">{t('{u} و', { u: fmt(then.r.dose) })}</b>
          {units !== null && <b className={cx('ms-1', units === then.r.dose ? 'text-ok' : 'text-near')}> · {units === then.r.dose ? `✓ ${t('نفس اللي عطيتوها')}` : units < then.r.dose ? t('عطيتوها أقل بـ {n} و', { n: fmt(Math.round((then.r.dose - units) * 10) / 10) }) : t('عطيتوها أكثر بـ {n} و', { n: fmt(Math.round((units - then.r.dose) * 10) / 10) })}</b>}</span>}
    </div>
  );
}
