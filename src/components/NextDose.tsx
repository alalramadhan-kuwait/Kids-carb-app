import { useEffect, useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { dosesFrom } from '../engine/iob';
import { doseGap } from '../engine/dose';
import { Icon } from './Icon';
import { dur } from './OnBoardLanes';
import { t } from '../i18n';

/** The care plan's gap between rapid doses (2 hours by default), as one quiet line while it is running. It is a
 *  rule from the care plan, not a sign that a dose is due or safe: nothing shows once it has passed, and the dose
 *  calculator still checks the glucose, the insulin still working and everything else before any dose. */
export function NextDose() {
  const { settings: s, events } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const doses = useMemo(() => dosesFrom(events), [events]);
  const g = doseGap(doses, now, s.dose_gap_min ?? 120);
  if (!g || g.left <= 0) return null;
  return (
    <p className="mt-2 flex items-center gap-1.5 text-[13.5px] text-slate-500">
      <Icon name="clock" size={14} className="shrink-0" />
      <span>{t('فاصل الجرعات حسب الخطة: باقي {time}', { time: dur(g.left) })}</span>
    </p>
  );
}
