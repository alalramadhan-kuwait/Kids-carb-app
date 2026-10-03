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
 * Insulin and carbs still on board, as two thin timelines under the graph: when the first dose (or bite) was, when the
 * last of it is done (the care team's duration or absorption time), and how much is left of how much. Numbers, not
 * sentences. Display only: nothing here is an amount to give.
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
          {ins && <Lane lane={ins} now={now} icon="insulin" tone="ins" title={t('إنسولين نشط')} amount={`${ins.left.toFixed(2)} / ${fmt(ins.total)}`} unit={t('وحدة')} />}
          {cob && <Lane lane={cob} now={now} icon="meals" tone="carb" title={t('كارب يُمتص')} amount={`${fmt(Math.round(cob.left * 10) / 10)} / ${fmt(cob.total)}`} unit={t('غ')} />}
        </div>
      )}
      {statusLink && <Link to="/status" className="flex min-h-[40px] items-center justify-end px-1 text-sm font-bold text-brand">{t('الحالة')} {isEn() ? '›' : '‹'}</Link>}
    </section>
  );
}

function Lane({ lane, now, icon, tone, title, amount, unit }: { lane: OnBoardLane; now: number; icon: IconName; tone: 'ins' | 'carb'; title: string; amount: string; unit: string }) {
  const frac = Math.min(1, Math.max(0, (now - lane.first) / (lane.end - lane.first)));
  const c = tone === 'ins' ? { text: 'text-kins', bar: 'bg-kins', soft: 'bg-kins-soft' } : { text: 'text-kcarb', bar: 'bg-kcarb', soft: 'bg-kcarb-soft' };
  const clock = (ms: number) => fmtTime(new Date(ms));
  return (
    <div className="flex items-center gap-2.5" aria-label={`${title}: ${amount} ${unit}`}>
      <span className={cx('grid h-7 w-7 shrink-0 place-items-center rounded-full', c.soft, c.text)} title={title}><Icon name={icon} size={16} /></span>
      {/* first dose (or bite) → when the last one is done; the dot is now. Time runs left to right, as on the graph */}
      <div dir="ltr" className="min-w-0 flex-1">
        <div className={cx('relative h-2 rounded-full', c.soft)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={title}>
          <div className={cx('h-full rounded-full', c.bar)} style={{ width: `${frac * 100}%` }} />
          <span className={cx('absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white shadow', c.bar)} style={{ left: `calc(${frac * 100}% - 7px)` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-slate-500 tabular-nums">
          <span>{clock(lane.first)}{lane.n > 1 ? ` ×${lane.n}` : ''}</span>
          <span>{clock(lane.end)}</span>
        </div>
      </div>
      {/* left / of total: the numbers always read left to right */}
      <b className={cx('shrink-0 text-sm tabular-nums', c.text)}><bdi dir="ltr">{amount}</bdi> {unit}</b>
    </div>
  );
}
