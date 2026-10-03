import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { carbLane, carbsFrom, dosesFrom, insulinLane, iobParamsOk, type OnBoardLane } from '../engine/iob';
import { fmtTime } from '../lib/constants';
import { fmt } from '../lib/carbs';
import { Icon } from './Icon';
import { cx } from './ui';
import { isEn, t } from '../i18n';
import type { IconName } from '../icons/defs';

const MIN = 60000;
export const dur = (ms: number) => {
  const all = Math.max(1, Math.round(ms / MIN)), h = Math.floor(all / 60), m = all % 60;
  return h > 0 && m > 0 ? t('{h} س {m} د', { h, m }) : h > 0 ? t('{h} س', { h }) : t('{m} د', { m });
};

/**
 * Insulin and carbs still on board, under the graph. First what matters: how much is still active and how long ago the
 * last dose (or food) was, so nobody has to work it out from clock times; then, smaller, until about when the care
 * team's duration (or absorption time) runs. Display only: nothing here is an amount to give.
 */
export function OnBoardLanes({ statusLink = true }: { statusLink?: boolean }) {
  const { settings: s, history, events } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const doses = useMemo(() => dosesFrom(events), [events]);
  const carbs = useMemo(() => carbsFrom(history, events), [history, events]);
  const p = s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null;
  const ins = iobParamsOk(p) ? insulinLane(doses, now, p) : null;
  const cob = s.cob_absorb_min ? carbLane(carbs, now, s.cob_absorb_min) : null;

  return (
    <section aria-label={t('ما زال يعمل')} className="space-y-2">
      {(ins || cob) && (
        <div className="space-y-3 rounded-2xl border border-slate-100 bg-white px-3 py-2.5">
          {ins && <Lane lane={ins} now={now} icon="insulin" tone="ins" num={ins.left.toFixed(2)} unit={t('وحدة')}
            line={t('آخر جرعة قبل {d}', { d: dur(now - ins.last) })} />}
          {cob && <Lane lane={cob} now={now} icon="meals" tone="carb" num={fmt(Math.round(cob.left * 10) / 10)} unit={t('غ')}
            line={t('آخر أكل قبل {d}', { d: dur(now - cob.last) })} />}
        </div>
      )}
      {statusLink && <Link to="/status" className="flex min-h-[40px] items-center justify-end px-1 text-sm font-bold text-brand">{t('الحالة')} {isEn() ? '›' : '‹'}</Link>}
    </section>
  );
}

function Lane({ lane, now, icon, tone, num, unit, line }: { lane: OnBoardLane; now: number; icon: IconName; tone: 'ins' | 'carb'; num: string; unit: string; line: string }) {
  const frac = Math.min(1, Math.max(0, (now - lane.first) / (lane.end - lane.first)));
  const c = tone === 'ins' ? { text: 'text-kins', bar: 'bg-kins', soft: 'bg-kins-soft' } : { text: 'text-kcarb', bar: 'bg-kcarb', soft: 'bg-kcarb-soft' };
  return (
    <div className="flex items-start gap-2.5">
      <span className={cx('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', c.soft, c.text)}><Icon name={icon} size={16} /></span>
      <div className="min-w-0 flex-1">
        {/* primary: active now · how long ago the last one was */}
        <p className="text-sm">
          <b className={cx('tabular-nums', c.text)}><bdi dir="ltr">{num}</bdi> {unit} {t('نشط')}</b>
          <span className="text-slate-600"> · {line}</span>
        </p>
        {/* secondary: the timeline from the first dose (or bite) to its end, and until about when; time runs left to right */}
        <div className="mt-1.5 flex items-center gap-2">
          <div dir="ltr" className={cx('relative h-1.5 min-w-0 flex-1 rounded-full', c.soft)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={line}>
            <div className={cx('h-full rounded-full', c.bar)} style={{ width: `${frac * 100}%` }} />
            <span className={cx('absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white shadow', c.bar)} style={{ left: `calc(${frac * 100}% - 6px)` }} />
          </div>
          <span className="shrink-0 text-[11px] text-slate-500 tabular-nums">{t('حتى ~{time}', { time: fmtTime(new Date(lane.end)) })}</span>
        </div>
      </div>
    </div>
  );
}
