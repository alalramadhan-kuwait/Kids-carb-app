// Mom mode: one entry (a shot or a juice) opened from home or the sites list. Change the units or the place, or
// remove it as a mistake. A plan's dose removed also cancels the plan, so nothing waits on it.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { deleteEvent, restoreEvent, setEventUnits } from '../../lib/api';
import { setEntryTime } from '../../lib/entrySave';
import { updateEvent } from '../../lib/editSave';
import { useComparisons } from '../../lib/fingerprick';
import { formatGlucose, toMgdl } from '../../lib/glucose';
import { TimePicker } from '../../components/TimePicker';
import { setGivenUnits, skipPlan, usePlans } from '../../lib/plans';
import { fmt } from '../../lib/carbs';
import { cx, inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, MomPage, PenBar, PEN_NAME, SITE_NAME, clock, ago } from './MomUI';
import { whoLine } from './MomMealEntry';

export function MomEntry() {
  const nav = useNavigate();
  const { id } = useParams();
  const { events, history, settings, me, reload, nameOf } = useData();
  const { rows: cmpRows } = useComparisons(events, history);   // also completes a finger-prick's comparison with the sensor
  const { plans } = usePlans();
  const e = events.find((x) => x.id === id && !x.deleted_at);
  const plan = plans.find((p) => p.dose_event_id === id);
  const [u, setU] = useState<number | null>(null);
  const [when, setWhen] = useState<number | null>(null);
  const [bgText, setBgText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!e) return <MomPage title="…" back="/mom"><span /></MomPage>;
  const shot = e.kind === 'insulin', prick = e.kind === 'bg_check';
  const type = e.insulin_type === 'long' ? 'long' as const : 'rapid' as const;
  const step = type === 'long' ? 1 : settings.pen_step ?? 1;
  const units = u ?? e.insulin_units ?? 0;
  const at = Date.parse(e.occurred_at);
  const bgMg = bgText !== null && bgText.trim() !== '' && Number.isFinite(Number(bgText.replace(',', '.'))) ? toMgdl(Number(bgText.replace(',', '.')), settings.glucose_unit) : null;
  const bgOk = bgMg !== null && bgMg >= 20 && bgMg <= 600;
  const timeChanged = when !== null && when !== at;
  const changed = (shot && u !== null && u !== e.insulin_units && units > 0) || (prick && bgText !== null && bgOk && bgMg !== e.bg_mgdl) || timeChanged;
  const run = async (f: () => Promise<unknown>, done: string, undo?: () => Promise<unknown>) => {
    setBusy(true);
    try { await f(); await reload(); toast(done, undo && { label: t('تراجع'), run: async () => { await undo(); await reload(); } }); nav('/mom', { replace: true }); }
    catch (x) { toast((x as Error).message); setBusy(false); }
  };
  const saveAll = () => run(async () => {
    if (shot && u !== null && u !== e.insulin_units) { await setEventUnits(e.id, units, me); if (plan) await setGivenUnits(plan.id, units); }
    // a finger-prick's number or time changing restarts its comparison with the sensor (updateEvent does both)
    if (prick && ((bgText !== null && bgOk && bgMg !== e.bg_mgdl) || timeChanged)) await updateEvent(e, { t: when ?? at, bg: bgText !== null && bgOk ? bgMg! : e.bg_mgdl! }, me);
    else if (timeChanged) await setEntryTime({ e }, when!, me);
  }, t('تم ✓'));
  const remove = () => {
    if (!window.confirm(t('تمسحينها؟'))) return;
    // Undo brings the entry back (the plan it belonged to stays set aside: Dad re-links it if needed)
    void run(async () => { await deleteEvent(e.id, me); if (plan && plan.status === 'dosed') await skipPlan(plan.id); }, t('انمسحت'), () => restoreEvent(e.id));
  };
  return (
    <MomPage title={shot ? t(PEN_NAME[type]) : prick ? t('فحص بالإصبع') : t('عصير')} back="/mom" foot={<>
      {changed && <Big disabled={busy} onClick={saveAll}>✓ {shot && u !== null && u !== e.insulin_units ? t('احفظي {u} وحدة', { u: fmt(units) }) : t('احفظي')}</Big>}
      <Big tone="ghost" disabled={busy} onClick={remove} className="!text-over">🗑 {t('غلط · امسحيها')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-3xl bg-white px-4 py-3">
        {shot ? <PenBar type={type} /> : <span className="text-3xl">{prick ? '🩸' : '🧃'}</span>}
        <span className="flex-1 text-[18px]">{shot ? `${fmt(e.insulin_units ?? 0)} ${t('وحدة')}` : prick ? <b className="num">{formatGlucose(e.bg_mgdl ?? 0, settings.glucose_unit)}</b> : <><bdi>{tMaybe(e.treatment ?? '')}</bdi> · {fmt(e.carbs_g ?? 0)} {t('غ كارب')}</>}</span>
        <span className="text-[15px] text-slate-500">{clock(at)} · {ago(at)}</span>
      </div>
      {!e.source && <p className="px-2 text-[15px] text-slate-500">{whoLine(e, nameOf)}</p>}
      {plan && <p className="text-center text-[16px] text-slate-500">🍽️ <bdi>{plan.name}</bdi></p>}
      {prick && <input inputMode="decimal" dir="ltr" value={bgText ?? formatGlucose(e.bg_mgdl ?? 0, settings.glucose_unit)} onChange={(x) => setBgText(x.target.value)}
        className={cx(inputCls, '!min-h-[72px] !text-center !text-[40px] font-extrabold')} />}
      {prick && (() => {
        const c = cmpRows?.find((r) => r.event_id === e.id);
        const unit = settings.glucose_unit;
        if (!c || !c.complete || c.libre_now === null) return <p className="text-center text-[16px] text-slate-500">{t('بنقارنها مع الحساس لما تتوفر قراءاته')}</p>;
        const d = c.diff_pct;
        return <p className="rounded-2xl bg-white px-4 py-3 text-center text-[17px]">📡 {t('الحساس وقتها')} <b className="num">{formatGlucose(c.libre_now, unit)}</b>{d !== null && <span className="text-slate-500"> · <span dir="ltr" className="num">{d > 0 ? '+' : ''}{Math.round(d)}%</span> {Math.abs(d) <= 15 ? t('متقاربة ✓') : t('الفرق كبير')}</span>}</p>;
      })()}
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
      <div className="text-[17px] font-bold">{t('متى؟')}</div>
      <TimePicker value={when ?? at} onChange={setWhen} />
    </MomPage>
  );
}
