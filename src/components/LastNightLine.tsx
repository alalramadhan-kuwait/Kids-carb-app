// One line on the home screens from 07:00 to 13:00: last night's 00:00–07:00 at a glance, opening Analysis → Night.
// Read only: the lowest sensor reading as it read, the treatments as logged, and whether a finger-prick came first.
import { Link } from 'react-router-dom';
import { useLastNight } from '../lib/nightTresiba';
import { NT } from '../engine/nightTresiba';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import { fmtTime } from '../lib/constants';
import { fmt } from '../lib/carbs';
import { cx } from './ui';
import { t } from '../i18n';

export function LastNightLine({ unit, className }: { unit: GlucoseUnit; className?: string }) {
  const n = useLastNight();
  if (!n || n.min === null) return null;
  const low = n.min < NT.lowMg;
  return (
    <Link to="/analysis?mode=night" className={cx('flex min-h-[44px] shrink-0 items-center gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-1.5 text-[14.5px]', className)}>
      <span aria-hidden>🌙</span>
      <span className="min-w-0 flex-1 truncate">
        <b>{t('الليلة')}</b>
        {n.units !== null && <> · <span className="num">{fmt(n.units)}U</span></>}
        {' · '}<b className={cx('num', low && 'text-over')}>⬇ {formatGlucose(n.min, unit)}</b>{n.minAt !== null && <span className="num text-slate-500"> {fmtTime(new Date(n.minAt))}</span>}
        {n.juices > 0 && <> · 🧃 <span className="num">{n.juices}</span></>}
        {n.prickBefore !== null && <> · 🩸 {n.prickBefore ? '✓' : '✗'}</>}
      </span>
      <span className="text-slate-400">›</span>
    </Link>
  );
}
