import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { carbLane, carbsFrom, dosesFrom, insulinLane, iobParamsOk, type OnBoardLane } from '../engine/iob';
import { fmtTime } from '../lib/constants';
import { fmt } from '../lib/carbs';
import { Icon } from './Icon';
import { cx } from './ui';
import { dir, isEn, t } from '../i18n';
import type { IconName } from '../icons/defs';

const MIN = 60000;
export const dur = (ms: number) => {
  const all = Math.max(1, Math.round(ms / MIN)), h = Math.floor(all / 60), m = all % 60;
  return h > 0 && m > 0 ? t('{h} س {m} د', { h, m }) : h > 0 ? t('{h} س', { h }) : t('{m} د', { m });
};

/**
 * Insulin and carbs still on board, as two thin timelines under the graph: how much is left of how much, when it
 * was given or eaten, how long ago, and when the care team's duration (or absorption time) runs out. Words, not
 * IOB/COB. Display only: nothing here is an amount to give.
 */
export function OnBoardLanes() {
  const { settings: s, history, events } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const doses = useMemo(() => dosesFrom(events), [events]);
  const carbs = useMemo(() => carbsFrom(history, events), [history, events]);
  const p = s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null;
  const ins = iobParamsOk(p) ? insulinLane(doses, now, p) : null;
  const cob = s.cob_absorb_min ? carbLane(carbs, now, s.cob_absorb_min) : null;
  const modelOn = iobParamsOk(p) || !!s.cob_absorb_min;

  return (
    <section aria-label={t('ما زال يعمل')} className="space-y-2">
      {ins && <Lane lane={ins} now={now} icon="insulin" tone="ins" title={t('إنسولين نشط')}
        amount={t('{left} وحدة باقية من {total}', { left: ins.left.toFixed(2), total: fmt(ins.total) })}
        from={ins.n === 1 ? t('جرعة {time}', { time: fmtTime(new Date(ins.first)) }) : t('{n} جرعات، آخرها {time}', { n: ins.n, time: fmtTime(new Date(ins.last)) })} />}
      {cob && <Lane lane={cob} now={now} icon="meals" tone="carb" title={t('كارب يُمتص')}
        amount={t('{left} غ باقية من {total}', { left: fmt(Math.round(cob.left * 10) / 10), total: fmt(cob.total) })}
        from={cob.n === 1 ? t('أكل {time}', { time: fmtTime(new Date(cob.first)) }) : t('{n} مرات أكل، آخرها {time}', { n: cob.n, time: fmtTime(new Date(cob.last)) })} />}
      {modelOn && !ins && !cob && <p className="px-1 text-sm text-slate-500">{t('لا إنسولين سريع ولا كارب ما زال يعمل.')}</p>}
      <Link to="/status" className="flex min-h-[40px] items-center gap-2 px-1 text-xs text-slate-500">
        <span className="min-w-0 flex-1">{modelOn ? t('تقديرات من إعدادات الفريق الطبي، للعرض فقط.') : t('الحالة والحساس')}</span>
        <span className="shrink-0 font-bold text-brand">{t('الحالة')} {isEn() ? '›' : '‹'}</span>
      </Link>
    </section>
  );
}

function Lane({ lane, now, icon, tone, title, amount, from }: { lane: OnBoardLane; now: number; icon: IconName; tone: 'ins' | 'carb'; title: string; amount: string; from: string }) {
  const frac = Math.min(1, Math.max(0, (now - lane.first) / (lane.end - lane.first)));
  const c = tone === 'ins' ? { text: 'text-kins', bar: 'bg-kins', soft: 'bg-kins-soft' } : { text: 'text-kcarb', bar: 'bg-kcarb', soft: 'bg-kcarb-soft' };
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full', c.soft, c.text)}><Icon name={icon} size={15} /></span>
        <b className="text-slate-800">{title}</b>
        <span className={cx('ms-auto font-bold tabular-nums', c.text)}>{amount}</span>
      </div>
      {/* from the first dose (or bite) to when the last one is done; the dot is now. Time runs left to right, as on the graph */}
      <div dir="ltr" className={cx('relative mt-2 h-2 rounded-full', c.soft)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={title}>
        <div className={cx('h-full rounded-full', c.bar)} style={{ width: `${frac * 100}%` }} />
        <span className={cx('absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-white shadow', c.bar)} style={{ left: `calc(${frac * 100}% - 7px)` }} />
      </div>
      <div dir="ltr" className="mt-1 flex items-start justify-between gap-2 text-xs text-slate-500">
        <span dir={dir()} className="text-left">{from} · {t('قبل {d}', { d: dur(now - lane.last) })}</span>
        <span dir={dir()} className="text-right">{t('ينتهي نحو {time}', { time: fmtTime(new Date(lane.end)) })} · {t('بعد {d}', { d: dur(lane.end - now) })}</span>
      </div>
    </div>
  );
}
