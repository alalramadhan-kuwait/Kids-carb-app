// Simple mode: something she ate, opened from the Log. What she ate (each food, its weight, its carbs), who logged it
// and who changed it. «عدّلي» changes this same meal (foods, amounts, carbs, how much she ate); the kind of meal and
// the time change here; a mistake is removed (and can be brought back). The dose is behind one tap, for review only.
import { mealTitle } from '../../lib/unknownMeal';
import { useEffect, useState } from 'react';
import { fetchPlan } from '../../lib/plans';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { deleteHistory, restoreHistory } from '../../lib/api';
import { setEntryTime } from '../../lib/entrySave';
import { setMealSlot } from '../../lib/editSave';
import { fmt, unitText } from '../../lib/carbs';
import { photoUrl } from '../../lib/supabase';
import { TimePicker } from '../../components/TimePicker';
import { DoseReview } from '../../components/DoseReview';
import { cx, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { MealSlot, PlannedMeal } from '../../lib/types';
import { Big, MomPage, clock, ago, okToReplace, SourceTag } from './MomUI';
import { carbSource } from '../../engine/source';
import { useCatalog } from './MomMeal';
import { repeatPlate } from '../../lib/repeatMeal';
import { draftOps } from '../../lib/mom';

const PLATE_WORD = { small: 'صغير', medium: 'وسط', large: 'كبير' } as const; // i18n-ok: shown via t()
const ATE_WORD = { all: 'كله', half: 'نصه', little: 'شوي' } as const; // i18n-ok: shown via t()
// no «snack»: a meal is named by what she ate, and only the time of day is asked
export const SLOT_CHOICES: [MealSlot, string, string][] = [['breakfast', 'فطور', '🍳'], ['lunch', 'غدا', '🍛'], ['dinner', 'عشا', '🍽️']]; // i18n-ok: shown via t()
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
  const unknown = h.total_carbs === null;
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
  // a line's carb source: kept with the entry since P0, else found from the food it names (older entries)
  const srcOf = (l: (typeof h.lines)[number]) => l.src ?? carbSource(c.products.find((p) => [p.name, p.brand].filter(Boolean).join(' — ') === l.product));
  // «خططيها بكرة»: the same foods as a plan for tomorrow at the same time; a food to check goes to the plate first
  const planTomorrow = () => {
    if (!okToReplace('plan')) return;
    const r = repeatPlate(h, c.products, itemCarbs);
    draftOps.planItems(r.items, r.review, h.name);
    const d = new Date(was), hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    nav(r.review.length ? '/mom/meal' : `/mom/when?day=tomorrow&eat=${hm}`);
  };
  // one food whose name is the meal's name: its weight goes on the title's line instead of a list that repeats it
  const single = h.lines.length === 1 && tMaybe(h.lines[0].name) === mealTitle(h) ? h.lines[0] : null;
  const amount = (l: (typeof h.lines)[number]) => `${fmt(l.unit === 'g' || l.unit === 'ml' ? Math.round(l.quantity) : l.quantity)} ${unitText(l.unit)}`;
  return (
    <MomPage compact title={t('الأكل')} back="/mom/log" foot={changed ? <Big md disabled={busy} onClick={() => run(() => setEntryTime({ h }, at!, me), t('تم ✓'))}>✓ {t('احفظي')}</Big> : undefined}>
      {/* the meal in one card: what, when, carbs, each food (when more than one), who, and the way to change it */}
      <div className="space-y-2 rounded-3xl bg-white px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="text-[26px] leading-none">🍽️</span>
          <span className="min-w-0 flex-1">
            <b className="block text-[17px] leading-snug"><bdi>{mealTitle(h)}</bdi></b>
            <span className="text-[13px] text-slate-500">{single && <><span className="num">{amount(single)}</span> · </>}{clock(was)} · {ago(was)}</span>
          </span>
          {unknown
            ? <span className="shrink-0 rounded-2xl bg-near-soft px-3 py-1 text-center text-[14px] font-bold leading-tight text-near">❓<br />{t('الكارب غير معروف')}</span>
            : <span className="shrink-0 text-center"><b className="num block text-[24px] leading-none">{fmt(h.total_carbs)}</b><span className="block text-[12px] text-slate-500">{t('غ كارب')}</span></span>}
        </div>
        {!single && h.lines.length > 0 && (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {h.lines.map((l, i) => (
              <li key={i} className="flex items-baseline gap-2 py-1.5 text-[15px]">
                <span className="min-w-0 flex-1"><bdi>{tMaybe(l.name)}</bdi><SourceTag s={srcOf(l)} /> <span className="num whitespace-nowrap text-[13px] text-slate-500">· {amount(l)}</span></span>
                <span className="num shrink-0 font-bold">{fmt(l.carbs ?? 0)} <span className="text-[12px] font-normal text-slate-500">{t('غ')}</span></span>
              </li>
            ))}
          </ul>
        )}
        {h.photo_path && <img src={photoUrl(h.photo_path)!} alt={t('صورة الأكل')} className="max-h-32 w-full rounded-2xl object-cover" />}
        {who && <div className="truncate text-[13px] text-slate-500">{who}</div>}
      </div>
      {/* three actions, each its own page: the graph at this meal (12 h centred on it; Back returns here), the same food
          as a new meal (a new plate: every food kept, an unmatched one flagged for review; the original and its insulin
          are not touched), and edit */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => nav(`/mom/graph?at=${was}`)} className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-[14px] font-bold leading-tight text-brand active:opacity-80"><span aria-hidden className="text-[20px]">📈</span>{t('عرض في الرسم')}</button>
        {h.lines.length > 0 && <button disabled={busy} onClick={() => { if (okToReplace()) { const r = repeatPlate(h, c.products, itemCarbs); draftOps.loadItems(r.items, r.review); } nav('/mom/meal'); }} className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-[14px] font-bold leading-tight text-brand active:opacity-80"><span aria-hidden className="text-[20px]">🔁</span>{t('كرري الوجبة')}</button>}
        {h.lines.length > 0 && <button disabled={busy} onClick={planTomorrow} className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-white text-[14px] font-bold leading-tight text-brand active:opacity-80"><span aria-hidden className="text-[20px]">📅</span>{t('خططيها بكرة')}</button>}
        <button disabled={busy} onClick={() => nav(`/mom/meal-edit/${h.id}`)} className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-brand px-1 text-[14px] font-bold leading-tight text-white active:opacity-80"><span aria-hidden className="text-[20px]">✏️</span>{unknown ? t('عرفتي الكارب؟ اكتبيه') : t('عدّلي الأكل')}</button>
      </div>
      {unknown && (
        <div className="space-y-1 rounded-3xl bg-white px-4 py-3 text-[16px]">
          {h.place && <div className="flex justify-between gap-3"><span className="text-slate-500">{t('وين؟')}</span><b><bdi>{h.place}</bdi></b></div>}
          {h.plate_size && <div className="flex justify-between gap-3"><span className="text-slate-500">{t('حجم الصحن')}</span><b>{t(PLATE_WORD[h.plate_size])}</b></div>}
          {h.ate && <div className="flex justify-between gap-3"><span className="text-slate-500">{t('كم أكلت منه؟')}</span><b>{t(ATE_WORD[h.ate])}</b></div>}
          {h.carbs_guess != null && <div className="flex justify-between gap-3"><span className="text-slate-500">{t('تخمين')}</span><b className="num">{t('{g} غ كارب', { g: fmt(h.carbs_guess) })}</b></div>}
          <p className="pt-1 text-[13px] text-slate-500">{t('ما انحسبت لها إبرة. لو عرفتي الكارب من المنيو، اكتبيه.')}</p>
        </div>
      )}
      {pending && (
        <button onClick={() => nav(`/mom/ate/${h.client_id}`)} className="flex min-h-[52px] w-full items-center justify-between rounded-3xl bg-near-soft px-4 text-[16px] font-bold text-near">
          <span>⏳ {t('كم أكلت؟')}</span><span className="text-[13px] font-normal">{t('تنحسب «كلها» تلقائيًا')} ›</span>
        </button>
      )}
      {!pending && h.client_id && <PartLine clientId={h.client_id} />}
      <DoseReview h={h} simple />
      <div className="text-[15px] font-bold">{t('شنو هذي؟')}</div>
      {/* the three times of day in one row */}
      <div className="grid grid-cols-3 gap-1.5">
        {SLOT_CHOICES.map(([k, w, icon]) => (
          <button key={k} onClick={() => void slot(k)} aria-pressed={h.meal_slot === k} disabled={busy}
            className={cx('flex min-h-[56px] flex-col items-center justify-center rounded-2xl border-2 bg-white text-[14px] font-bold leading-tight active:opacity-80', h.meal_slot === k ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200')}>
            <span aria-hidden className="text-[20px] leading-none">{icon}</span>{t(w)}
          </button>
        ))}
      </div>
      <div className="text-[15px] font-bold">{t('متى أكلت؟')}</div>
      <TimePicker compact value={at ?? was} onChange={setAt} />
      <button disabled={busy} className="min-h-[44px] w-full text-[14px] font-bold text-over" onClick={remove}>🗑 {t('غلط · امسحيها')}</button>
    </MomPage>
  );
}

/** A planned meal already counted: how much she ate (all of it unless someone said less), and a way to change it. */
function PartLine({ clientId }: { clientId: string }) {
  const nav = useNavigate();
  const [p, setP] = useState<PlannedMeal | null>(null);
  useEffect(() => { void fetchPlan(clientId).then(setP); }, [clientId]);
  if (!p || p.status !== 'eaten' || p.part_eaten == null) return null;
  const word = p.part_eaten >= 1 ? t('كلها') : p.part_eaten >= 0.75 ? '¾' : p.part_eaten >= 0.5 ? t('نصها') : p.part_eaten >= 0.25 ? t('ربعها') : t('شوي');
  return (
    <button onClick={() => nav(`/mom/ate/${p.id}`)} className="flex min-h-[56px] w-full items-center justify-between rounded-3xl bg-white px-4 text-[17px]">
      <span>{t('كم أكلت؟')} <b>{word}</b>{p.part_auto ? <span className="text-[14px] text-slate-500"> · {t('تلقائيًا')}</span> : null}</span><span className="font-bold text-brand">{t('غيّري')} ›</span>
    </button>
  );
}
