// «صحن بالميزان»: rice and stew the way a mum actually serves it, on one screen. The rice is weighed (zero the
// scale, add the rice, type the number); the stew goes by ladles (one item = one ladle, its carbs set by Dad); the
// potato in the stew goes by pieces (small, medium, large ≈ 20, 40, 60 g of boiled potato, so its carbs come from
// the potato's own values). Live carbs on every line and the total at the
// bottom; nothing else to choose. The items land on the plate like any other food, then on to the dose.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { draftOps } from '../../lib/mom';
import { readyForMom, type MomItem } from '../../engine/mom';
import { fmt } from '../../lib/carbs';
import { cx, inputCls } from '../../components/ui';
import { t } from '../../i18n';
import { Big, MomPage } from './MomUI';
import { useCatalog } from './MomMeal';

/** The foods this screen uses, by their names in the list (Dad keeps them; a missing one simply does not show). */
export const PLATE_FOODS = {
  rice: 'رز أبيض مطبوخ', // i18n-ok: product names (data)
  ladle: 'مرق بدون عيش وبطاط (مغرفة)', // i18n-ok
  potato: 'بطاط مسلوق', // i18n-ok
};
/** About how much one piece of potato in the stew weighs: small, medium, large (grams). */
export const PIECE_G = [20, 40, 60];
const SIZE_WORD = ['صغيرة', 'وسط', 'كبيرة']; // i18n-ok: shown through t()
const SIZE_HINT = ['قد اللقمة', 'قد البيضة الصغيرة', 'قد البيضة']; // i18n-ok: shown through t()

function Counter({ n, set, step = 1 }: { n: number; set: (v: number) => void; step?: number }) {
  const b = 'grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-soft text-2xl font-bold text-brand disabled:opacity-30';
  return (
    <div className="flex items-center gap-2" dir="ltr">
      <button className={b} aria-label="−" disabled={n <= 0} onClick={() => set(Math.max(0, Math.round((n - step) * 10) / 10))}>−</button>
      <span className="num w-10 text-center text-[26px] font-extrabold">{fmt(n)}</span>
      <button className={b} aria-label="+" onClick={() => set(Math.round((n + step) * 10) / 10)}>+</button>
    </div>
  );
}

