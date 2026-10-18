// Home's two buttons, Food and Medical: each opens a full page with its few choices (no half-open sheets). Home passes
// whether she is low now, so the same choices are held back as on Home before: no meal and no injection while low.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { draftOps } from '../../lib/mom';
import { useData } from '../../lib/data';
import { useGlucose } from '../../hooks/useGlucose';
import { effectiveRange } from '../../lib/glucose';
import { levelFromLibre, trendFrom } from '../../engine/trend';
import { moodOf } from '../../engine/mom';
import { Choice, MomPage, okToReplace } from './MomUI';
import { cx } from '../../components/ui';
import { useOpenPlans } from './MomPlan';
import { t } from '../../i18n';

// low now, worked out on this page from her latest reading the same way Home does (moodOf), so the choices are held
// back however the page was reached (a link, Back, a reminder); Home's hint is still honoured while a reading loads
export function useLow() {
  const fromHome = !!(useLocation().state as { low?: boolean } | null)?.low;
  const { settings: s } = useData();
  const { g } = useGlucose();
  const latest = g?.latest ?? null;
  if (!latest) return fromHome;
  const now = Date.now(), at = Date.parse(latest.taken_at);
  const range = effectiveRange(s.glucose_low_mgdl, s.glucose_high_mgdl);
  const level = trendFrom(g!.readings, now)?.level ?? levelFromLibre(latest.trend);
  return fromHome || moodOf(latest.mg_dl, (now - at) / 60000, level, s.alert_low_mgdl ?? range.low ?? 70, range.high ?? 180) === 'low';
}
const Off = ({ off, children }: { off: boolean; children: React.ReactNode }) => <div className={cx(off && 'pointer-events-none opacity-40')} aria-disabled={off}>{children}</div>;

/** The old Food menu: its address (reminders, Back from older pages) now opens «شنو بتاكل ليان؟», the food page, where
 *  the plate ends with «now or later». A plate under way is kept (okToReplace asks first). */
export function MomFoodMenu() {
  const nav = useNavigate(), low = useLow();
  useEffect(() => { if (okToReplace('now')) draftOps.start('now'); nav('/mom/meal?from=home', { replace: true, state: { low } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function MomMedicalMenu() {
  const nav = useNavigate(), low = useLow();
  return (
    <MomPage title={t('طبي')} back="/mom">
      <div className="space-y-2.5">
        <Off off={low}><Choice icon="💉" label={t('إبرة')} onClick={() => nav('/mom/shot', { replace: true })} /></Off>
        <Choice icon="🩸" label={t('وخز')} onClick={() => nav('/mom/prick', { replace: true })} />
        {/* juice, moved here from the old Food menu (also the red Home button when low) */}
        <Choice icon="🧃" label={t('عصير')} onClick={() => nav('/mom/juice', { replace: true })} />
      </div>
    </MomPage>
  );
}
