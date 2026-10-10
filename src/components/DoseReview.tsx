// The dose of a meal, for review: what the calculator showed when it was given, what the same calculation gives for
// the meal as corrected, and what was actually given. Retrospective only: it suggests nothing and changes nothing.
// The calculation uses the inputs saved with that dose (never today's settings); a meal without them shows nothing.
import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { findDoseLink, recalcsOf, reviewDose, type DoseLink, type Recalc } from '../lib/recalc';
import { fmt } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { dayTitle, dayStartOf } from '../engine/day';
import type { HistoryEntry } from '../lib/types';
import { cx } from './ui';
import { t } from '../i18n';

function useReview(h: HistoryEntry) {
  const [s, setS] = useState<{ link: DoseLink; given: number | null; rows: Recalc[] } | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void Promise.all([findDoseLink(h), recalcsOf(h.id)]).then(([f, rows]) => { if (live) setS(f ? { ...f, rows } : null); }).catch(() => live && setS(null));
    return () => { live = false; };
  }, [h.id, h.total_carbs]); // eslint-disable-line react-hooks/exhaustive-deps
  return s;
}

const Line = ({ k, v, sub, strong }: { k: string; v: string; sub?: string; strong?: boolean }) => (
  <div className="flex items-baseline justify-between gap-3 py-1">
    <span className="min-w-0">{k}{sub && <span className="block text-[13px] text-slate-500">{sub}</span>}</span>
    <b className={cx('num shrink-0', strong && 'text-lg')}>{v}</b>
  </div>
);

export function DoseReview({ h, simple }: { h: HistoryEntry; simple?: boolean }) {
  const { nameOf } = useData();
  const r = useReview(h);
  const [open, setOpen] = useState(false);
  // a meal whose carbs are not known has nothing to recalculate
  if (!r || h.total_carbs === null) return null;
  const carbs = h.total_carbs;
  const s = r.link.snapshot;
  const atDose = s.suggested ?? reviewDose(s, s.carbs);
  const changed = Math.abs((s.carbs ?? carbs) - carbs) >= 0.05;
  const now = reviewDose(s, carbs);
  const u = (x: number) => t('{u} وحدة', { u: fmt(x) });
  const body = (
    <div className="divide-y divide-slate-100">
      <Line k={t('انحسبت وقت الإبرة')} sub={t('لـ {g} غ كارب', { g: fmt(s.carbs) })} v={u(atDose)} />
      {changed && <Line k={t('بالأكل بعد التصحيح')} sub={t('لـ {g} غ كارب · بنفس إعدادات ذاك الوقت', { g: fmt(h.total_carbs) })} v={u(now)} />}
      <Line k={t('انعطت فعلًا')} v={r.given === null ? '—' : u(r.given)} strong />
    </div>
  );
  const note = <p className="text-[13px] text-slate-500">{t('للمراجعة فقط: ما تعني إبرة زيادة ولا تغيّر الإبرة المسجّلة.')}</p>;
  if (simple) return (
    <div className="rounded-3xl bg-white px-4 py-2">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-h-[52px] w-full items-center justify-between text-[17px] font-bold">
        <span>💉 {t('الإبرة')}</span><span className="text-slate-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="space-y-2 pb-2 text-[16px]">{body}{note}</div>}
    </div>
  );
  return (
    <section className="space-y-2 rounded-2xl border border-slate-100 bg-white p-3 text-sm">
      <h3 className="font-bold">{t('الجرعة لهذي الوجبة')}</h3>
      {body}
      {r.rows.length > 0 && (
        <details className="text-[13px]">
          <summary className="min-h-[36px] cursor-pointer py-2 font-medium text-brand">{t('سجل الحسبات ({n})', { n: r.rows.length })}</summary>
          <ul className="space-y-1">
            {r.rows.map((x) => (
              <li key={x.id} className="text-slate-600">
                {dayTitle(dayStartOf(Date.parse(x.at)))} {fmtTime(new Date(x.at))}{x.by ? <> · <bdi>{nameOf(x.by)}</bdi></> : null}: {' '}
                <span className="num">{fmt(x.carbs_before)} ← {fmt(x.carbs_after)}</span> {t('غ كارب')} · <span className="num">{u(x.dose_after)}</span>
                {x.given_units != null && <> · {t('انعطت {u}', { u: fmt(x.given_units) })}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {note}
    </section>
  );
}
