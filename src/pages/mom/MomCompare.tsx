// Mom mode, «قارني»: up to three foods side by side — carbs first (the fewest marked), then sugar, calories, protein,
// fat, fiber — per 100 g or per portion (each food's first household portion, else its label serving; a recipe: per
// plate). A value the label does not give shows «—», never 0. The list is kept on the phone (lib/mom).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { compareOps, useCompare } from '../../lib/mom';
import { planMeal } from '../../lib/plans';
import { COMPARE_MAX, lowestCarbs, planItemsOf } from '../../engine/mom';
import { fmt } from '../../lib/carbs';
import { Photo, cx } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { Big, MomPage } from './MomUI';
import { pic, useBack, useCatalog } from './MomMeal';

type Facts = { carbs: number | null; sugar: number | null; kcal: number | null; protein: number | null; fat: number | null; fiber: number | null };
const n = (v: number | null | undefined, f = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * f * 10) / 10);

export function MomCompare() {
  const nav = useNavigate();
  const list = useCompare();
  const { products, settings } = useData();
  const { c, nameOf, photoOf, firstPortion } = useCatalog();
  const [per, setPer] = useState<'100' | 'portion'>('100');
  const back = useBack('/mom/food');
  const cols = list.map((ref) => {
    const x = photoOf(ref);
    let sub: string | null = null, v: Facts | null = null;
    if (ref.kind === 'recipe') {
      const items = planItemsOf({ ...ref, portion_id: null, amount: 1, unit: 'plate' }, c);
      const m = items ? planMeal(items, products, settings) : null;
      const r = (k: 'fat' | 'protein' | 'fiber') => (!m || m.missing[k] ? null : n(m.total[k]));
      sub = t('الصحن الواحد');
      v = { carbs: m && m.complete ? n(m.total.carbs) : null, sugar: null, kcal: m && !m.missing.kcal ? Math.round(m.total.kcal) : null, protein: r('protein'), fat: r('fat'), fiber: r('fiber') };
    } else {
      const p = products.find((y) => y.id === ref.id);
      if (p) {
        const u = p.unit === 'ml' ? t('مل') : t('غ'), ss = p.serving_size ? Number(p.serving_size) : null, por = firstPortion('product', p.id);
        // per portion: the first household portion, else the label's serving, else nothing to show
        const f = per === '100' ? 1 : por ? Number(por.amount) / 100 : ss ? ss / 100 : null;
        sub = per === '100' ? (p.unit === 'ml' ? `100 ${u}` : null) : por ? `${tMaybe(por.label)} (${fmt(Number(por.amount))} ${u})` : ss ? t('الحصة {s} {u}', { s: fmt(ss), u }) : null;
        if (f !== null) v = { carbs: n(p.carbs_per_100, f), sugar: n(p.sugar_per_100, f), kcal: p.kcal_per_100 === null || p.kcal_per_100 === undefined ? null : Math.round(Number(p.kcal_per_100) * f), protein: n(p.protein_per_100, f), fat: n(p.fat_per_100, f), fiber: n(p.fiber_per_100, f) };
      }
    }
    return { ref, x, sub, v };
  });
  // the fewest carbs among foods measured the same way (per 100, a recipe's plate is not)
  const low = lowestCarbs(cols.map((col) => (per === '100' && col.ref.kind === 'recipe' ? null : col.v?.carbs ?? null)));
  const rows: { k: keyof Facts; label: string; unit: string }[] = [
    { k: 'carbs', label: t('كارب'), unit: t('غ') }, { k: 'sugar', label: t('سكر'), unit: t('غ') }, { k: 'kcal', label: t('سعرات'), unit: '' },
    { k: 'protein', label: t('بروتين'), unit: t('غ') }, { k: 'fat', label: t('دهون'), unit: t('غ') }, { k: 'fiber', label: t('ألياف'), unit: t('غ') },
  ];
  return (
    <MomPage title={t('قارني')} back={back} foot={
      <div className="grid grid-cols-2 gap-2">
        {list.length < COMPARE_MAX && <Big tone="soft" onClick={() => nav('/mom/food')}>+ {t('أضيفي')}</Big>}
        {list.length > 0 && <Big tone="ghost" className={cx(list.length >= COMPARE_MAX && 'col-span-2')} onClick={() => { compareOps.clear(); nav('/mom/food', { replace: true }); }}>{t('مسح')}</Big>}
      </div>
    }>
      {!list.length ? <p className="text-center text-[18px] text-slate-500">{t('ما في شي للمقارنة بعد')}</p> : (
        <>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-[16px]">
            {(['100', 'portion'] as const).map((k) => <button key={k} onClick={() => setPer(k)} className={cx('min-h-[44px] rounded-full', per === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === '100' ? t('لكل 100 غ') : t('للحصة')}</button>)}
          </div>
          <table className="w-full table-fixed overflow-hidden rounded-3xl bg-white text-[16px]">
            <thead>
              <tr>
                <th className="w-[62px]" />
                {cols.map((col) => (
                  <th key={col.ref.kind + col.ref.id} className="relative px-1 pb-2 pt-3 align-top font-normal">
                    <button aria-label={t('شيليه')} onClick={() => compareOps.remove(col.ref)} className="absolute end-0.5 top-0.5 grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[15px] text-slate-600">✕</button>
                    <Photo {...pic(col.x)} className="mx-auto h-14 w-14 rounded-xl" />
                    <span className="mt-1 line-clamp-2 text-[14px] font-bold leading-tight"><bdi>{nameOf(col.ref)}</bdi></span>
                    {col.sub && <span className="line-clamp-2 text-[12px] leading-tight text-slate-500"><bdi>{col.sub}</bdi></span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.k} className={cx(r.k === 'carbs' && 'bg-brand-soft/50')}>
                  <td className="px-2 py-2.5 text-[15px]">{r.label}</td>
                  {cols.map((col, i) => {
                    const v = col.v ? col.v[r.k] : null;
                    return (
                      <td key={col.ref.kind + col.ref.id} className="px-1 py-2.5 text-center">
                        {v === null ? <span className="text-slate-400">—</span>
                          : <span className={r.k === 'carbs' ? 'num text-[22px] font-extrabold text-brand' : 'num font-bold'}>{fmt(v)}{r.unit ? <span className="text-[12px] font-normal text-slate-500"> {r.unit}</span> : null}</span>}
                        {r.k === 'carbs' && low.includes(i) && <span className="mx-auto mt-0.5 block w-fit rounded-full bg-ok-soft px-2 text-[12px] font-bold text-ok">✓ {t('الأقل')}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </MomPage>
  );
}