export function MomPlate() {
  const nav = useNavigate();
  const { c, itemCarbs, mealCarbs } = useCatalog();
  const find = (name: string) => c.products.find((p) => p.name === name && readyForMom('product', p.id, c)) ?? null;
  const rice = find(PLATE_FOODS.rice), ladle = find(PLATE_FOODS.ladle), potato = find(PLATE_FOODS.potato);
  const [riceG, setRiceG] = useState<number | null>(null);
  const [ladles, setLadles] = useState(0);
  const [pc, setPc] = useState([0, 0, 0]);
  const potG = pc.reduce((a, n, i) => a + n * PIECE_G[i], 0);

  const items: MomItem[] = [
    ...(rice && riceG ? [{ kind: 'product' as const, id: rice.id, portion_id: null, amount: riceG, unit: 'g' as const }] : []),
    // a ladle is one item (one item = 100 units, as for every food counted by the piece)
    ...(ladle && ladles ? [{ kind: 'product' as const, id: ladle.id, portion_id: null, amount: ladles * 100, unit: 'g' as const }] : []),
    ...(potato && potG ? [{ kind: 'product' as const, id: potato.id, portion_id: null, amount: potG, unit: 'g' as const }] : []),
  ];
  const total = items.length ? mealCarbs(items) : null;
  const g = (it: MomItem | null) => (it ? itemCarbs(it) : null);
  const carbs = (v: number | null) => <span className="num shrink-0 text-[18px] font-bold text-brand">{v === null ? '' : `${fmt(v)} ${t('غ')}`}</span>;
  const done = () => { items.forEach((it) => draftOps.add(it)); nav('/mom/meal', { replace: true }); };
  const card = 'space-y-2 rounded-3xl bg-white px-4 py-3';

  return (
    <MomPage compact title={t('صحن بالميزان')} back="/mom/meal" foot={<>
      <div className="flex items-baseline justify-between px-1"><span className="text-[17px] text-slate-500">{t('الكارب')}</span><b className="num text-[26px]">{total === null ? '—' : `${fmt(total)} ${t('غ كارب')}`}</b></div>
      <Big md disabled={!items.length || total === null} onClick={done}>{t('تم')}</Big>
    </>}>
      <p className="rounded-2xl bg-brand-soft px-4 py-2.5 text-center text-[16px] text-brand">⚖️ {t('صفّري الميزان قبل كل صنف')}</p>

      {rice && (
        <div className={card}>
          <div className="flex items-center gap-2 text-[19px] font-bold"><span className="text-3xl">🍚</span><span className="flex-1">{t('عيش')}</span>{carbs(riceG ? g({ kind: 'product', id: rice.id, portion_id: null, amount: riceG, unit: 'g' }) : null)}</div>
          <div className="flex items-center justify-center gap-3" dir="ltr">
            <input inputMode="decimal" dir="ltr" placeholder="0" className={cx(inputCls, '!w-32 !text-center !text-[30px] font-bold')} value={riceG ?? ''}
              onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); setRiceG(e.target.value === '' || !Number.isFinite(v) || v <= 0 ? null : v); }} />
            <span className="text-[18px] text-slate-500">{t('غرام')}</span>
          </div>
        </div>
      )}

      {ladle && (
        <div className={card}>
          <div className="flex items-center gap-2 text-[19px] font-bold"><span className="text-3xl">🥣</span><span className="flex-1">{t('مرق')} <span className="text-[14px] font-normal text-slate-500">{t('بالمغرفة')}</span></span>{carbs(ladles ? g({ kind: 'product', id: ladle.id, portion_id: null, amount: ladles * 100, unit: 'g' }) : null)}</div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] text-slate-500">{t('المغرفة ≈ {g} غ كارب', { g: fmt(Number(ladle.carbs_per_100)) })}</span>
            <Counter n={ladles} set={setLadles} step={0.5} />
          </div>
        </div>
      )}

      {potato && (
        <div className={card}>
          <div className="flex items-center gap-2 text-[19px] font-bold"><span className="text-3xl">🥔</span><span className="flex-1">{t('بطاط في المرق')}</span>{carbs(potG ? g({ kind: 'product', id: potato.id, portion_id: null, amount: potG, unit: 'g' }) : null)}</div>
          {PIECE_G.map((w, i) => (
            <div key={i} className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
              <span className="min-w-0"><b className="block text-[17px]">{t('قطعة {s}', { s: t(SIZE_WORD[i]) })} <span className="text-[15px] font-normal text-slate-500">≈ {fmt(Math.round(w * Number(potato.carbs_per_100)) / 100)} {t('غ')}</span></b><span className="text-[14px] text-slate-500">{t(SIZE_HINT[i])}</span></span>
              <Counter n={pc[i]} set={(v) => setPc(pc.map((x, k) => (k === i ? v : x)))} />
            </div>
          ))}
          <p className="text-[13px] text-slate-500">{t('تقريبي: القطعة ≈ 20 أو 40 أو 60 غ بطاط مسلوق ({c} غ كارب لكل 100 غ)', { c: fmt(Number(potato.carbs_per_100)) })}</p>
        </div>
      )}

      {!rice && !ladle && !potato && <p className="text-center text-slate-500">{t('بابا ما جهّز أصناف الصحن بعد')}</p>}
      <button className="min-h-[48px] text-[17px] font-bold text-brand" onClick={() => { items.forEach((it) => draftOps.add(it)); nav('/mom/add', { replace: true }); }}>+ {t('شي ثاني مع الصحن')}</button>
    </MomPage>
  );
}
