import { useEffect, useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { dosesFrom } from '../engine/iob';
import { doseGap } from '../engine/dose';
import { fmtTime } from '../lib/constants';
import { Icon } from './Icon';
import { cx } from './ui';
import { t } from '../i18n';

const MIN = 60000;
const span = (ms: number) => {
  const h = Math.floor(ms / 3600000), m = Math.ceil((ms % 3600000) / MIN);
  return h > 0 && m > 0 ? t('{h} س {m} د', { h, m }) : h > 0 ? t('{h} س', { h }) : t('{m} د', { m: Math.max(1, m) });
};

/** The care plan's gap between rapid doses (2 hours by default): when the last one was and when the next may be
 *  given, counting down. Only the gap; the dose calculator checks the glucose and everything else. */
export function NextDose() {
  const { settings: s, events } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const doses = useMemo(() => dosesFrom(events), [events]);
  const g = doseGap(doses, now, s.dose_gap_min ?? 120);
  if (!g) return null;
  const waiting = g.left > 0;
  const last = t('آخر جرعة سريعة {u} وحدة · {time}', { u: g.lastUnits, time: fmtTime(new Date(g.lastAt)) });
  return (
    <div className={cx('mt-2 rounded-xl px-3 py-2', waiting ? 'bg-kins-soft' : 'bg-ok-soft')}>
      <div className="flex items-center gap-2">
        <Icon name="clock" size={18} className={waiting ? 'text-kins' : 'text-ok'} />
        {waiting ? (
          <p className="min-w-0 flex-1 text-sm text-slate-700">
            {t('الجرعة التالية بعد')} <b className="text-slate-900">{fmtTime(new Date(g.until))}</b>
            <span className="text-slate-500"> · {t('باقي {time}', { time: span(g.left) })}</span>
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-sm font-medium text-ok">{t('مرّت {h} على آخر جرعة سريعة', { h: span((s.dose_gap_min ?? 120) * MIN) })}</p>
        )}
      </div>
      {waiting && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(g.frac * 100)} aria-label={t('الوقت منذ آخر جرعة')}>
          <div className="h-full rounded-full bg-kins" style={{ width: `${g.frac * 100}%` }} />
        </div>
      )}
      <p className="mt-1 text-xs text-slate-500">{last}</p>
    </div>
  );
}
