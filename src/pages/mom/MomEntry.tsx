// Mom mode: one entry (a shot or a juice) opened from home or the sites list. Change the units or the place, or
// remove it as a mistake. A plan's dose removed also cancels the plan, so nothing waits on it.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { deleteEvent, setEventUnits } from '../../lib/api';
import { setGivenUnits, skipPlan, usePlans } from '../../lib/plans';
import { fmt } from '../../lib/carbs';
import { toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, MomPage, PenBar, PEN_NAME, SITE_NAME, clock, ago } from './MomUI';

export function MomEntry() {
  const nav = useNavigate();
  const { id } = useParams();
  const { events, settings, me, reload } = useData();
  const { plans } = usePlans();
  const e = events.find((x) => x.id === id && !x.deleted_at);
  const plan = plans.find((p) => p.dose_event_id === id);
  const [u, setU] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!e) return <MomPage title="…" back="/mom"><span /></MomPage>;
  const shot = e.kind === 'insulin';
  const type = e.insulin_type === 'long' ? 'long' as const : 'rapid' as const;
  const step = type === 'long' ? 1 : settings.pen_step ?? 1;
  const units = u ?? e.insulin_units ?? 0;
  const changed = shot && u !== null && u !== e.insulin_units;
  const at = Date.parse(e.occurred_at);
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await f(); await reload(); toast(done); nav('/mom', { replace: true }); }
    catch (x) { toast((x as Error).message); setBusy(false); }
  };
  const saveUnits = () => run(async () => { await setEventUnits(e.id, units, me); if (plan) await setGivenUnits(plan.id, units); }, t('تم ✓'));
  const remove = () => {
    if (!window.confirm(t('تمسحينها؟'))) return;
    void run(async () => { await deleteEvent(e.id, me); if (plan && plan.status === 'dosed') await skipPlan(plan.id); }, t('انمسحت'));
  };
  return (
    <MomPage title={shot ? t(PEN_NAME[type]) : t('عصير')} back="/mom" foot={<>
      {changed && <Big disabled={busy || units <= 0} onClick={saveUnits}>✓ {t('احفظي {u} وحدة', { u: fmt(units) })}</Big>}
      <Big tone="ghost" disabled={busy} onClick={remove} className="!text-over">🗑 {t('غلط · امسحيها')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-3xl bg-white px-4 py-3">
        {shot ? <PenBar type={type} /> : <span className="text-3xl">🧃</span>}
        <span className="flex-1 text-[18px]">{shot ? `${fmt(e.insulin_units ?? 0)} ${t('وحدة')}` : <><bdi>{tMaybe(e.treatment ?? '')}</bdi> · {fmt(e.carbs_g ?? 0)} {t('غرام')}</>}</span>
        <span className="text-[15px] text-slate-500">{clock(at)} · {ago(at)}</span>
      </div>
      {plan && <p className="text-center text-[16px] text-slate-500">🍽️ <bdi>{plan.name}</bdi></p>}
      {shot && <>
        <div className="text-center text-[17px] font-bold">{t('كم عطيتيها؟')}</div>
        <div className="flex items-center justify-center gap-6">
          <button aria-label="+" className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-4xl font-bold text-brand" onClick={() => setU(Math.round((units + step) * 10) / 10)}>+</button>
          <span className="num w-20 text-center text-[48px] font-extrabold">{fmt(units)}</span>
          <button aria-label="−" className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-4xl font-bold text-brand" onClick={() => setU(Math.max(0, Math.round((units - step) * 10) / 10))}>−</button>
        </div>
        <button className="flex min-h-[60px] w-full items-center justify-between rounded-2xl border-2 border-slate-200 bg-white px-4 text-[18px]"
          onClick={() => nav(`/mom/site?e=${e.id}&type=${type}&next=/mom/entry/${e.id}`)}>
          <span>💉 {e.injection_site ? t(SITE_NAME[e.injection_site]) : t('وين عطيتيها؟')}</span><span className="text-brand font-bold">{t('غيّري')}</span>
        </button>
      </>}
    </MomPage>
  );
}
