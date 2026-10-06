// Simple mode: something she ate, opened from the Log. Change what it is called (breakfast, lunch, dinner, snack),
// change the time, or remove it as a mistake. Nothing else about the food changes here.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { deleteHistory } from '../../lib/api';
import { setEntryTime, setMealName } from '../../lib/entrySave';
import { fmt } from '../../lib/carbs';
import { TimePicker } from '../../components/TimePicker';
import { toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, Choice, MomPage, clock, ago } from './MomUI';

const NAMES = [['breakfast', 'فطور', '🍳'], ['lunch', 'غدا', '🍛'], ['dinner', 'عشا', '🍽️'], ['snack', 'سناك', '🍎']] as const; // i18n-ok: stored names, shown via t()

export function MomMealEntry() {
  const nav = useNavigate();
  const { id } = useParams();
  const { history, me, reload } = useData();
  const h = history.find((x) => x.id === id);
  const [name, setName] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  if (!h) return <MomPage title="…" back="/mom/log"><span /></MomPage>;
  const was = Date.parse(h.eaten_at);
  const nameNow = name ?? h.name;
  const changed = (name !== null && name !== h.name) || (at !== null && at !== was);
  const run = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await f(); await reload(); toast(done); nav('/mom/log', { replace: true }); }
    catch (x) { toast((x as Error).message); setBusy(false); }
  };
  const save = () => run(async () => {
    if (name !== null && name !== h.name) await setMealName(h.id, name, me);
    if (at !== null && at !== was) await setEntryTime({ h }, at, me);
  }, t('تم ✓'));
  const remove = () => {
    if (!window.confirm(t('تمسحينها؟'))) return;
    void run(() => deleteHistory(h.id), t('انمسحت'));
  };
  return (
    <MomPage title={t('الأكل')} back="/mom/log" foot={<>
      {changed && <Big disabled={busy} onClick={save}>✓ {t('احفظي')}</Big>}
      <Big tone="ghost" disabled={busy} onClick={remove} className="!text-over">🗑 {t('غلط · امسحيها')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-3xl bg-white px-4 py-3">
        <span className="text-3xl">🍽️</span>
        <span className="min-w-0 flex-1 text-[18px]"><bdi>{tMaybe(nameNow)}</bdi> · <b className="num">{fmt(h.total_carbs)}</b> {t('غرام')}</span>
        <span className="text-[15px] text-slate-500">{clock(was)} · {ago(was)}</span>
      </div>
      <div className="text-[17px] font-bold">{t('شنو هذي؟')}</div>
      <div className="grid grid-cols-2 gap-2">
        {NAMES.map(([k, ar, icon]) => <Choice key={k} icon={icon} label={t(ar)} on={nameNow === ar} onClick={() => setName(ar)} />)}
      </div>
      <div className="text-[17px] font-bold">{t('متى أكلت؟')}</div>
      <TimePicker value={at ?? was} onChange={setAt} />
    </MomPage>
  );
}
