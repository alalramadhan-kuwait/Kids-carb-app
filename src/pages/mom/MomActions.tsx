// Home's two buttons, Food and Medical: each opens a full page with its few choices (no half-open sheets). Home passes
// whether she is low now, so the same choices are held back as on Home before: no meal and no injection while low.
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
function useLow() {
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

export function MomFoodMenu() {
  const nav = useNavigate(), low = useLow(), n = useOpenPlans().length;
  const build = (mode: 'now' | 'plan') => { if (okToReplace(mode)) draftOps.start(mode); nav('/mom/meal?from=home', { replace: true }); };
  return (
    <MomPage title={t('أكل')} back="/mom">
      <div className="space-y-2.5">
        {low && <p className="rounded-2xl bg-over-soft px-4 py-2 font-bold text-over">{t('السكر نازل: عصير أول')}</p>}
        <Off off={low}><Choice icon="🍽️" label={t('أضيفي وجبة')} onClick={() => build('now')} /></Off>
        <Off off={low}><Choice icon="📷" label={t('صوّري الأكل')} onClick={() => nav('/mom/snap')} /></Off>
        <Off off={low}><Choice icon="📅" label={t('خططي وجبة')} onClick={() => build('plan')} /></Off>
        <Choice icon="🧃" label={t('عصير')} onClick={() => nav('/mom/juice', { replace: true })} />
        {/* the planned meals (moved here from More); Back from the list returns to this page */}
        <Choice icon="🗓️" label={t('مخططة')} sub={n ? t('{n} معلّقة', { n }) : undefined} onClick={() => nav('/mom/plans')} />
      </div>
    </MomPage>
  );
}

export function MomMedicalMenu() {
  const nav = useNavigate(), low = useLow();
  return (
    <MomPage title={t('طبي')} back="/mom">
      <div className="space-y-2.5">
        <Off off={low}><Choice icon="💉" label={t('إبرة')} onClick={() => nav('/mom/shot', { replace: true })} /></Off>
        <Choice icon="🩸" label={t('وخز')} onClick={() => nav('/mom/prick', { replace: true })} />
      </div>
    </MomPage>
  );
}
