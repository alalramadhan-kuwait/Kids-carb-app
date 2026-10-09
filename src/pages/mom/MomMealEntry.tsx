// Simple mode: something she ate, opened from the Log. What she ate (each food, its weight, its carbs), who logged it
// and who changed it. «عدّلي» changes this same meal (foods, amounts, carbs, how much she ate); the kind of meal and
// the time change here; a mistake is removed (and can be brought back). The dose is behind one tap, for review only.
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { deleteHistory, restoreHistory } from '../../lib/api';
import { setEntryTime } from '../../lib/entrySave';
import { setMealSlot } from '../../lib/editSave';
import { fmt, unitText } from '../../lib/carbs';
import { photoUrl } from '../../lib/supabase';
import { TimePicker } from '../../components/TimePicker';
import { DoseReview } from '../../components/DoseReview';
import { toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { MealSlot } from '../../lib/types';
import { Big, Choice, MomPage, clock, ago } from './MomUI';
import { plateFromLog, useCatalog } from './MomMeal';
import { draftOps } from '../../lib/mom';

export const SLOT_CHOICES: [MealSlot, string, string][] = [['breakfast', 'فطور', '🍳'], ['lunch', 'غدا', '🍛'], ['dinner', 'عشا', '🍽️'], ['snack', 'سناك', '🍎']]; // i18n-ok: shown via t()
/** Who logged it, and who changed it last (and when): short, in her words. */
export function whoLine(h: { created_by?: string | null; edited_by?: string | null; edited_at?: string | null }, nameOf: (id: string | null | undefined) => string) {
  const by = h.created_by ? nameOf(h.created_by) : '';
  const ed = h.edited_by && h.edited_at ? t('عدّلها {who} {when}', { who: nameOf(h.edited_by), when: ago(Date.parse(h.edited_at)) }) : '';
  return [by && t('سجّلها {who}', { who: by }), ed].filter(Boolean).join(' · ');
}

export function MomMealEntry() {
  const nav = useNavigate();
  const { id } = useParams();
  const { history, pendingMeals, me, reload, nameOf } = useData();
  const h = history.find((x) => x.id === id) ?? pendingMeals.find((x) => x.id === id);
  const [at, setAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const { c, itemCarbs } = useCatalog();
  if (!h) return <MomPage title="…" back="/mom/log"><span /></MomPage>;
  const was = Date.parse(h.eaten_at);
  const changed = at !== null && at !== was;
  const pending = h.intake === 'pending';
  const run = async (f: () => Promise<unknown>, done: string, undo?: () => Promise<unknown>, to = '/mom/log') => {
    setBusy(true);
    try { await f(); await reload(); toast(done, undo && { label: t('تراجع'), run: async () => { await undo(); await reload(); } }); nav(to, { replace: true }); }
    catch (x) { toast((x as Error).message); setBusy(false); }
  };
  const slot = async (s: MealSlot) => {
    setBusy(true);
    try { await setMealSlot(h.id, s, me); await reload(); } catch (x) { toast((x as Error).message); } finally { setBusy(false); }
  };
  const remove = () => {
    if (!window.confirm(t('تمسحينها؟'))) return;
    void run(() => deleteHistory(h.id, me), t('انمسحت'), () => restoreHistory(h.id));
  };
  const who = whoLine(h, nameOf);
  return (
    <MomPage title={t('الأكل')} back="/mom/log" foot={changed ? <Big disabled={busy} onClick={() => run(() => setEntryTime({ h }, at!, me), t('تم ✓'))}>✓ {t('احفظي')}</Big> : undefined}>
      <div className="rounded-3xl bg-white px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="text-3xl">🍽️</span>
          <span className="min-w-0 flex-1">
            <b className="block text-[20px] leading-snug"><bdi>{tMaybe(h.name)}</bdi></b>
            <span className="text-[15px] text-slate-500">{clock(was)} · {ago(was)}</span>
          </span>
          <span className="shrink-0 text-center"><b className="num block text-[26px] leading-none">{fmt(h.total_carbs)}</b><span className="block text-[14px] text-slate-500">{t('غ كارب')}</span></span>
        </div>
        {who && <div className="mt-2 text-[15px] text-slate-500">{who}</div>}
      </div>
      {pending && (
        <button onClick={() => nav(`/mom/ate/${h.client_id}`)} className="flex min-h-[60px] w-full items-center justify-between rounded-3xl bg-near-soft px-4 text-[18px] font-bold text-near">
          <span>⏳ {t('كم أكلت؟')}</span><span className="text-[15px] font-normal">{t('ما انحسبت بعد')} ›</span>
        </button>
      )}
      {/* what was logged: each food, how much of it (weight), and its carbs */}
      {(h.lines.length > 0 || h.photo_path) && (
        <div className="space-y-2 rounded-3xl bg-white px-4 py-3">
          <div className="text-[17px] font-bold">{t('شنو أكلت؟')}</div>
          {h.lines.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {h.lines.map((l, i) => (
                <li key={i} className="flex items-baseline gap-2 py-2 text-[17px]">
                  <span className="min-w-0 flex-1"><bdi>{tMaybe(l.name)}</bdi> <span className="num whitespace-nowrap text-[15px] text-slate-500">· {fmt(l.unit === 'g' || l.unit === 'ml' ? Math.round(l.quantity) : l.quantity)} {unitText(l.unit)}</span></span>
                  <span className="num shrink-0 font-bold">{fmt(l.carbs ?? 0)} <span className="text-[14px] font-normal text-slate-500">{t('غ كارب')}</span></span>
                </li>
              ))}
            </ul>
          )}
          {h.photo_path && <img src={photoUrl(h.photo_path)!} alt={t('صورة الأكل')} className="max-h-48 w-full rounded-2xl object-cover" />}
        </div>
      )}
      <Big disabled={busy} onClick={() => nav(`/mom/meal-edit/${h.id}`)}>✏️ {t('عدّلي الأكل')}</Big>
      <DoseReview h={h} simple />
      <div className="text-[17px] font-bold">{t('شنو هذي؟')}</div>
      <div className="grid grid-cols-2 gap-2">
        {SLOT_CHOICES.map(([k, w, icon]) => <Choice key={k} icon={icon} label={t(w)} on={h.meal_slot === k} onClick={() => void slot(k)} />)}
      </div>
      <div className="text-[17px] font-bold">{t('متى أكلت؟')}</div>
      <TimePicker value={at ?? was} onChange={setAt} />
      <div className="flex flex-col gap-1 pt-2">
        {h.lines.length > 0 && <button disabled={busy} className="min-h-[48px] text-[16px] font-bold text-brand" onClick={() => { const r = plateFromLog(h, c.products, itemCarbs); draftOps.loadItems(r.items, r.left); nav('/mom/meal'); }}>🍽️ {t('نفس الأكل لوجبة جديدة')}</button>}
        <button disabled={busy} className="min-h-[48px] text-[16px] font-bold text-over" onClick={remove}>🗑 {t('غلط · امسحيها')}</button>
      </div>
    </MomPage>
  );
}
