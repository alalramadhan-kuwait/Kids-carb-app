// Simple mode: change a logged meal in place (the same entry, not a new one). Each food's amount with − and +, remove
// one, add one, or say how much of it she ate; a meal logged as carbs only changes its carbs. Carbs and nutrition are
// recalculated from the labels. The dose given is never changed; the dose for the corrected meal is kept for review.
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { addRow, carbsOfRow, recompute, rowsOf, scaledRows, type ItemRow } from '../../lib/mealItems';
import { setMealCarbs, updateMealItems } from '../../lib/editSave';
import { fmt, unitText } from '../../lib/carbs';
import { ProductPicker } from '../../components/ProductPicker';
import { toast, cx } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, MomPage } from './MomUI';

const PARTS: [number, string][] = [[1, 'كلها'], [0.75, '¾'], [0.5, 'نصها'], [0.25, 'ربعها']]; // i18n-ok: shown via t()
const stepOf = (unit: string) => (unit === 'g' || unit === 'ml' ? 10 : 0.5);
const r1 = (x: number) => Math.round(x * 10) / 10;


export function MomMealEdit() {
  const nav = useNavigate();
  const { id } = useParams();
  const { history, pendingMeals, products, settings, me, reload } = useData();
  const h = history.find((x) => x.id === id) ?? pendingMeals.find((x) => x.id === id);
  const [rows, setRows] = useState<ItemRow[]>(() => (h ? rowsOf(h, products) : []));
  const [carbs, setCarbs] = useState<number>(() => h?.total_carbs ?? 0);
  const [part, setPart] = useState(1);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const items = !!h && h.lines.length > 0;
  const r = useMemo(() => (h && items ? recompute(h, scaledRows(rows, part), settings) : null), [h, items, rows, part, settings]);
  if (!h) return <MomPage title="…" back="/mom/log"><span /></MomPage>;
  const total = items ? r!.carbs : r1(carbs * part);
  const changed = items ? part !== 1 || rows.some((x) => x.added || x.line.quantity !== x.q0) : carbs !== h.total_carbs || part !== 1;
  const back = `/mom/meal-entry/${h.id}`;
  // grams and millilitres move in whole steps of 10 (113.8 − 10 → 100, not 103.8)
  const setQty = (i: number, q: number) => setRows((xs) => xs.map((x, k) => (k === i ? { ...x, line: { ...x.line, quantity: Math.max(0, x.line.unit === 'g' || x.line.unit === 'ml' ? Math.round(q / 10) * 10 : r1(q)) } } : x)));
  const save = async () => {
    if (items && !r!.lines.length) return toast(t('خلّي صنف واحد على الأقل، أو امسحي الوجبة كلها'));
    setBusy(true);
    try {
      if (items) await updateMealItems(h, r!, me); else await setMealCarbs(h, total, part === 1 ? null : part, me);
      await reload(); toast(t('تم ✓')); nav(back, { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };

  if (picking) return (
    <MomPage title={t('أضيفي صنف')} back={back}>
      <ProductPicker onPick={(p) => { setRows((xs) => [...xs, addRow(p)]); setPicking(false); }} />
      <Big tone="ghost" onClick={() => setPicking(false)}>{t('رجوع')}</Big>
    </MomPage>
  );
  return (
    <MomPage title={t('عدّلي الأكل')} back={back} foot={<Big disabled={busy || !changed} onClick={save}>✓ {t('احفظي')}</Big>}>
      <div className="text-center text-[18px] text-slate-600"><bdi>{tMaybe(h.name)}</bdi></div>
      {items ? (
        <ul className="space-y-2">
          {rows.map((x, i) => {
            const gone = x.line.quantity <= 0, step = stepOf(x.line.unit);
            return (
              <li key={i} className={cx('rounded-3xl bg-white px-4 py-3', gone && 'opacity-50')}>
                <div className="flex items-baseline gap-2">
                  <b className={cx('min-w-0 flex-1 text-[18px]', gone && 'line-through')}><bdi>{tMaybe(x.line.name)}</bdi></b>
                  {!gone && <span className="num shrink-0 text-[17px] font-bold">{fmt(carbsOfRow(x, settings))} <span className="text-[14px] font-normal text-slate-500">{t('غ كارب')}</span></span>}
                </div>
                {gone ? (
                  <button className="mt-1 min-h-[44px] text-[16px] font-bold text-brand" onClick={() => setQty(i, x.q0 || step)}>↺ {t('رجّعيه')}</button>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <button aria-label="−" className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-2xl font-bold text-brand" onClick={() => setQty(i, x.line.quantity - step)}>−</button>
                    <span className="num min-w-[88px] text-center text-[20px] font-bold">{fmt(x.line.unit === 'g' || x.line.unit === 'ml' ? Math.round(x.line.quantity) : x.line.quantity)} <span className="text-[15px] font-normal text-slate-500">{unitText(x.line.unit)}</span></span>
                    <button aria-label="+" className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-2xl font-bold text-brand" onClick={() => setQty(i, x.line.quantity + step)}>+</button>
                    <button className="ms-auto min-h-[48px] px-2 text-[16px] text-over" onClick={() => setQty(i, 0)}>✕ {t('شيليه')}</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-3xl bg-white p-4 text-center">
          <div className="text-[16px] text-slate-500">{t('الكارب')}</div>
          <div className="mt-1 flex items-center justify-center gap-5">
            <button aria-label="−" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setCarbs(Math.max(0, carbs - 1))}>−</button>
            <span className="num w-24 text-[44px] font-extrabold">{fmt(carbs)}</span>
            <button aria-label="+" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setCarbs(carbs + 1)}>+</button>
          </div>
          <div className="text-[15px] text-slate-500">{t('غ كارب')}</div>
        </div>
      )}
      {items && <Big tone="soft" onClick={() => setPicking(true)}>+ {t('أضيفي صنف')}</Big>}
      <div className="text-[17px] font-bold">{t('كم أكلت منها؟')}</div>
      <div className="grid grid-cols-4 gap-2">
        {PARTS.map(([v, w]) => (
          <button key={v} onClick={() => setPart(v)} className={cx('min-h-[56px] rounded-2xl text-[18px] font-bold', part === v ? 'bg-brand text-white' : 'border border-slate-200 bg-white')}>{t(w)}</button>
        ))}
      </div>
      <div className="flex items-baseline justify-between rounded-3xl bg-white px-4 py-3">
        <span className="text-[17px]">{t('المجموع')}</span>
        <span><b className="num text-[24px]">{fmt(total)}</b> <span className="text-[15px] text-slate-500">{t('غ كارب')}</span>{changed && <span className="block text-end text-[14px] text-slate-500">{t('كان {g}', { g: fmt(h.total_carbs) })}</span>}</span>
      </div>
      <p className="text-center text-[14px] text-slate-500">{t('الإبرة المسجّلة ما تتغير.')}</p>
    </MomPage>
  );
}
