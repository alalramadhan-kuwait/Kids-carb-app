// Simple mode: something she ate, opened from the Log. Change what it is called (breakfast, lunch, dinner, snack),
// change the time, or remove it as a mistake. What she ate is listed (read only); nothing else about the food changes here.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { deleteHistory } from '../../lib/api';
import { setEntryTime, setMealName } from '../../lib/entrySave';
import { fmt, unitText } from '../../lib/carbs';
import { photoUrl } from '../../lib/supabase';
import { TimePicker } from '../../components/TimePicker';
import { toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, Choice, MomPage, clock, ago } from './MomUI';
import { plateFromLog, useCatalog } from './MomMeal';
import { draftOps } from '../../lib/mom';

const NAMES = [['breakfast', 'فطور', '🍳'], ['lunch', 'غدا', '🍛'], ['dinner', 'عشا', '🍽️'], ['snack', 'سناك', '🍎']] as const; // i18n-ok: stored names, shown via t()

export function MomMealEntry() {
  const nav = useNavigate();
  const { id } = useParams();
  const { history, me, reload } = useData();
  const h = history.find((x) => x.id === id);
  const [name, setName] = useState<string | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { c, itemCarbs } = useCatalog();
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
      {/* the same food again, its amounts changed: onto the plate as a new meal (this one stays as it is) */}
      {!changed && h.lines.length > 0 && <Big tone="soft" disabled={busy} onClick={() => { const r = plateFromLog(h, c.products, itemCarbs); draftOps.loadItems(r.items, r.left); nav('/mom/meal'); }}>🍽️ {t('عدّليها لوجبة جديدة')}</Big>}
      <Big tone="ghost" disabled={busy} onClick={remove} className="!text-over">🗑 {t('غلط · امسحيها')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-3xl bg-white px-4 py-3">
        <span className="text-3xl">🍽️</span>
        <span className="min-w-0 flex-1 text-[18px]"><bdi>{tMaybe(nameNow)}</bdi> · <b className="num">{fmt(h.total_carbs)}</b> {t('غرام')}</span>
        <span className="text-[15px] text-slate-500">{clock(was)} · {ago(was)}</span>
      </div>
      {/* what was logged: each food, how much, and its carbs */}
      {(h.lines.length > 0 || h.photo_path) && (
        <div className="space-y-2 rounded-3xl bg-white px-4 py-3">
          <div className="text-[17px] font-bold">{t('شنو أكلت؟')}</div>
          {h.lines.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {h.lines.map((l, i) => (
                <li key={i} className="flex items-baseline gap-2 py-2 text-[17px]">
                  <span className="min-w-0 flex-1"><bdi>{tMaybe(l.name)}</bdi> <span className="num text-[15px] text-slate-500">· {fmt(l.unit === 'g' || l.unit === 'ml' ? Math.round(l.quantity) : l.quantity)} {unitText(l.unit)}</span></span>
                  <span className="num shrink-0 font-bold">{fmt(l.carbs)} <span className="text-[14px] font-normal text-slate-500">{t('غرام')}</span></span>
                </li>
              ))}
            </ul>
          )}
          {h.photo_path && <img src={photoUrl(h.photo_path)!} alt={t('صورة الأكل')} className="max-h-48 w-full rounded-2xl object-cover" />}
        </div>
      )}
      <div className="text-[17px] font-bold">{t('شنو هذي؟')}</div>
      <div className="grid grid-cols-2 gap-2">
        {NAMES.map(([k, ar, icon]) => <Choice key={k} icon={icon} label={t(ar)} on={nameNow === ar} onClick={() => setName(ar)} />)}
      </div>
      <div className="text-[17px] font-bold">{t('متى أكلت؟')}</div>
      <TimePicker value={at ?? was} onChange={setAt} />
    </MomPage>
  );
}
